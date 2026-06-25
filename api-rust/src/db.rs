use sqlx::{PgPool, Row};
use uuid::Uuid;
use chrono::{NaiveDate, Utc};
use rand::Rng;

use crate::models::{User, Streak, Completion, Season, UserRankRow};

// ---------------------------------------------------------------------------
// Schema init
// ---------------------------------------------------------------------------

pub async fn init_db(pool: &PgPool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            github_id BIGINT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            display_name TEXT,
            avatar_url TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS streaks (
            user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            current_streak INT NOT NULL DEFAULT 0,
            longest_streak INT NOT NULL DEFAULT 0,
            last_completed_date DATE,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS completions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            challenge_id TEXT NOT NULL,
            completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            time_ms BIGINT NOT NULL,
            correct BOOLEAN NOT NULL,
            score_pct SMALLINT,
            UNIQUE(user_id, challenge_id)
        )"#,
    )
    .execute(pool)
    .await?;

    // Idempotent migration: add country column if not already present
    sqlx::query(
        "ALTER TABLE completions ADD COLUMN IF NOT EXISTS country TEXT",
    )
    .execute(pool)
    .await?;

    // Index on completions(user_id) for leaderboard performance
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_completions_user_id ON completions(user_id)",
    )
    .execute(pool)
    .await?;

    // ── Squads ───────────────────────────────────────────────────────────────

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS squads (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name TEXT NOT NULL,
            invite_code TEXT UNIQUE NOT NULL,
            created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            topics TEXT[] NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS squad_memberships (
            squad_id UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
            user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            role TEXT NOT NULL DEFAULT 'member',
            joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (squad_id, user_id)
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_squad_memberships_user_id ON squad_memberships(user_id)",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_squad_memberships_squad_id ON squad_memberships(squad_id)",
    )
    .execute(pool)
    .await?;

    // ── Seasons ──────────────────────────────────────────────────────────────

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS seasons (
            id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name      TEXT NOT NULL,
            starts_at TIMESTAMPTZ NOT NULL,
            ends_at   TIMESTAMPTZ NOT NULL,
            UNIQUE(name)
        )"#,
    )
    .execute(pool)
    .await?;

    // Seed Q1-Q4 2026 — safe to re-run (ON CONFLICT DO NOTHING)
    sqlx::query(
        r#"INSERT INTO seasons (name, starts_at, ends_at) VALUES
            ('Q1 2026', '2026-01-01T00:00:00Z', '2026-04-01T00:00:00Z'),
            ('Q2 2026', '2026-04-01T00:00:00Z', '2026-07-01T00:00:00Z'),
            ('Q3 2026', '2026-07-01T00:00:00Z', '2026-10-01T00:00:00Z'),
            ('Q4 2026', '2026-10-01T00:00:00Z', '2027-01-01T00:00:00Z')
        ON CONFLICT (name) DO NOTHING"#,
    )
    .execute(pool)
    .await?;

    // ── User Ranks ───────────────────────────────────────────────────────────

    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS user_ranks (
            user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            season_id  UUID NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
            topic      TEXT NOT NULL DEFAULT '',
            lp         BIGINT NOT NULL DEFAULT 0,
            tier       TEXT NOT NULL DEFAULT 'Tin',
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, season_id, topic)
        )"#,
    )
    .execute(pool)
    .await?;

    // Add topic column to existing tables that predate this migration
    let _ = sqlx::query(
        "ALTER TABLE user_ranks ADD COLUMN IF NOT EXISTS topic TEXT NOT NULL DEFAULT ''"
    )
    .execute(pool)
    .await;
    // Drop old PK if it only covers (user_id, season_id) and recreate
    let _ = sqlx::query(
        r#"DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'user_ranks_pkey'
                  AND conrelid = 'user_ranks'::regclass
                  AND array_length(conkey, 1) = 2
            ) THEN
                ALTER TABLE user_ranks DROP CONSTRAINT user_ranks_pkey;
                ALTER TABLE user_ranks ADD PRIMARY KEY (user_id, season_id, topic);
            END IF;
        END$$"#
    )
    .execute(pool)
    .await;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_user_ranks_season_lp ON user_ranks(season_id, lp DESC)",
    )
    .execute(pool)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/// Upsert a GitHub user; returns the User row.
