use axum::{
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    Json,
};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, Row};
use std::sync::Arc;
use std::collections::HashMap;
use std::collections::HashSet;
use std::sync::Mutex;

use crate::{
    auth::AuthUser,
    data::{challenges, topics},
    db,
    models::UserResponse,
    ranks,
    types::{ChallengePreview, SubmitRequest, SubmitResponse},
};

// ---------------------------------------------------------------------------
// AppState
// ---------------------------------------------------------------------------

/// In-memory store of pending OAuth state tokens.
/// Each token is a one-time-use random string; it is removed when the callback
/// validates it.  Old tokens are evicted lazily (they expire after the browser
/// session redirects back, usually within seconds).
pub type OAuthStateStore = Arc<Mutex<HashSet<String>>>;

#[derive(Clone)]
pub struct AppState {
    pub challenges: Arc<Vec<crate::types::Challenge>>,
    pub topics: Arc<Vec<crate::types::Topic>>,
    // Auth / DB — all optional so build_app() (test helper) works without a DB.
    pub db: Option<PgPool>,
    pub github_client_id: Option<String>,
    pub github_client_secret: Option<String>,
    pub jwt_secret: Option<String>,
    pub web_url: Option<String>,
    pub api_base_url: Option<String>,
    /// Pending OAuth state tokens (CSRF protection)
    pub oauth_states: OAuthStateStore,
}

impl AppState {
    /// No-DB constructor used by unit tests.
    pub fn new() -> Self {
        AppState {
            challenges: Arc::new(challenges()),
            topics: Arc::new(topics()),
            db: None,
            github_client_id: None,
            github_client_secret: None,
            jwt_secret: None,
            web_url: None,
            api_base_url: None,
            oauth_states: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// Full constructor used in production.
    pub fn new_with_db(pool: PgPool) -> Self {
        let get = |key: &str| std::env::var(key).ok();
        AppState {
            challenges: Arc::new(challenges()),
            topics: Arc::new(topics()),
            db: Some(pool),
            github_client_id: get("GITHUB_CLIENT_ID"),
            github_client_secret: get("GITHUB_CLIENT_SECRET"),
            jwt_secret: get("JWT_SECRET"),
            web_url: get("WEB_URL"),
            api_base_url: get("API_BASE_URL").or_else(|| get("EXPO_PUBLIC_API_URL")),
            oauth_states: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

// ---------------------------------------------------------------------------
// GET /challenges/topics
// ---------------------------------------------------------------------------
pub async fn list_topics(State(state): State<AppState>, AuthUser(_): AuthUser) -> impl IntoResponse {
    Json(state.topics.as_ref().clone())
}

// ---------------------------------------------------------------------------
// GET /challenges/today?topic=<topic>
// ---------------------------------------------------------------------------
#[derive(Deserialize)]
pub struct TodayQuery {
    pub topic: Option<String>,
}

pub async fn get_today(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Query(params): Query<TodayQuery>,
) -> impl IntoResponse {
    let topic = match params.topic {
        Some(t) if !t.is_empty() => t,
        _ => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "topic query param is required" })),
            )
                .into_response();
        }
    };

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();

