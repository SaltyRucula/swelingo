/// Integration tests — spin up a real Postgres container and test the full
/// server startup path (same as the DigitalOcean container).
///
/// Requires Docker to be running. Each test function gets its own fresh DB via
/// testcontainers so tests are fully independent.
use axum_test::TestServer;
use serde_json::{json, Value};
use sqlx::postgres::PgPoolOptions;
use testcontainers_modules::{postgres::Postgres, testcontainers::runners::AsyncRunner};

const TEST_JWT_SECRET: &str = "integration-test-secret";

fn test_auth_header() -> String {
    let token = swe_duolingo_api::auth::sign_jwt(uuid::Uuid::new_v4(), TEST_JWT_SECRET).unwrap();
    format!("Bearer {}", token)
}

// ---------------------------------------------------------------------------
// Helper: start Postgres container + init DB + return a TestServer backed by
//         build_router (the same code path as the real DigitalOcean container).
// ---------------------------------------------------------------------------
async fn server_with_db() -> (TestServer, testcontainers_modules::testcontainers::ContainerAsync<Postgres>) {
    // Start a temporary Postgres container.
    let container = Postgres::default()
        .start()
        .await
        .expect("Failed to start Postgres container — is Docker running?");

    let host = container.get_host().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@{}:{}/postgres", host, port);

    // Connect and init schema (same as production startup).
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .expect("Failed to connect to test Postgres");

    // Enable pgcrypto so gen_random_uuid() works (matches the DO production DB).
    sqlx::query("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        .execute(&pool)
        .await
        .expect("Failed to enable pgcrypto extension");

    swe_duolingo_api::db::init_db(&pool)
        .await
        .expect("DB schema init failed");

    let mut state = swe_duolingo_api::routes::AppState::new_with_db(pool);
    state.jwt_secret = Some(TEST_JWT_SECRET.to_string());
    let router = swe_duolingo_api::build_router_for_tests(state);
    let server = TestServer::new(router).expect("Failed to build test server");

    (server, container)
}

// ---------------------------------------------------------------------------
// Startup / health
// ---------------------------------------------------------------------------

#[tokio::test]
async fn startup_index_returns_ok_with_db() {
    let (server, _c) = server_with_db().await;
    let res = server.get("/").await;
    res.assert_status_ok();
    let body: Value = res.json();
    assert_eq!(body["name"], "swe-duolingo API");
}

#[tokio::test]
async fn startup_topics_returns_ok_with_db() {
    let (server, _c) = server_with_db().await;
    let res = server.get("/challenges/topics")
        .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
        .await;
    res.assert_status_ok();
    let arr = res.json::<Value>();
    assert!(arr.as_array().map(|a| !a.is_empty()).unwrap_or(false));
}

// ---------------------------------------------------------------------------
// Leaderboard — now backed by a real DB (should return 200 with empty array)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn leaderboard_returns_200_with_empty_db() {
    let (server, _c) = server_with_db().await;
    let res = server.get("/leaderboard")
        .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
        .await;
    res.assert_status_ok();
}

#[tokio::test]
async fn rank_leaderboard_returns_200_with_empty_db() {
    let (server, _c) = server_with_db().await;
    let res = server.get("/leaderboard/ranks")
        .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
        .await;
    res.assert_status_ok();
}

// ---------------------------------------------------------------------------
// DB schema — seasons are seeded by init_db
// ---------------------------------------------------------------------------

