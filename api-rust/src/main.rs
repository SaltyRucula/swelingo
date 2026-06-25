use swe_duolingo_api::routes::AppState;
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    let database_url = std::env::var("DATABASE_URL").ok();

    let state = if let Some(url) = database_url {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await
            .expect("Failed to connect to PostgreSQL");

        swe_duolingo_api::db::init_db(&pool)
            .await
            .expect("Failed to initialise database schema");

        println!("Connected to PostgreSQL");
        AppState::new_with_db(pool)
    } else {
        println!("No DATABASE_URL set — running without database (auth disabled)");
        AppState::new()
    };

    let app = swe_duolingo_api::build_router(state);
    let port = std::env::var("PORT").unwrap_or_else(|_| "3001".to_string());
    let addr = format!("0.0.0.0:{}", port);
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    println!("swe-duolingo API listening on http://{}", addr);
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await.unwrap();
}

#[cfg(test)]
mod tests {
    use axum_test::TestServer;
    use serde_json::{json, Value};

    const TEST_SECRET: &str = "test-secret";

    fn server() -> TestServer {
        TestServer::new(swe_duolingo_api::build_app()).unwrap()
    }

    fn test_auth_header() -> String {
        let token = swe_duolingo_api::auth::sign_jwt(uuid::Uuid::new_v4(), TEST_SECRET).unwrap();
        format!("Bearer {}", token)
    }

    // -----------------------------------------------------------------------
    // GET / — index
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn index_returns_ok_with_name_and_endpoints() {
        let server = server();
        let res = server.get("/").await;
        res.assert_status_ok();
        let body: Value = res.json();
        assert_eq!(body["name"], "swe-duolingo API");
    }

    // -----------------------------------------------------------------------
    // GET /challenges/topics
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn topics_returns_array_with_slug_and_display_name() {
        let server = server();
        let res = server.get("/challenges/topics")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        res.assert_status_ok();
        let body: Value = res.json();
        let arr = body.as_array().unwrap();
        assert!(!arr.is_empty());
        assert!(arr[0].get("slug").is_some());
        assert!(arr[0].get("display_name").is_some());
    }