pub async fn upsert_user(
    pool: &PgPool,
    github_id: i64,
    username: &str,
    display_name: Option<&str>,
    avatar_url: Option<&str>,
) -> Result<User, sqlx::Error> {
    let row = sqlx::query(
        r#"
        INSERT INTO users (github_id, username, display_name, avatar_url)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (github_id) DO UPDATE
            SET username     = EXCLUDED.username,
                display_name = EXCLUDED.display_name,
                avatar_url   = EXCLUDED.avatar_url
        RETURNING id, github_id, username, display_name, avatar_url, created_at
        "#,
    )
    .bind(github_id)
    .bind(username)
    .bind(display_name)
    .bind(avatar_url)
    .fetch_one(pool)
    .await?;

    Ok(User {
        id: row.get("id"),
        github_id: row.get("github_id"),
        username: row.get("username"),
        display_name: row.get("display_name"),
        avatar_url: row.get("avatar_url"),
        created_at: row.get("created_at"),
    })
}

/// Fetch a user by their internal UUID.
pub async fn get_user_by_id(pool: &PgPool, id: Uuid) -> Result<Option<User>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, github_id, username, display_name, avatar_url, created_at FROM users WHERE id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| User {
        id: r.get("id"),
        github_id: r.get("github_id"),
        username: r.get("username"),
        display_name: r.get("display_name"),
        avatar_url: r.get("avatar_url"),
        created_at: r.get("created_at"),
    }))
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

pub async fn get_streak(pool: &PgPool, user_id: Uuid) -> Result<Streak, sqlx::Error> {
    // Ensure a default row exists.
    sqlx::query(
        "INSERT INTO streaks (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
    )
    .bind(user_id)
    .execute(pool)
    .await?;

    let row = sqlx::query(
        "SELECT user_id, current_streak, longest_streak, last_completed_date, updated_at FROM streaks WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    Ok(Streak {
        user_id: row.get("user_id"),
        current_streak: row.get("current_streak"),
        longest_streak: row.get("longest_streak"),
        last_completed_date: row.get("last_completed_date"),
        updated_at: row.get("updated_at"),
    })
}

/// Increment the streak for today (idempotent — calling twice on the same date is a no-op).
pub async fn increment_streak(
    pool: &PgPool,
    user_id: Uuid,
    today: NaiveDate,
) -> Result<Streak, sqlx::Error> {
    // Ensure the row exists.
    sqlx::query("INSERT INTO streaks (user_id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(user_id)
        .execute(pool)
        .await?;

    // Read current state.
    let row = sqlx::query(
        "SELECT current_streak, longest_streak, last_completed_date FROM streaks WHERE user_id = $1",
    )
    .bind(user_id)
    .fetch_one(pool)
    .await?;

    let current: i32 = row.get("current_streak");
    let longest: i32 = row.get("longest_streak");
    let last_date: Option<NaiveDate> = row.get("last_completed_date");

    // Idempotency: if already recorded for today, just return.
    if last_date == Some(today) {
        let s = get_streak(pool, user_id).await?;
        return Ok(s);
    }

    let yesterday = today.pred_opt().unwrap_or(today);
    let new_streak = if last_date == Some(yesterday) {
        current + 1
    } else {
        1
    };
    let new_longest = new_streak.max(longest);

    let updated = sqlx::query(
        r#"
        UPDATE streaks
        SET current_streak      = $2,
            longest_streak      = $3,
            last_completed_date = $4,
            updated_at          = NOW()
        WHERE user_id = $1
        RETURNING user_id, current_streak, longest_streak, last_completed_date, updated_at
        "#,
    )
    .bind(user_id)
    .bind(new_streak)
    .bind(new_longest)
    .bind(today)
    .fetch_one(pool)
    .await?;

    Ok(Streak {
        user_id: updated.get("user_id"),
        current_streak: updated.get("current_streak"),
        longest_streak: updated.get("longest_streak"),
        last_completed_date: updated.get("last_completed_date"),
        updated_at: updated.get("updated_at"),
    })
}

// ---------------------------------------------------------------------------
// Streak reset (cron)
// ---------------------------------------------------------------------------

/// Resets `current_streak` to 0 for every user whose `last_completed_date` is
/// before yesterday.  Called once per day by the cron job so that streaks are
/// zeroed even if the user never opens the app.  Returns the number of rows
/// updated.
pub async fn reset_broken_streaks(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let yesterday = chrono::Utc::now().date_naive().pred_opt().unwrap();
    let result = sqlx::query(
        r#"
        UPDATE streaks
        SET current_streak = 0,
            updated_at     = NOW()
        WHERE current_streak > 0
          AND last_completed_date < $1
        "#,
    )
    .bind(yesterday)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

pub async fn record_completion(
    pool: &PgPool,
    user_id: Uuid,
    challenge_id: &str,
    time_ms: i64,
    correct: bool,
    score_pct: Option<i16>,
    country: Option<&str>,
) -> Result<Completion, sqlx::Error> {
    let row = sqlx::query(
        r#"
        INSERT INTO completions (user_id, challenge_id, time_ms, correct, score_pct, country)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, challenge_id) DO UPDATE
            SET time_ms      = EXCLUDED.time_ms,
                correct      = EXCLUDED.correct,
                score_pct    = EXCLUDED.score_pct,
                country      = EXCLUDED.country,
                completed_at = NOW()
        RETURNING id, user_id, challenge_id, completed_at, time_ms, correct, score_pct
        "#,
    )
    .bind(user_id)
    .bind(challenge_id)
    .bind(time_ms)
    .bind(correct)
    .bind(score_pct)
    .bind(country)
    .fetch_one(pool)
    .await?;

    Ok(Completion {
        id: row.get("id"),
        user_id: row.get("user_id"),
        challenge_id: row.get("challenge_id"),
        completed_at: row.get("completed_at"),
        time_ms: row.get("time_ms"),
        correct: row.get("correct"),
        score_pct: row.get("score_pct"),
    })
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

pub struct StreakLeaderboardRow {
    pub user_id: uuid::Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub current_streak: i32,
    pub longest_streak: i32,
}

pub struct CompletionLeaderboardRow {
    pub user_id: uuid::Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub challenge_id: String,
    pub correct: bool,
    pub time_ms: i64,
}

pub async fn get_leaderboard_streaks(
    pool: &PgPool,
    limit: i64,
) -> Result<Vec<StreakLeaderboardRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url,
               s.current_streak, s.longest_streak
        FROM users u
        JOIN streaks s ON s.user_id = u.id
        WHERE s.current_streak > 0
        ORDER BY s.current_streak DESC, s.longest_streak DESC
        LIMIT $1
        "#,
    )
    .bind(limit)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| StreakLeaderboardRow {
            user_id: r.get("user_id"),
            username: r.get("username"),
            display_name: r.get("display_name"),
            avatar_url: r.get("avatar_url"),
            current_streak: r.get("current_streak"),
            longest_streak: r.get("longest_streak"),
        })
        .collect())
}