    match state.challenges.iter().find(|c| {
        c.date == today && c.topic == topic
    }) {
        Some(c) => {
            let preview: ChallengePreview = c.into();
            (StatusCode::OK, Json(serde_json::to_value(preview).unwrap())).into_response()
        }
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({
                "error": format!("No challenge for topic \"{}\" today ({})", topic, today)
            })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// POST /challenges/:id/submit
// ---------------------------------------------------------------------------

pub async fn submit(
    State(state): State<AppState>,
    Path(id): Path<String>,
    AuthUser(claims): AuthUser,
    Json(body): Json<SubmitRequest>,
) -> impl IntoResponse {
    match state.challenges.iter().find(|c| c.id == id) {
        None => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": format!("Challenge \"{}\" not found", id) })),
        )
            .into_response(),
        Some(challenge) => {
            if body.time_ms < 200 {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "time_ms too low" })),
                )
                    .into_response();
            }

            let correct = body.answer.trim() == challenge.correct_answer.trim();
            let score_pct: Option<u8> = None;

            // ── Record completion (idempotent) — must happen before rank calc ─
            if let (Some(pool), Ok(user_id)) = (&state.db, claims.sub.parse::<uuid::Uuid>()) {
                let _ = db::record_completion(
                    pool,
                    user_id,
                    &id,
                    body.time_ms as i64,
                    correct,
                    score_pct.map(|v| v as i16),
                    None, // country — not available at this layer
                )
                .await;
            }

            // ── Streak increment (server-side, on correct answer only) ────────
            let mut current_streak: Option<i32> = None;
            let mut is_streak_milestone: Option<bool> = None;
            const STREAK_MILESTONES: &[i32] = &[3, 7, 14, 30, 60, 100, 200, 365];

            if correct {
                if let (Some(pool), Ok(user_id)) = (&state.db, claims.sub.parse::<uuid::Uuid>()) {
                    let today = chrono::Utc::now().date_naive();
                    if let Ok(streak) = db::increment_streak(pool, user_id, today).await {
                        let milestone = STREAK_MILESTONES.contains(&streak.current_streak);
                        current_streak = Some(streak.current_streak);
                        is_streak_milestone = Some(milestone);
                    }
                }
            }

            // ── Rank update (best-effort; never blocks the response) ─────────
            let mut rank_info: Option<crate::types::RankInfo> = None;
            let mut rank_up: Option<bool> = None;
            let mut rank_down: Option<bool> = None;
            let mut prev_tier: Option<String> = None;

            if let (Some(pool), Ok(user_id)) = (
                &state.db,
                claims.sub.parse::<uuid::Uuid>(),
            ) {
                if let Ok(Some(season)) = db::get_active_season(pool).await {
                    let topic = challenge.topic.as_str();

                    // Get current rank (before this submission)
                    let existing = db::get_user_rank(pool, user_id, season.id, topic)
                        .await
                        .ok()
                        .flatten();
                    let current_lp = existing.as_ref().map(|r| r.lp).unwrap_or(0);
                    let current_tier = existing
                        .as_ref()
                        .map(|r| r.tier.as_str())
                        .unwrap_or("Tin")
                        .to_string();

                    let new_lp;
                    let new_tier_str: String;

                    if correct {
                        // Recompute LP from full season formula (filtered to this topic)
                        let season_points = db::get_season_points(
                            pool,
                            user_id,
                            topic,
                            season.starts_at,
                            season.ends_at,
                        )
                        .await
                        .unwrap_or(0);

                        let (total_attempts, correct_count) = db::get_season_attempt_counts(
                            pool,
                            user_id,
                            topic,
                            season.starts_at,
                            season.ends_at,
                        )
                        .await
                        .unwrap_or((0, 0));

                        let accuracy_pct = if total_attempts > 0 {
                            correct_count as f64 / total_attempts as f64 * 100.0
                        } else {
                            0.0
                        };

                        // Also factor in current streak
                        let streak_days = db::get_streak(pool, user_id)
                            .await
                            .ok()
                            .map(|s| s.current_streak)
                            .unwrap_or(0);

                        let (computed_tier, computed_lp) =
                            ranks::compute_rank(season_points, streak_days, accuracy_pct);

                        // LP can only go up from correct answers
                        new_lp = computed_lp.max(current_lp);
                        new_tier_str = ranks::tier_name_for_lp(new_lp).to_string();
                        let _ = computed_tier; // used via tier_name_for_lp
                    } else {
                        // Wrong answer — apply LP penalty / demotion
                        let (penalised_tier, penalised_lp, demoted) =
                            ranks::apply_wrong_answer_penalty(current_lp, &current_tier);
                        new_lp = penalised_lp;
                        new_tier_str = penalised_tier.to_string();
                        if demoted {
                            rank_down = Some(true);
                            prev_tier = Some(current_tier.clone());
                        }
                    }

                    // Detect promotion
                    if new_tier_str != current_tier && rank_down.is_none() {
                        // Check it was actually an upgrade (tier index increased)
                        let old_idx = ranks::tier_index_for_lp(current_lp);
                        let new_idx = ranks::tier_index_for_lp(new_lp);
                        if new_idx > old_idx {
                            rank_up = Some(true);
                            prev_tier = Some(current_tier.clone());
                        }
                    }

                    // Persist
                    let _ = db::upsert_user_rank(pool, user_id, season.id, topic, new_lp, &new_tier_str).await;

                    rank_info = Some(crate::types::RankInfo {
                        tier: new_tier_str,
                        lp: new_lp,
                        season: season.name.clone(),
                    });
                }
            }

            let response = SubmitResponse {
                correct,
                correct_answer: challenge.correct_answer.clone(),
                explanation: challenge.explanation.clone(),
                time_ms: body.time_ms,
                score_pct,
                rank_info,
                rank_up,
                rank_down,
                prev_tier,
                current_streak,
                is_streak_milestone,
            };
            (StatusCode::OK, Json(serde_json::to_value(response).unwrap())).into_response()
        }
    }
}

// ---------------------------------------------------------------------------
// GET /challenges/:id/stats  (public)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct ChallengeStats {
    pub total_attempts: i64,
    pub correct_pct: f64,
    pub avg_time_ms: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub faster_than_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub faster_than_count: Option<i64>,
    /// ISO 3166-1 alpha-2 country code the user was detected in (from CF-IPCountry)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_faster_than_pct: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub country_total: Option<i64>,
}