    #[tokio::test]
    async fn topics_returns_all_known_slugs() {
        let server = server();
        let res = server.get("/challenges/topics")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        res.assert_status_ok();
        let body: Value = res.json();
        let slugs: Vec<&str> = body
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|t| t["slug"].as_str())
            .collect();
        for expected in &["frontend", "backend", "devops", "data", "software", "ai", "dsa"] {
            assert!(slugs.contains(expected), "missing topic slug: {}", expected);
        }
    }

    // -----------------------------------------------------------------------
    // GET /challenges/today
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn today_returns_401_when_no_auth() {
        let server = server();
        let res = server.get("/challenges/today").await;
        assert_eq!(res.status_code(), axum::http::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn today_returns_400_when_topic_missing() {
        let server = server();
        let res = server.get("/challenges/today")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        res.assert_status_bad_request();
    }

    #[tokio::test]
    async fn today_returns_error_when_topic_is_empty_string() {
        let server = server();
        let res = server.get("/challenges/today?topic=")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        let status = res.status_code().as_u16();
        assert!(status == 400 || status == 404, "expected 400 or 404, got {}", status);
    }

    #[tokio::test]
    async fn today_returns_404_for_unknown_topic() {
        let server = server();
        let res = server.get("/challenges/today?topic=nonexistent-topic")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        res.assert_status_not_found();
    }

    #[tokio::test]
    async fn today_date_format_is_yyyy_mm_dd() {
        let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
        assert_eq!(today.len(), 10, "date must be exactly 10 chars");
        assert_eq!(&today[4..5], "-", "char at index 4 must be '-'");
        assert_eq!(&today[7..8], "-", "char at index 7 must be '-'");
        assert!(today[0..4].chars().all(|c| c.is_ascii_digit()));
        assert!(today[5..7].chars().all(|c| c.is_ascii_digit()));
        assert!(today[8..10].chars().all(|c| c.is_ascii_digit()));
    }

    #[tokio::test]
    async fn today_does_not_expose_correct_answer() {
        use swe_duolingo_api::data::topics as seed_topics;
        use axum::http::StatusCode;
        let server = server();

        for topic in seed_topics() {
            let res = server
                .get(&format!("/challenges/today?topic={}", topic.slug))
                .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
                .await;
            if res.status_code() == StatusCode::OK {
                let body: Value = res.json();
                assert!(body.get("correct_answer").is_none(), "correct_answer must not be exposed");
                assert!(body.get("explanation").is_none(), "explanation must not be exposed");
                assert!(body.get("id").is_some(), "id must be present");
                assert!(body.get("options").is_some(), "options must be present");
                assert!(body.get("prompt").is_some(), "prompt must be present");
                assert!(body.get("difficulty").is_some(), "difficulty must be present");
                return;
            }
        }
    }

    #[tokio::test]
    async fn today_never_returns_5xx_for_any_topic() {
        use swe_duolingo_api::data::topics as seed_topics;
        let server = server();
        for topic in seed_topics() {
            let res = server
                .get(&format!("/challenges/today?topic={}", topic.slug))
                .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
                .await;
            let status = res.status_code().as_u16();
            assert!(status < 500, "topic {} returned server error {}", topic.slug, status);
        }
    }

    // -----------------------------------------------------------------------
    // GET /challenges/today/all
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn today_all_returns_ok() {
        let server = server();
        let res = server.get("/challenges/today/all")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        res.assert_status_ok();
    }

    #[tokio::test]
    async fn today_all_returns_object_keyed_by_topic_slug() {
        use swe_duolingo_api::data::topics as seed_topics;
        let server = server();
        let res = server.get("/challenges/today/all")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        res.assert_status_ok();
        let body: Value = res.json();
        let root = body.as_object().expect("today/all must return a JSON object");
        assert!(root.contains_key("topics"), "response must contain 'topics'");
        assert!(root.contains_key("challenges"), "response must contain 'challenges'");
        let challenges = root["challenges"].as_object().expect("challenges must be an object");
        for topic in seed_topics() {
            assert!(challenges.contains_key(&topic.slug), "missing key '{}' in today/all challenges", topic.slug);
        }
    }

    #[tokio::test]
    async fn today_all_entries_do_not_expose_correct_answer() {
        let server = server();
        let res = server.get("/challenges/today/all")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .await;
        res.assert_status_ok();
        let body: Value = res.json();
        let challenges = body["challenges"].as_object().unwrap();
        for (slug, entry) in challenges {
            if entry.is_object() {
                assert!(entry.get("correct_answer").is_none(), "topic '{}' exposes correct_answer", slug);
                assert!(entry.get("explanation").is_none(), "topic '{}' exposes explanation", slug);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Challenge data integrity
    // -----------------------------------------------------------------------
    #[test]
    fn challenges_load_without_panic() {
        let challenges = swe_duolingo_api::data::challenges();
        assert!(!challenges.is_empty(), "challenge list must not be empty");
    }

    #[test]
    fn challenge_ids_are_unique() {
        let challenges = swe_duolingo_api::data::challenges();
        let mut seen = std::collections::HashSet::new();
        for c in &challenges {
            assert!(seen.insert(c.id.clone()), "duplicate challenge id: {}", c.id);
        }
    }

    #[test]
    fn challenge_dates_are_valid_yyyy_mm_dd() {
        let challenges = swe_duolingo_api::data::challenges();
        let re = regex::Regex::new(r"^\d{4}-\d{2}-\d{2}$").unwrap();
        for c in &challenges {
            assert!(re.is_match(&c.date), "invalid date '{}' in challenge {}", c.date, c.id);
        }
    }

    #[test]
    fn challenges_have_non_empty_required_fields() {
        let challenges = swe_duolingo_api::data::challenges();
        for c in &challenges {
            assert!(!c.id.is_empty(), "empty id found");
            assert!(!c.prompt.is_empty(), "empty prompt in challenge {}", c.id);
            assert!(!c.topic.is_empty(), "empty topic in challenge {}", c.id);
            assert!(!c.correct_answer.is_empty(), "empty correct_answer in challenge {}", c.id);
            assert!(!c.explanation.is_empty(), "empty explanation in challenge {}", c.id);
            assert!(!c.options.is_empty(), "empty options in challenge {}", c.id);
        }
    }

    #[test]
    fn challenge_correct_answer_is_one_of_options() {
        let challenges = swe_duolingo_api::data::challenges();
        for c in &challenges {
            if c.options.is_empty() { continue; }
            if c.options.iter().all(|o| o.is_empty()) { continue; }
            assert!(
                c.options.iter().any(|o| o.trim() == c.correct_answer.trim()),
                "challenge {} correct_answer '{}' not found in options {:?}",
                c.id, c.correct_answer, c.options
            );
        }
    }

    // -----------------------------------------------------------------------
    // POST /challenges/:id/submit
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn submit_correct_answer_returns_correct_true() {
        let server = server();
        let res = server
            .post("/challenges/ch-001/submit")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .json(&json!({
                "answer": "The loop condition should be i < arr.length",
                "time_ms": 5000
            }))
            .await;
        res.assert_status_ok();
        let body: Value = res.json();
        assert_eq!(body["correct"], true);
    }

    #[tokio::test]
    async fn submit_wrong_answer_returns_correct_false() {
        let server = server();
        let res = server
            .post("/challenges/ch-001/submit")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .json(&json!({
                "answer": "The initial value of total should be 1",
                "time_ms": 5000
            }))
            .await;
        res.assert_status_ok();
        let body: Value = res.json();
        assert_eq!(body["correct"], false);
    }

    #[tokio::test]
    async fn submit_response_always_includes_correct_answer_and_explanation() {
        let server = server();
        let res = server
            .post("/challenges/ch-001/submit")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .json(&json!({ "answer": "foo", "time_ms": 5000 }))
            .await;
        res.assert_status_ok();
        let body: Value = res.json();
        assert!(body.get("correct_answer").is_some());
        assert!(body.get("explanation").is_some());
        assert!(body.get("time_ms").is_some());
    }

    #[tokio::test]
    async fn submit_rejects_suspiciously_low_time_ms() {
        let server = server();
        let res = server
            .post("/challenges/ch-001/submit")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .json(&json!({ "answer": "foo", "time_ms": 100 }))
            .await;
        res.assert_status_bad_request();
    }

    #[tokio::test]
    async fn submit_unauthenticated_returns_401() {
        let server = server();
        let res = server
            .post("/challenges/ch-001/submit")
            .json(&json!({
                "answer": "The loop condition should be i < arr.length",
                "time_ms": 12500
            }))
            .await;
        assert_eq!(res.status_code(), axum::http::StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn submit_returns_404_for_unknown_challenge() {
        let server = server();
        let res = server
            .post("/challenges/ch-99999/submit")
            .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
            .json(&json!({ "answer": "foo", "time_ms": 1000 }))
            .await;
        assert_eq!(res.status_code(), axum::http::StatusCode::NOT_FOUND);
    }

    // -----------------------------------------------------------------------
    // GET /me — 401/503 without token
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn me_returns_401_without_token() {
        let server = server();
        let res = server.get("/me").await;
        assert!(
            res.status_code() == axum::http::StatusCode::UNAUTHORIZED
                || res.status_code() == axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }

    #[tokio::test]
    async fn me_streak_returns_401_without_token() {
        let server = server();
        let res = server.get("/me/streak").await;
        assert!(
            res.status_code() == axum::http::StatusCode::UNAUTHORIZED
                || res.status_code() == axum::http::StatusCode::SERVICE_UNAVAILABLE
        );
    }

    // -----------------------------------------------------------------------
    // GET /leaderboard
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn leaderboard_returns_401_without_auth() {
        let server = server();
        let res = server.get("/leaderboard").await;
        assert_eq!(res.status_code(), axum::http::StatusCode::UNAUTHORIZED);
    }

    // -----------------------------------------------------------------------
    // GET /users/search
    // -----------------------------------------------------------------------
    #[tokio::test]
    async fn user_search_requires_auth() {
        let server = server();
        let res = server.get("/users/search?q=test").await;
        let status = res.status_code().as_u16();
        // Without auth, should not return 200 or 5xx
        assert!(status != 200 && status < 500, "expected non-200/non-5xx, got {}", status);
    }
}