pub async fn get_all_completions_with_users(
    pool: &PgPool,
) -> Result<Vec<CompletionLeaderboardRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT c.user_id, u.username, u.display_name, u.avatar_url,
               c.challenge_id, c.correct, c.time_ms
        FROM completions c
        JOIN users u ON u.id = c.user_id
        "#,
    )
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| CompletionLeaderboardRow {
            user_id: r.get("user_id"),
            username: r.get("username"),
            display_name: r.get("display_name"),
            avatar_url: r.get("avatar_url"),
            challenge_id: r.get("challenge_id"),
            correct: r.get("correct"),
            time_ms: r.get("time_ms"),
        })
        .collect())
}

/// Aggregate stats for a single challenge across all logged-in users.
pub async fn get_challenge_stats(
    pool: &PgPool,
    challenge_id: &str,
    user_time_ms: Option<i64>,
    user_correct: bool,
    country: Option<&str>,
) -> Result<crate::routes::ChallengeStats, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            COUNT(*)::BIGINT                                                        AS total_attempts,
            COALESCE(AVG(CASE WHEN correct THEN 100.0 ELSE 0.0 END), 0.0)::FLOAT8  AS correct_pct,
            COALESCE(AVG(time_ms), 0.0)::FLOAT8                                    AS avg_time_ms
        FROM completions
        WHERE challenge_id = $1
        "#,
    )
    .bind(challenge_id)
    .fetch_one(pool)
    .await?;

    let total_attempts: i64 = row.get::<i64, _>("total_attempts");
    let correct_pct: f64    = row.get::<f64, _>("correct_pct");
    let avg_time_ms: f64    = row.get::<f64, _>("avg_time_ms");

    // Compute percentile + absolute beat count when user answered correctly
    let (faster_than_pct, faster_than_count) = if user_correct {
        if let Some(user_ms) = user_time_ms {
            let pct_row = sqlx::query(
                r#"
                SELECT
                    COUNT(*) FILTER (WHERE time_ms > $2 AND correct = true)::BIGINT  AS faster_count,
                    (COUNT(*) FILTER (WHERE time_ms > $2 AND correct = true)::FLOAT8 /
                     NULLIF(COUNT(*) FILTER (WHERE correct = true), 0)::FLOAT8 * 100.0) AS faster_pct
                FROM completions
                WHERE challenge_id = $1
                "#,
            )
            .bind(challenge_id)
            .bind(user_ms)
            .fetch_one(pool)
            .await?;

            let count: i64 = pct_row.get("faster_count");
            let raw_pct: Option<f64> = pct_row.get("faster_pct");
            let pct = raw_pct.map(|v| (v * 10.0).round() / 10.0);
            (pct, Some(count))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    // Country-scoped percentile (only when we have country + user answered correctly + time provided)
    let (country_faster_than_pct, country_total) =
        if user_correct && user_time_ms.is_some() {
            if let Some(cc) = country {
                let user_ms = user_time_ms.unwrap();
                let c_row = sqlx::query(
                    r#"
                    SELECT
                        COUNT(*) FILTER (WHERE correct = true AND country = $3)::BIGINT AS c_total,
                        (COUNT(*) FILTER (WHERE time_ms > $2 AND correct = true AND country = $3)::FLOAT8 /
                         NULLIF(COUNT(*) FILTER (WHERE correct = true AND country = $3), 0)::FLOAT8 * 100.0) AS c_faster_pct
                    FROM completions
                    WHERE challenge_id = $1
                    "#,
                )
                .bind(challenge_id)
                .bind(user_ms)
                .bind(cc)
                .fetch_one(pool)
                .await?;

                let c_total: i64 = c_row.get("c_total");
                let c_pct_raw: Option<f64> = c_row.get("c_faster_pct");
                let c_pct = c_pct_raw.map(|v| (v * 10.0).round() / 10.0);
                // Only meaningful if there are at least 2 completions from that country
                if c_total >= 2 {
                    (c_pct, Some(c_total))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            }
        } else {
            (None, None)
        };

    Ok(crate::routes::ChallengeStats {
        total_attempts,
        correct_pct,
        avg_time_ms,
        faster_than_pct,
        faster_than_count,
        country: country.map(|s| s.to_string()),
        country_faster_than_pct,
        country_total,
    })
}

pub async fn get_today_completions(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<Completion>, sqlx::Error> {
    let today = Utc::now().date_naive();
    let rows = sqlx::query(
        r#"
        SELECT id, user_id, challenge_id, completed_at, time_ms, correct, score_pct
        FROM completions
        WHERE user_id = $1
          AND completed_at::date = $2
        ORDER BY completed_at DESC
        "#,
    )
    .bind(user_id)
    .bind(today)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| Completion {
            id: r.get("id"),
            user_id: r.get("user_id"),
            challenge_id: r.get("challenge_id"),
            completed_at: r.get("completed_at"),
            time_ms: r.get("time_ms"),
            correct: r.get("correct"),
            score_pct: r.get("score_pct"),
        })
        .collect())
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

pub struct SquadRow {
    pub id: Uuid,
    pub name: String,
    pub invite_code: String,
    pub created_by: Uuid,
    pub topics: Vec<String>,
    pub created_at: chrono::DateTime<Utc>,
}

pub struct SquadMemberRow {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub role: String,
    pub joined_at: chrono::DateTime<Utc>,
}

pub struct SquadLeaderboardRow {
    pub user_id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub tier: String,
    pub lp: i64,
}

fn generate_invite_code() -> String {
    let mut rng = rand::thread_rng();
    // 10 alphanumeric characters (36^10 ≈ 3.7 trillion combinations)
    // makes brute-force infeasible even without rate limiting.
    (0..10)
        .map(|_| {
            let idx = rng.gen_range(0..36usize);
            if idx < 10 {
                (b'0' + idx as u8) as char
            } else {
                (b'A' + idx as u8 - 10) as char
            }
        })
        .collect()
}

pub async fn create_squad(
    pool: &PgPool,
    name: &str,
    topics: &[String],
    created_by: Uuid,
) -> Result<SquadRow, sqlx::Error> {
    // Retry up to 5 times on invite_code collision
    for _ in 0..5 {
        let code = generate_invite_code();
        let result = sqlx::query(
            r#"
            INSERT INTO squads (name, invite_code, created_by, topics)
            VALUES ($1, $2, $3, $4)
            RETURNING id, name, invite_code, created_by, topics, created_at
            "#,
        )
        .bind(name)
        .bind(&code)
        .bind(created_by)
        .bind(topics)
        .fetch_one(pool)
        .await;

        match result {
            Ok(row) => {
                let squad = SquadRow {
                    id: row.get("id"),
                    name: row.get("name"),
                    invite_code: row.get("invite_code"),
                    created_by: row.get("created_by"),
                    topics: row.get("topics"),
                    created_at: row.get("created_at"),
                };
                // Add creator as admin
                sqlx::query(
                    "INSERT INTO squad_memberships (squad_id, user_id, role) VALUES ($1, $2, 'admin') ON CONFLICT DO NOTHING",
                )
                .bind(squad.id)
                .bind(created_by)
                .execute(pool)
                .await?;
                return Ok(squad);
            }
            Err(e) => {
                // Check for unique constraint violation on invite_code
                if e.to_string().contains("invite_code") {
                    continue;
                }
                return Err(e);
            }
        }
    }
    Err(sqlx::Error::Protocol("Failed to generate unique invite code after 5 attempts".into()))
}

pub async fn get_squad(pool: &PgPool, squad_id: Uuid) -> Result<Option<SquadRow>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, name, invite_code, created_by, topics, created_at FROM squads WHERE id = $1",
    )
    .bind(squad_id)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| SquadRow {
        id: r.get("id"),
        name: r.get("name"),
        invite_code: r.get("invite_code"),
        created_by: r.get("created_by"),
        topics: r.get("topics"),
        created_at: r.get("created_at"),
    }))
}