#[derive(Deserialize)]
pub struct StatsQuery {
    pub time_ms: Option<i64>,
    pub correct: Option<bool>,
}

pub async fn get_challenge_stats(
    State(state): State<AppState>,
    Path(id): Path<String>,
    AuthUser(_): AuthUser,
    Query(params): Query<StatsQuery>,
    headers: HeaderMap,
) -> impl IntoResponse {
    // Verify the challenge exists
    if state.challenges.iter().all(|c| c.id != id) {
        return (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": format!("Challenge \"{}\" not found", id) })),
        )
            .into_response();
    }

    // Detect country from Cloudflare header; exclude special codes
    let country: Option<String> = headers
        .get("CF-IPCountry")
        .and_then(|v| v.to_str().ok())
        .filter(|s| *s != "XX" && *s != "T1" && s.len() == 2)
        .map(|s| s.to_uppercase());

    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::OK,
                Json(serde_json::to_value(ChallengeStats {
                    total_attempts: 0,
                    correct_pct: 0.0,
                    avg_time_ms: 0.0,
                    faster_than_pct: None,
                    faster_than_count: None,
                    country: None,
                    country_faster_than_pct: None,
                    country_total: None,
                }).unwrap()),
            )
                .into_response();
        }
    };

    match db::get_challenge_stats(pool, &id, params.time_ms, params.correct.unwrap_or(false), country.as_deref()).await {
        Ok(stats) => (StatusCode::OK, Json(serde_json::to_value(stats).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------

pub async fn me(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
) -> impl IntoResponse {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Database not configured" })),
            )
                .into_response();
        }
    };

    let user_id = match claims.sub.parse::<uuid::Uuid>() {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid user id in token" })),
            )
                .into_response();
        }
    };

    match db::get_user_by_id(pool, user_id).await {
        Ok(Some(user)) => {
            let response: UserResponse = user.into();
            (StatusCode::OK, Json(serde_json::to_value(response).unwrap())).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(serde_json::json!({ "error": "User not found" })),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// GET /me/streak
// ---------------------------------------------------------------------------

pub async fn me_streak(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
) -> impl IntoResponse {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Database not configured" })),
            )
                .into_response();
        }
    };
    let user_id = match claims.sub.parse::<uuid::Uuid>() {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid token" })),
            )
                .into_response();
        }
    };

    match db::get_streak(pool, user_id).await {
        Ok(streak) => (StatusCode::OK, Json(serde_json::to_value(streak).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// POST /me/completions — body: { challenge_id, time_ms, correct, score_pct? }
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct RecordCompletionBody {
    pub challenge_id: String,
    pub time_ms: i64,
    pub correct: bool,
    pub score_pct: Option<i16>,
}

pub async fn me_record_completion(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
    headers: HeaderMap,
    Json(body): Json<RecordCompletionBody>,
) -> impl IntoResponse {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Database not configured" })),
            )
                .into_response();
        }
    };
    let user_id = match claims.sub.parse::<uuid::Uuid>() {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid token" })),
            )
                .into_response();
        }
    };

    let country: Option<String> = headers
        .get("CF-IPCountry")
        .and_then(|v| v.to_str().ok())
        .filter(|s| *s != "XX" && *s != "T1" && s.len() == 2)
        .map(|s| s.to_uppercase());

    match db::record_completion(
        pool,
        user_id,
        &body.challenge_id,
        body.time_ms,
        body.correct,
        body.score_pct,
        country.as_deref(),
    )
    .await
    {
        Ok(c) => (StatusCode::OK, Json(serde_json::to_value(c).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// GET /leaderboard  (public — no auth required)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct LeaderboardUser {
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Serialize)]
pub struct StreakEntry {
    pub rank: usize,
    pub user: LeaderboardUser,
    pub current_streak: i32,
    pub longest_streak: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lp: Option<i64>,
}

#[derive(Serialize)]
pub struct AccuracyEntry {
    pub rank: usize,
    pub user: LeaderboardUser,
    /// 0-100 rounded to one decimal place
    pub correct_pct: f64,
    /// Average time in milliseconds over all correct attempts
    pub avg_time_ms: f64,
    pub total_correct: usize,
    pub total_attempts: usize,
    /// Per-topic breakdown: topic slug → { correct_pct, avg_time_ms }
    pub by_topic: HashMap<String, TopicAccuracy>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lp: Option<i64>,
}

#[derive(Serialize)]
pub struct TopicAccuracy {
    pub correct_pct: f64,
    pub avg_time_ms: f64,
    pub correct: usize,
    pub attempts: usize,
}

#[derive(Serialize)]
pub struct BreadthEntry {
    pub rank: usize,
    pub user: LeaderboardUser,
    /// Number of distinct topics where the user has at least one correct answer
    pub topics_correct: usize,
    /// Total correct answers across all topics
    pub total_correct: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lp: Option<i64>,
}

#[derive(Serialize)]
pub struct LeaderboardResponse {
    pub streaks: Vec<StreakEntry>,
    pub accuracy: Vec<AccuracyEntry>,
    pub breadth: Vec<BreadthEntry>,
}

pub async fn get_leaderboard(State(state): State<AppState>, AuthUser(_): AuthUser) -> impl IntoResponse {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Database not configured" })),
            )
                .into_response();
        }
    };

    // Build challenge_id → topic map from in-memory data
    let challenge_topic: HashMap<&str, &str> = state
        .challenges
        .iter()
        .map(|c| (c.id.as_str(), c.topic.as_str()))
        .collect();

    // ── Streak leaderboard ───────────────────────────────────────────────────
    let streak_rows = match db::get_leaderboard_streaks(pool, 50).await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    let mut streaks: Vec<StreakEntry> = streak_rows
        .into_iter()
        .enumerate()
        .map(|(i, r)| StreakEntry {
            rank: i + 1,
            user: LeaderboardUser {
                username: r.username,
                display_name: r.display_name,
                avatar_url: r.avatar_url,
            },
            current_streak: r.current_streak,
            longest_streak: r.longest_streak,
            rank_tier: None,
            lp: None,
        })
        .collect();

    // ── Accuracy + Breadth leaderboards ─────────────────────────────────────
    let completions = match db::get_all_completions_with_users(pool).await {
        Ok(c) => c,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    // Aggregate per user
    struct UserAgg {
        username: String,
        display_name: Option<String>,
        avatar_url: Option<String>,
        // topic → (correct_count, total_count, sum_time_ms_correct)
        by_topic: HashMap<String, (usize, usize, i64)>,
    }

    let mut user_map: HashMap<uuid::Uuid, UserAgg> = HashMap::new();

    for row in completions {
        let topic = match challenge_topic.get(row.challenge_id.as_str()) {
            Some(t) => t.to_string(),
            // skip challenges we can't map (shouldn't happen)
            None => continue,
        };
        let agg = user_map.entry(row.user_id).or_insert_with(|| UserAgg {
            username: row.username.clone(),
            display_name: row.display_name.clone(),
            avatar_url: row.avatar_url.clone(),
            by_topic: HashMap::new(),
        });
        let entry = agg.by_topic.entry(topic).or_insert((0, 0, 0));
        entry.1 += 1; // total
        if row.correct {
            entry.0 += 1; // correct
            entry.2 += row.time_ms; // sum time for correct
        }
    }

    // Build accuracy entries
    let mut accuracy_entries: Vec<AccuracyEntry> = user_map
        .iter()
        .map(|(_, agg)| {
            let total_attempts: usize = agg.by_topic.values().map(|(_, t, _)| t).sum();
            let total_correct: usize = agg.by_topic.values().map(|(c, _, _)| c).sum();
            let total_time_correct: i64 = agg.by_topic.values().map(|(_, _, ms)| ms).sum();

            let correct_pct = if total_attempts > 0 {
                (total_correct as f64 / total_attempts as f64 * 1000.0).round() / 10.0
            } else {
                0.0
            };
            let avg_time_ms = if total_correct > 0 {
                (total_time_correct as f64 / total_correct as f64 * 10.0).round() / 10.0
            } else {
                0.0
            };

            let by_topic: HashMap<String, TopicAccuracy> = agg
                .by_topic
                .iter()
                .map(|(topic, (c, t, ms))| {
                    let pct = if *t > 0 {
                        (*c as f64 / *t as f64 * 1000.0).round() / 10.0
                    } else {
                        0.0
                    };
                    let avg = if *c > 0 {
                        (*ms as f64 / *c as f64 * 10.0).round() / 10.0
                    } else {
                        0.0
                    };
                    (
                        topic.clone(),
                        TopicAccuracy {
                            correct_pct: pct,
                            avg_time_ms: avg,
                            correct: *c,
                            attempts: *t,
                        },
                    )
                })
                .collect();

            AccuracyEntry {
                rank: 0, // filled below after sorting
                user: LeaderboardUser {
                    username: agg.username.clone(),
                    display_name: agg.display_name.clone(),
                    avatar_url: agg.avatar_url.clone(),
                },
                correct_pct,
                avg_time_ms,
                total_correct,
                total_attempts,
                by_topic,
                rank_tier: None,
                lp: None,
            }
        })
        .collect();

    // Sort by correct_pct desc, then avg_time_ms asc (faster is better)
    accuracy_entries.sort_by(|a, b| {
        b.correct_pct
            .partial_cmp(&a.correct_pct)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(
                a.avg_time_ms
                    .partial_cmp(&b.avg_time_ms)
                    .unwrap_or(std::cmp::Ordering::Equal),
            )
    });
    for (i, e) in accuracy_entries.iter_mut().enumerate() {
        e.rank = i + 1;
    }
    accuracy_entries.truncate(50);

    // Build breadth entries
    let mut breadth_entries: Vec<BreadthEntry> = user_map
        .iter()
        .map(|(_, agg)| {
            let topics_correct = agg.by_topic.values().filter(|(c, _, _)| *c > 0).count();
            let total_correct: usize = agg.by_topic.values().map(|(c, _, _)| c).sum();
            BreadthEntry {
                rank: 0,
                user: LeaderboardUser {
                    username: agg.username.clone(),
                    display_name: agg.display_name.clone(),
                    avatar_url: agg.avatar_url.clone(),
                },
                topics_correct,
                total_correct,
                rank_tier: None,
                lp: None,
            }
        })
        .collect();

    // Sort by topics_correct desc, then total_correct desc
    breadth_entries.sort_by(|a, b| {
        b.topics_correct
            .cmp(&a.topics_correct)
            .then(b.total_correct.cmp(&a.total_correct))
    });
    for (i, e) in breadth_entries.iter_mut().enumerate() {
        e.rank = i + 1;
    }
    breadth_entries.truncate(50);

    // ── Augment all leaderboard entries with rank tier / LP ──────────────────
    // Collect all usernames across all three boards and look up their user_ids,
    // then fetch rank data for the active season in a single query.
    let active_season = db::get_active_season(pool).await.ok().flatten();

    if let Some(ref season) = active_season {
        // Build username → user_id map from streak rows (which have user_ids)
        let user_id_rows = match sqlx::query(
            r#"SELECT id, username FROM users WHERE username = ANY($1)"#,
        )
        .bind(
            &streaks
                .iter()
                .map(|e| e.user.username.clone())
                .chain(accuracy_entries.iter().map(|e| e.user.username.clone()))
                .chain(breadth_entries.iter().map(|e| e.user.username.clone()))
                .collect::<std::collections::HashSet<String>>()
                .into_iter()
                .collect::<Vec<String>>(),
        )
        .fetch_all(pool)
        .await {
            Ok(r) => r,
            Err(_) => vec![],
        };

        let username_to_id: HashMap<String, uuid::Uuid> = user_id_rows
            .iter()
            .map(|r| {
                let id: uuid::Uuid = r.get("id");
                let uname: String = r.get("username");
                (uname, id)
            })
            .collect();

        let all_ids: Vec<uuid::Uuid> = username_to_id.values().cloned().collect();
        let rank_map = db::get_user_ranks_for_season(pool, season.id, &all_ids)
            .await
            .unwrap_or_default();

        // Helper: resolve tier/lp for a username
        let resolve = |username: &str| -> (Option<String>, Option<i64>) {
            if let Some(uid) = username_to_id.get(username) {
                if let Some((tier, lp)) = rank_map.get(uid) {
                    return (Some(tier.clone()), Some(*lp));
                }
            }
            (None, None)
        };

        for e in &mut streaks {
            let (t, l) = resolve(&e.user.username);
            e.rank_tier = t;
            e.lp = l;
        }
        for e in &mut accuracy_entries {
            let (t, l) = resolve(&e.user.username);
            e.rank_tier = t;
            e.lp = l;
        }
        for e in &mut breadth_entries {
            let (t, l) = resolve(&e.user.username);
            e.rank_tier = t;
            e.lp = l;
        }
    }

    let response = LeaderboardResponse {
        streaks,
        accuracy: accuracy_entries,
        breadth: breadth_entries,
    };

    (StatusCode::OK, Json(serde_json::to_value(response).unwrap())).into_response()
}