#[tokio::test]
async fn init_db_seeds_seasons() {
    let container = Postgres::default()
        .start()
        .await
        .expect("Failed to start Postgres container");

    let host = container.get_host().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@{}:{}/postgres", host, port);

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .unwrap();

    sqlx::query("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        .execute(&pool)
        .await
        .unwrap();

    swe_duolingo_api::db::init_db(&pool).await.unwrap();

    let row = sqlx::query("SELECT COUNT(*)::BIGINT AS cnt FROM seasons")
        .fetch_one(&pool)
        .await
        .unwrap();
    let cnt: i64 = sqlx::Row::get(&row, "cnt");
    assert!(cnt >= 4, "expected at least 4 seeded seasons, got {}", cnt);
}

// ---------------------------------------------------------------------------
// /me — requires auth, should return 401/503 even with a real DB
// ---------------------------------------------------------------------------

#[tokio::test]
async fn me_returns_401_with_real_db_and_no_token() {
    let (server, _c) = server_with_db().await;
    let res = server.get("/me").await;
    let status = res.status_code().as_u16();
    assert!(
        status == 401 || status == 503,
        "expected 401 or 503, got {}",
        status
    );
}

// ---------------------------------------------------------------------------
// /users/search — public endpoint, real DB
// ---------------------------------------------------------------------------

#[tokio::test]
async fn user_search_returns_empty_array_on_fresh_db() {
    let (server, _c) = server_with_db().await;
    let res = server.get("/users/search")
        .add_query_param("q", "alice")
        .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
        .await;
    res.assert_status_ok();
    let body: Value = res.json();
    assert_eq!(
        body.as_array().map(|a| a.len()).unwrap_or(1),
        0,
        "expected empty results on fresh DB"
    );
}

// ---------------------------------------------------------------------------
// Submit — unauthenticated path works end-to-end with a real DB
// ---------------------------------------------------------------------------

#[tokio::test]
async fn submit_correct_answer_with_real_db_returns_correct_true() {
    let (server, _c) = server_with_db().await;
    let res = server
        .post("/challenges/ch-001/submit")
        .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
        .json(&json!({
            "answer": "The loop condition should be i < arr.length",
            "time_ms": 8000
        }))
        .await;
    res.assert_status_ok();
    let body: Value = res.json();
    assert_eq!(body["correct"], true);
}

#[tokio::test]
async fn submit_populates_challenge_stats_with_real_db() {
    let (server, _c) = server_with_db().await;
    // First submission
    server
        .post("/challenges/ch-001/submit")
        .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
        .json(&json!({ "answer": "The loop condition should be i < arr.length", "time_ms": 8000 }))
        .await;

    let res = server.get("/challenges/ch-001/stats")
        .add_header(axum::http::header::AUTHORIZATION, test_auth_header().parse().unwrap())
        .await;
    res.assert_status_ok();
    let body: Value = res.json();
    assert!(
        body["total_attempts"].as_i64().is_some(),
        "expected total_attempts field in stats response"
    );
}

// ---------------------------------------------------------------------------
// Squads — full CRUD needs auth, but creation without auth returns 401/503
// ---------------------------------------------------------------------------

#[tokio::test]
async fn create_squad_without_auth_returns_401_or_503() {
    let (server, _c) = server_with_db().await;
    let res = server
        .post("/squads")
        .json(&json!({ "name": "Test Squad", "topics": ["frontend"] }))
        .await;
    let status = res.status_code().as_u16();
    assert!(
        status == 401 || status == 503,
        "expected 401 or 503, got {}",
        status
    );
}

// ---------------------------------------------------------------------------
// init_db is idempotent — calling it twice must not error
// ---------------------------------------------------------------------------

#[tokio::test]
async fn init_db_is_idempotent() {
    let container = Postgres::default()
        .start()
        .await
        .expect("Failed to start Postgres container");

    let host = container.get_host().await.unwrap();
    let port = container.get_host_port_ipv4(5432).await.unwrap();
    let url = format!("postgres://postgres:postgres@{}:{}/postgres", host, port);

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&url)
        .await
        .unwrap();

    sqlx::query("CREATE EXTENSION IF NOT EXISTS pgcrypto")
        .execute(&pool)
        .await
        .unwrap();

    swe_duolingo_api::db::init_db(&pool).await.expect("first init failed");
    swe_duolingo_api::db::init_db(&pool).await.expect("second init should also succeed (idempotent)");
}