pub async fn get_squad_by_invite_code(pool: &PgPool, code: &str) -> Result<Option<SquadRow>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT id, name, invite_code, created_by, topics, created_at FROM squads WHERE invite_code = $1",
    )
    .bind(code)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| SquadRow {
        id: r.get("id"),
        name: r.get("name"),
        invite_code: r.get("invite_code"),
        created_by: r.get("created_by"),
        topics: r.get("topics"),
        created_at: r.get("created_at"),
    }))
}

pub async fn get_squad_members(pool: &PgPool, squad_id: Uuid) -> Result<Vec<SquadMemberRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url,
               sm.role, sm.joined_at
        FROM squad_memberships sm
        JOIN users u ON u.id = sm.user_id
        WHERE sm.squad_id = $1
        ORDER BY sm.joined_at ASC
        "#,
    )
    .bind(squad_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SquadMemberRow {
            user_id: r.get("user_id"),
            username: r.get("username"),
            display_name: r.get("display_name"),
            avatar_url: r.get("avatar_url"),
            role: r.get("role"),
            joined_at: r.get("joined_at"),
        })
        .collect())
}

pub async fn is_squad_member(pool: &PgPool, squad_id: Uuid, user_id: Uuid) -> Result<bool, sqlx::Error> {
    let row = sqlx::query(
        "SELECT 1 FROM squad_memberships WHERE squad_id = $1 AND user_id = $2",
    )
    .bind(squad_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.is_some())
}