// ---------------------------------------------------------------------------
// GET /me/completions/today
// ---------------------------------------------------------------------------

pub async fn me_completions_today(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
) -> impl IntoResponse {
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Database not configured" })),
            )
                .into_response();
        }
    };
    let user_id = match claims.sub.parse::<uuid::Uuid>() {
        Ok(id) => id,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(serde_json::json!({ "error": "Invalid token" })),
            )
                .into_response();
        }
    };

    match db::get_today_completions(pool, user_id).await {
        Ok(list) => (StatusCode::OK, Json(serde_json::to_value(list).unwrap())).into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

/// Helper to extract the DB pool or return 503.
macro_rules! require_db {
    ($state:expr) => {
        match &$state.db {
            Some(p) => p,
            None => {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(serde_json::json!({ "error": "Database not configured" })),
                )
                    .into_response();
            }
        }
    };
}

/// Helper to parse the user UUID from JWT claims.
macro_rules! require_user_id {
    ($claims:expr) => {
        match $claims.sub.parse::<uuid::Uuid>() {
            Ok(id) => id,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(serde_json::json!({ "error": "Invalid token" })),
                )
                    .into_response();
            }
        }
    };
}

#[derive(Serialize)]
pub struct SquadMemberJson {
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub joined_at: String,
}