/// Join a squad by invite_code. Idempotent — already a member = OK.
pub async fn join_squad(pool: &PgPool, invite_code: &str, user_id: Uuid) -> Result<Option<SquadRow>, sqlx::Error> {
    let squad = match get_squad_by_invite_code(pool, invite_code).await? {
        Some(s) => s,
        None => return Ok(None),
    };

    sqlx::query(
        "INSERT INTO squad_memberships (squad_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
    )
    .bind(squad.id)
    .bind(user_id)
    .execute(pool)
    .await?;

    Ok(Some(squad))
}

/// Leave a squad. If the user was the last member, delete the squad.
pub async fn leave_squad(pool: &PgPool, squad_id: Uuid, user_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query(
        "DELETE FROM squad_memberships WHERE squad_id = $1 AND user_id = $2",
    )
    .bind(squad_id)
    .bind(user_id)
    .execute(pool)
    .await?;

    // Check if any members remain
    let count_row = sqlx::query(
        "SELECT COUNT(*)::BIGINT AS cnt FROM squad_memberships WHERE squad_id = $1",
    )
    .bind(squad_id)
    .fetch_one(pool)
    .await?;
    let cnt: i64 = count_row.get("cnt");
    if cnt == 0 {
        sqlx::query("DELETE FROM squads WHERE id = $1")
            .bind(squad_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

pub async fn get_squad_leaderboard(
    pool: &PgPool,
    squad_id: Uuid,
) -> Result<Vec<SquadLeaderboardRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT u.id AS user_id, u.username, u.display_name, u.avatar_url,
            COALESCE(ur.tier, 'Tin') AS tier,
            COALESCE(ur.lp, 0)      AS lp
        FROM users u
        JOIN squad_memberships sm ON sm.user_id = u.id AND sm.squad_id = $1
        LEFT JOIN seasons s ON s.starts_at <= NOW() AND s.ends_at > NOW()
        LEFT JOIN user_ranks ur ON ur.user_id = u.id AND ur.season_id = s.id
        ORDER BY COALESCE(ur.lp, 0) DESC
        "#,
    )
    .bind(squad_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| SquadLeaderboardRow {
            user_id: r.get("user_id"),
            username: r.get("username"),
            display_name: r.get("display_name"),
            avatar_url: r.get("avatar_url"),
            tier: r.get("tier"),
            lp: r.get("lp"),
        })
        .collect())
}

pub struct MySquadSummary {
    pub id: Uuid,
    pub name: String,
    pub invite_code: String,
    pub topics: Vec<String>,
    pub member_count: i64,
    pub created_at: chrono::DateTime<Utc>,
}

pub async fn list_my_squads(
    pool: &PgPool,
    user_id: Uuid,
) -> Result<Vec<MySquadSummary>, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT s.id, s.name, s.invite_code, s.topics, s.created_at,
               COUNT(sm2.user_id)::BIGINT AS member_count
        FROM squads s
        JOIN squad_memberships sm ON sm.squad_id = s.id AND sm.user_id = $1
        JOIN squad_memberships sm2 ON sm2.squad_id = s.id
        GROUP BY s.id, s.name, s.invite_code, s.topics, s.created_at
        ORDER BY s.created_at DESC
        "#,
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;

    let mut summaries = Vec::with_capacity(rows.len());
    for r in rows {
        summaries.push(MySquadSummary {
            id: r.get("id"),
            name: r.get("name"),
            invite_code: r.get("invite_code"),
            topics: r.get("topics"),
            member_count: r.get("member_count"),
            created_at: r.get("created_at"),
        });
    }
    Ok(summaries)
}

// ---------------------------------------------------------------------------
// Rank / Season helpers
// ---------------------------------------------------------------------------

/// Return the season whose window contains NOW(), or None if no season is
/// currently active.
pub async fn get_active_season(pool: &PgPool) -> Result<Option<Season>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT id, name, starts_at, ends_at
        FROM seasons
        WHERE starts_at <= NOW() AND ends_at > NOW()
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| Season {
        id: r.get("id"),
        name: r.get("name"),
        starts_at: r.get("starts_at"),
        ends_at: r.get("ends_at"),
    }))
}

/// Return the user_ranks row for (user_id, season_id, topic), or None.
pub async fn get_user_rank(
    pool: &PgPool,
    user_id: Uuid,
    season_id: Uuid,
    topic: &str,
) -> Result<Option<UserRankRow>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT user_id, season_id, topic, lp, tier, updated_at
        FROM user_ranks
        WHERE user_id = $1 AND season_id = $2 AND topic = $3
        "#,
    )
    .bind(user_id)
    .bind(season_id)
    .bind(topic)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| UserRankRow {
        user_id: r.get("user_id"),
        season_id: r.get("season_id"),
        topic: r.get("topic"),
        lp: r.get("lp"),
        tier: r.get("tier"),
        updated_at: r.get("updated_at"),
    }))
}

/// Upsert (insert or update) a user_ranks row with the given lp and tier.
pub async fn upsert_user_rank(
    pool: &PgPool,
    user_id: Uuid,
    season_id: Uuid,
    topic: &str,
    lp: i64,
    tier: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO user_ranks (user_id, season_id, topic, lp, tier, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (user_id, season_id, topic)
        DO UPDATE SET lp = EXCLUDED.lp, tier = EXCLUDED.tier, updated_at = NOW()
        "#,
    )
    .bind(user_id)
    .bind(season_id)
    .bind(topic)
    .bind(lp)
    .bind(tier)
    .execute(pool)
    .await?;
    Ok(())
}