#[derive(Serialize)]
pub struct SquadJson {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub invite_code: Option<String>,
    pub topics: Vec<String>,
    pub created_by: String,
    pub created_at: String,
    pub members: Vec<SquadMemberJson>,
}

#[derive(Serialize)]
pub struct SquadSummaryJson {
    pub id: String,
    pub name: String,
    pub invite_code: String,
    pub topics: Vec<String>,
    pub member_count: i64,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct SquadLeaderboardEntryJson {
    pub rank: usize,
    pub user_id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub tier: String,
    pub lp: i64,
}

// POST /squads — create a squad
#[derive(Deserialize)]
pub struct CreateSquadBody {
    pub name: String,
    pub topics: Vec<String>,
}

pub async fn create_squad(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
    Json(body): Json<CreateSquadBody>,
) -> impl IntoResponse {
    let pool = require_db!(state);
    let user_id = require_user_id!(claims);

    if body.name.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "Squad name cannot be empty" })),
        )
            .into_response();
    }

    match db::create_squad(pool, body.name.trim(), &body.topics, user_id).await {
        Ok(squad) => {
            let members = match db::get_squad_members(pool, squad.id).await {
                Ok(m) => m,
                Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
            };
            let json = SquadJson {
                id: squad.id.to_string(),
                name: squad.name,
                invite_code: Some(squad.invite_code),
                topics: squad.topics,
                created_by: squad.created_by.to_string(),
                created_at: squad.created_at.to_rfc3339(),
                members: members.into_iter().map(|m| SquadMemberJson {
                    user_id: m.user_id.to_string(),
                    username: m.username,
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    role: m.role,
                    joined_at: m.joined_at.to_rfc3339(),
                }).collect(),
            };
            (StatusCode::CREATED, Json(serde_json::to_value(json).unwrap())).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

// GET /squads/:id — get squad info
pub async fn get_squad(
    State(state): State<AppState>,
    Path(id): Path<String>,
    // Auth is optional — used to decide whether to expose invite_code
    headers: HeaderMap,
) -> impl IntoResponse {
    let pool = require_db!(state);

    let squad_id = match id.parse::<uuid::Uuid>() {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Invalid squad id" }))).into_response(),
    };

    let squad = match db::get_squad(pool, squad_id).await {
        Ok(Some(s)) => s,
        Ok(None) => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Squad not found" }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    // Check if requester is a member (to decide whether to expose invite_code)
    let is_member = if let Some(jwt_secret) = &state.jwt_secret {
        if let Some(auth_header) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
            if let Some(token) = auth_header.strip_prefix("Bearer ") {
                if let Ok(claims) = crate::auth::verify_jwt(token, jwt_secret) {
                    if let Ok(uid) = claims.sub.parse::<uuid::Uuid>() {
                        db::is_squad_member(pool, squad_id, uid).await.unwrap_or(false)
                    } else { false }
                } else { false }
            } else { false }
        } else { false }
    } else { false };

    let members = match db::get_squad_members(pool, squad_id).await {
        Ok(m) => m,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    let json = SquadJson {
        id: squad.id.to_string(),
        name: squad.name,
        invite_code: if is_member { Some(squad.invite_code) } else { None },
        topics: squad.topics,
        created_by: squad.created_by.to_string(),
        created_at: squad.created_at.to_rfc3339(),
        members: members.into_iter().map(|m| SquadMemberJson {
            user_id: m.user_id.to_string(),
            username: m.username,
            display_name: m.display_name,
            avatar_url: m.avatar_url,
            role: m.role,
            joined_at: m.joined_at.to_rfc3339(),
        }).collect(),
    };
    (StatusCode::OK, Json(serde_json::to_value(json).unwrap())).into_response()
}

// POST /squads/join — join by invite code
#[derive(Deserialize)]
pub struct JoinSquadBody {
    pub invite_code: String,
}

pub async fn join_squad(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
    Json(body): Json<JoinSquadBody>,
) -> impl IntoResponse {
    let pool = require_db!(state);
    let user_id = require_user_id!(claims);

    match db::join_squad(pool, body.invite_code.trim(), user_id).await {
        Ok(Some(squad)) => {
            let members = match db::get_squad_members(pool, squad.id).await {
                Ok(m) => m,
                Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
            };
            let json = SquadJson {
                id: squad.id.to_string(),
                name: squad.name,
                invite_code: Some(squad.invite_code),
                topics: squad.topics,
                created_by: squad.created_by.to_string(),
                created_at: squad.created_at.to_rfc3339(),
                members: members.into_iter().map(|m| SquadMemberJson {
                    user_id: m.user_id.to_string(),
                    username: m.username,
                    display_name: m.display_name,
                    avatar_url: m.avatar_url,
                    role: m.role,
                    joined_at: m.joined_at.to_rfc3339(),
                }).collect(),
            };
            (StatusCode::OK, Json(serde_json::to_value(json).unwrap())).into_response()
        }
        Ok(None) => (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Invalid invite code" }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

// DELETE /squads/:id/members/me — leave squad
pub async fn leave_squad(
    State(state): State<AppState>,
    Path(id): Path<String>,
    AuthUser(claims): AuthUser,
) -> impl IntoResponse {
    let pool = require_db!(state);
    let user_id = require_user_id!(claims);

    let squad_id = match id.parse::<uuid::Uuid>() {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Invalid squad id" }))).into_response(),
    };

    // Verify squad exists
    match db::get_squad(pool, squad_id).await {
        Ok(None) => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Squad not found" }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
        Ok(Some(_)) => {}
    }

    match db::leave_squad(pool, squad_id, user_id).await {
        Ok(()) => (StatusCode::OK, Json(serde_json::json!({ "ok": true }))).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

// GET /squads/:id/leaderboard — squad leaderboard
pub async fn get_squad_leaderboard(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let pool = require_db!(state);

    let squad_id = match id.parse::<uuid::Uuid>() {
        Ok(u) => u,
        Err(_) => return (StatusCode::BAD_REQUEST, Json(serde_json::json!({ "error": "Invalid squad id" }))).into_response(),
    };

    let _squad = match db::get_squad(pool, squad_id).await {
        Ok(Some(s)) => s,
        Ok(None) => return (StatusCode::NOT_FOUND, Json(serde_json::json!({ "error": "Squad not found" }))).into_response(),
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    };

    match db::get_squad_leaderboard(pool, squad_id).await {
        Ok(rows) => {
            let entries: Vec<SquadLeaderboardEntryJson> = rows
                .into_iter()
                .enumerate()
                .map(|(i, r)| SquadLeaderboardEntryJson {
                    rank: i + 1,
                    user_id: r.user_id.to_string(),
                    username: r.username,
                    display_name: r.display_name,
                    avatar_url: r.avatar_url,
                    tier: r.tier,
                    lp: r.lp,
                })
                .collect();
            (StatusCode::OK, Json(serde_json::to_value(entries).unwrap())).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

// GET /me/squads — squads the current user belongs to
pub async fn me_squads(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
) -> impl IntoResponse {
    let pool = require_db!(state);
    let user_id = require_user_id!(claims);

    match db::list_my_squads(pool, user_id).await {
        Ok(squads) => {
            let json: Vec<SquadSummaryJson> = squads
                .into_iter()
                .map(|s| SquadSummaryJson {
                    id: s.id.to_string(),
                    name: s.name,
                    invite_code: s.invite_code,
                    topics: s.topics,
                    member_count: s.member_count,
                    created_at: s.created_at.to_rfc3339(),
                })
                .collect();
            (StatusCode::OK, Json(serde_json::to_value(json).unwrap())).into_response()
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, Json(serde_json::json!({ "error": e.to_string() }))).into_response(),
    }
}

// ---------------------------------------------------------------------------
// GET /me/rank
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct MeRankResponse {
    pub tier: String,
    pub lp: i64,
    pub rank_score: i64,
    pub season: String,
    pub season_id: String,
    pub correct_this_season: i64,
    pub attempts_this_season: i64,
    pub accuracy_pct: f64,
}

pub async fn me_rank(
    State(state): State<AppState>,
    AuthUser(claims): AuthUser,
) -> impl IntoResponse {
    let pool = require_db!(state);
    let user_id = require_user_id!(claims);

    let season = match db::get_active_season(pool).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::OK,
                Json(serde_json::json!({
                    "tier": "Tin", "lp": 0, "rank_score": 0,
                    "season": "No active season", "season_id": "",
                    "correct_this_season": 0, "attempts_this_season": 0, "accuracy_pct": 0.0
                })),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    // Fetch the user's best rank across all topics for this season.
    let rank_map = db::get_user_ranks_for_season(pool, season.id, &[user_id])
        .await
        .unwrap_or_default();
    let (tier, lp) = rank_map
        .get(&user_id)
        .cloned()
        .unwrap_or_else(|| ("Tin".to_string(), 0));

    let (total_attempts, correct_count) =
        db::get_all_season_attempt_counts(pool, user_id, season.starts_at, season.ends_at)
            .await
            .unwrap_or((0, 0));

    let accuracy_pct = if total_attempts > 0 {
        (correct_count as f64 / total_attempts as f64 * 1000.0).round() / 10.0
    } else {
        0.0
    };

    let resp = MeRankResponse {
        tier,
        lp,
        rank_score: lp,
        season: season.name.clone(),
        season_id: season.id.to_string(),
        correct_this_season: correct_count,
        attempts_this_season: total_attempts,
        accuracy_pct,
    };

    (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
}

// ---------------------------------------------------------------------------
// GET /leaderboard/ranks
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct RankLeaderboardEntry {
    pub rank: usize,
    pub user: LeaderboardUser,
    pub tier: String,
    pub lp: i64,
    pub correct_this_season: i64,
    pub attempts_this_season: i64,
    pub accuracy_pct: f64,
}

#[derive(Serialize)]
pub struct RankLeaderboardResponse {
    pub season: String,
    pub entries: Vec<RankLeaderboardEntry>,
}

pub async fn leaderboard_ranks(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Query(params): Query<std::collections::HashMap<String, String>>,
) -> impl IntoResponse {
    let topic_filter = params.get("topic").cloned();
    let pool = match &state.db {
        Some(p) => p,
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "Database not configured" })),
            )
                .into_response();
        }
    };

    let season = match db::get_active_season(pool).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::OK,
                Json(serde_json::to_value(RankLeaderboardResponse {
                    season: "No active season".to_string(),
                    entries: vec![],
                }).unwrap()),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    let rows = match db::get_season_rank_leaderboard(pool, season.id, season.starts_at, season.ends_at, 50, topic_filter.as_deref()).await {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    let entries: Vec<RankLeaderboardEntry> = rows
        .into_iter()
        .enumerate()
        .map(|(i, r)| {
            let accuracy_pct = if r.attempts_this_season > 0 {
                (r.correct_this_season as f64 / r.attempts_this_season as f64 * 1000.0).round() / 10.0
            } else {
                0.0
            };
            RankLeaderboardEntry {
                rank: i + 1,
                user: LeaderboardUser {
                    username: r.username,
                    display_name: r.display_name,
                    avatar_url: r.avatar_url,
                },
                tier: r.tier,
                lp: r.lp,
                correct_this_season: r.correct_this_season,
                attempts_this_season: r.attempts_this_season,
                accuracy_pct,
            }
        })
        .collect();

    let response = RankLeaderboardResponse {
        season: season.name,
        entries,
    };

    (StatusCode::OK, Json(serde_json::to_value(response).unwrap())).into_response()
}

// ---------------------------------------------------------------------------
// GET /challenges/today/all
// ---------------------------------------------------------------------------

pub async fn get_today_all(State(state): State<AppState>, AuthUser(_): AuthUser) -> impl IntoResponse {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let mut map = serde_json::Map::new();

    // Include the topics list so the client doesn't need a separate request
    let topics_val = serde_json::to_value(state.topics.as_ref().clone()).unwrap_or_default();
    map.insert("topics".to_string(), topics_val);

    let mut challenges = serde_json::Map::new();
    for topic in state.topics.iter() {
        let challenge = state.challenges.iter().find(|c| {
            c.date == today && c.topic == topic.slug
        });
        let value = match challenge {
            Some(c) => {
                let preview: ChallengePreview = c.into();
                serde_json::to_value(preview).unwrap_or(serde_json::Value::Null)
            }
            None => serde_json::Value::Null,
        };
        challenges.insert(topic.slug.clone(), value);
    }
    map.insert("challenges".to_string(), serde_json::Value::Object(challenges));

    (StatusCode::OK, Json(serde_json::Value::Object(map))).into_response()
}

// ---------------------------------------------------------------------------
// GET /users/search?q=<query>
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct SearchUsersQuery {
    pub q: Option<String>,
}

pub async fn search_users(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Query(params): Query<SearchUsersQuery>,
) -> impl IntoResponse {
    let pool = require_db!(state);
    let q = params.q.unwrap_or_default();
    if q.trim().is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({ "error": "q query param is required" })),
        )
            .into_response();
    }
    match db::search_users(pool, &q).await {
        Ok(users) => {
            let resp: Vec<crate::models::UserResponse> =
                users.into_iter().map(Into::into).collect();
            (StatusCode::OK, Json(serde_json::to_value(resp).unwrap())).into_response()
        }
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}

// ---------------------------------------------------------------------------
// GET /users/:username/ranks
// ---------------------------------------------------------------------------

pub async fn get_user_ranks(
    State(state): State<AppState>,
    AuthUser(_): AuthUser,
    Path(username): Path<String>,
) -> impl IntoResponse {
    let pool = require_db!(state);

    let season = match db::get_active_season(pool).await {
        Ok(Some(s)) => s,
        Ok(None) => {
            return (
                StatusCode::OK,
                Json(serde_json::json!({ "season": null, "ranks": [] })),
            )
                .into_response();
        }
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({ "error": e.to_string() })),
            )
                .into_response();
        }
    };

    match db::get_user_ranks_by_username(pool, &username, season.id).await {
        Ok(ranks) => (StatusCode::OK, Json(serde_json::json!({
            "season": season.name,
            "ranks": ranks,
        })))
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({ "error": e.to_string() })),
        )
            .into_response(),
    }
}