/// Compute season_points for a user within a season window, filtered by topic.
pub async fn get_season_points(
    pool: &PgPool,
    user_id: Uuid,
    topic: &str,
    season_starts_at: chrono::DateTime<Utc>,
    season_ends_at: chrono::DateTime<Utc>,
) -> Result<i64, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT COALESCE(SUM(
            CASE WHEN c.correct
            THEN 100 + GREATEST(0, 50 - FLOOR(c.time_ms::float8 / 1000)::int)
            ELSE 0 END
        ), 0)::BIGINT AS pts
        FROM completions c
        JOIN challenges ch ON ch.id = c.challenge_id
        WHERE c.user_id = $1
          AND ch.topic = $2
          AND c.completed_at >= $3
          AND c.completed_at < $4
          AND c.correct = true
        "#,
    )
    .bind(user_id)
    .bind(topic)
    .bind(season_starts_at)
    .bind(season_ends_at)
    .fetch_one(pool)
    .await?;
    Ok(row.get("pts"))
}

/// Count total and correct attempts for a user within a season window, filtered by topic.
pub async fn get_season_attempt_counts(
    pool: &PgPool,
    user_id: Uuid,
    topic: &str,
    season_starts_at: chrono::DateTime<Utc>,
    season_ends_at: chrono::DateTime<Utc>,
) -> Result<(i64, i64), sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            COUNT(*) AS total_attempts,
            COUNT(*) FILTER (WHERE c.correct) AS correct_count
        FROM completions c
        JOIN challenges ch ON ch.id = c.challenge_id
        WHERE c.user_id = $1
          AND ch.topic = $2
          AND c.completed_at >= $3
          AND c.completed_at < $4
        "#,
    )
    .bind(user_id)
    .bind(topic)
    .bind(season_starts_at)
    .bind(season_ends_at)
    .fetch_one(pool)
    .await?;
    let total: i64 = row.get("total_attempts");
    let correct: i64 = row.get("correct_count");
    Ok((total, correct))
}

/// Count total and correct attempts for a user within a season window, across ALL topics.
pub async fn get_all_season_attempt_counts(
    pool: &PgPool,
    user_id: Uuid,
    season_starts_at: chrono::DateTime<Utc>,
    season_ends_at: chrono::DateTime<Utc>,
) -> Result<(i64, i64), sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT
            COUNT(*) AS total_attempts,
            COUNT(*) FILTER (WHERE correct) AS correct_count
        FROM completions
        WHERE user_id = $1
          AND completed_at >= $2
          AND completed_at < $3
        "#,
    )
    .bind(user_id)
    .bind(season_starts_at)
    .bind(season_ends_at)
    .fetch_one(pool)
    .await?;
    let total: i64 = row.get("total_attempts");
    let correct: i64 = row.get("correct_count");
    Ok((total, correct))
}

pub struct RankLeaderboardRow {
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub lp: i64,
    pub tier: String,
    pub correct_this_season: i64,
    pub attempts_this_season: i64,
}

/// Return the top-N users by LP for a given season.
/// If `topic` is Some, filter to that specific topic; otherwise take each user's best LP across all topics.
pub async fn get_season_rank_leaderboard(
    pool: &PgPool,
    season_id: Uuid,
    season_starts_at: chrono::DateTime<Utc>,
    season_ends_at: chrono::DateTime<Utc>,
    limit: i64,
    topic: Option<&str>,
) -> Result<Vec<RankLeaderboardRow>, sqlx::Error> {
    let rows = if let Some(topic_slug) = topic {
        sqlx::query(
            r#"
            SELECT
                u.username,
                u.display_name,
                u.avatar_url,
                ur.lp          AS lp,
                ur.tier        AS tier,
                COUNT(c.id) FILTER (WHERE c.correct)  AS correct_this_season,
                COUNT(c.id)                            AS attempts_this_season
            FROM user_ranks ur
            JOIN users u ON u.id = ur.user_id
            LEFT JOIN completions c
                ON c.user_id = ur.user_id
               AND c.completed_at >= $2
               AND c.completed_at < $3
            WHERE ur.season_id = $1 AND ur.topic = $5
            GROUP BY u.id, u.username, u.display_name, u.avatar_url, ur.lp, ur.tier
            ORDER BY ur.lp DESC
            LIMIT $4
            "#,
        )
        .bind(season_id)
        .bind(season_starts_at)
        .bind(season_ends_at)
        .bind(limit)
        .bind(topic_slug)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query(
            r#"
            SELECT
                u.username,
                u.display_name,
                u.avatar_url,
                MAX(ur.lp)   AS lp,
                (array_agg(ur.tier ORDER BY ur.lp DESC))[1] AS tier,
                COUNT(c.id) FILTER (WHERE c.correct)  AS correct_this_season,
                COUNT(c.id)                            AS attempts_this_season
            FROM user_ranks ur
            JOIN users u ON u.id = ur.user_id
            LEFT JOIN completions c
                ON c.user_id = ur.user_id
               AND c.completed_at >= $2
               AND c.completed_at < $3
            WHERE ur.season_id = $1
            GROUP BY u.id, u.username, u.display_name, u.avatar_url
            ORDER BY MAX(ur.lp) DESC
            LIMIT $4
            "#,
        )
        .bind(season_id)
        .bind(season_starts_at)
        .bind(season_ends_at)
        .bind(limit)
        .fetch_all(pool)
        .await?
    };

    Ok(rows
        .into_iter()
        .map(|r| RankLeaderboardRow {
            username: r.get("username"),
            display_name: r.get("display_name"),
            avatar_url: r.get("avatar_url"),
            lp: r.get("lp"),
            tier: r.get("tier"),
            correct_this_season: r.get("correct_this_season"),
            attempts_this_season: r.get("attempts_this_season"),
        })
        .collect())
}

/// Return the best (tier, lp) for a set of user_ids in a season (MAX lp across topics).
/// Used to augment existing leaderboard entries with rank data.
pub async fn get_user_ranks_for_season(
    pool: &PgPool,
    season_id: Uuid,
    user_ids: &[Uuid],
) -> Result<std::collections::HashMap<Uuid, (String, i64)>, sqlx::Error> {
    if user_ids.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let rows = sqlx::query(
        r#"
        SELECT user_id,
               MAX(lp) AS lp,
               (array_agg(tier ORDER BY lp DESC))[1] AS tier
        FROM user_ranks
        WHERE season_id = $1 AND user_id = ANY($2)
        GROUP BY user_id
        "#,
    )
    .bind(season_id)
    .bind(user_ids)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| {
            let uid: Uuid = r.get("user_id");
            let tier: String = r.get("tier");
            let lp: i64 = r.get("lp");
            (uid, (tier, lp))
        })
        .collect())
}

/// Search users by username prefix (case-insensitive), limit 20.
pub async fn search_users(pool: &PgPool, q: &str) -> Result<Vec<crate::models::User>, sqlx::Error> {
    let pattern = format!("%{}%", q);
    let rows = sqlx::query(
        r#"SELECT id, github_id, username, display_name, avatar_url, created_at
           FROM users
           WHERE username ILIKE $1
           ORDER BY username
           LIMIT 20"#,
    )
    .bind(&pattern)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| crate::models::User {
            id: r.get("id"),
            github_id: r.get("github_id"),
            username: r.get("username"),
            display_name: r.get("display_name"),
            avatar_url: r.get("avatar_url"),
            created_at: r.get("created_at"),
        })
        .collect())
}

/// Look up a user by their username.
pub async fn get_user_by_username(pool: &PgPool, username: &str) -> Result<Option<crate::models::User>, sqlx::Error> {
    let row = sqlx::query(
        r#"SELECT id, github_id, username, display_name, avatar_url, created_at
           FROM users WHERE username = $1"#,
    )
    .bind(username)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(|r| crate::models::User {
        id: r.get("id"),
        github_id: r.get("github_id"),
        username: r.get("username"),
        display_name: r.get("display_name"),
        avatar_url: r.get("avatar_url"),
        created_at: r.get("created_at"),
    }))
}

/// Get all user_ranks rows for a user in a given season.
pub async fn get_user_ranks_by_username(
    pool: &PgPool,
    username: &str,
    season_id: Uuid,
) -> Result<Vec<crate::models::UserRankRow>, sqlx::Error> {
    let rows = sqlx::query(
        r#"SELECT ur.user_id, ur.season_id, ur.topic, ur.lp, ur.tier, ur.updated_at
           FROM user_ranks ur
           JOIN users u ON u.id = ur.user_id
           WHERE u.username = $1 AND ur.season_id = $2"#,
    )
    .bind(username)
    .bind(season_id)
    .fetch_all(pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|r| crate::models::UserRankRow {
            user_id: r.get("user_id"),
            season_id: r.get("season_id"),
            topic: r.get("topic"),
            lp: r.get("lp"),
            tier: r.get("tier"),
            updated_at: r.get("updated_at"),
        })
        .collect())
}
