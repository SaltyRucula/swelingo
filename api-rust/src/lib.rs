// Library entry-point — re-exports everything the integration tests need.
// The actual implementation lives in main.rs (binary) but is shared here.

pub mod auth;
pub mod data;
pub mod db;
mod models;
mod ranks;
pub mod routes;
pub mod types;

use axum::{routing::{delete, get, post}, Json, Router};
use axum::http::HeaderValue;
use tower_http::cors::CorsLayer;
use tower_governor::{
    governor::GovernorConfigBuilder,
    key_extractor::SmartIpKeyExtractor,
    GovernorLayer,
};

fn cors_layer() -> CorsLayer {
    let raw = std::env::var("ALLOWED_ORIGINS")
        .unwrap_or_else(|_| "http://localhost:8080".to_string());

    let origins: Vec<HeaderValue> = raw
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| s.parse::<HeaderValue>().ok())
        .collect();

    CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::DELETE,
            axum::http::Method::OPTIONS,
        ])
        .allow_headers([
            axum::http::header::AUTHORIZATION,
            axum::http::header::CONTENT_TYPE,
        ])
}

/// Build the router with no database — used by unit tests.
pub fn build_app() -> Router {
    let mut state = routes::AppState::new();
    // Set a test JWT secret so auth-protected routes can be tested
    state.jwt_secret = Some("test-secret".to_string());
    let auth_routes: Router<routes::AppState> = Router::new()
        .route("/auth/github", get(auth::github_login))
        .route("/auth/github/callback", get(auth::github_callback));
    Router::new()
        .merge(build_routes())
        .merge(auth_routes)
        .with_state(state)
        .layer(cors_layer())
}

/// Build the router with DB but without rate limiting — used by integration tests.
/// This matches the production code path (DB, auth, all routes) without the
/// GovernorLayer that requires ConnectInfo<SocketAddr>.
pub fn build_router_for_tests(state: routes::AppState) -> Router {
    let auth_routes: Router<routes::AppState> = Router::new()
        .route("/auth/github", get(auth::github_login))
        .route("/auth/github/callback", get(auth::github_callback));

    Router::new()
        .merge(build_routes())
        .merge(auth_routes)
        .with_state(state)
        .layer(cors_layer())
}

/// Build the full router for production (with DB and rate limiting).
pub fn build_router(state: routes::AppState) -> Router {
    let general_config = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .per_second(1)
            .burst_size(60)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("Failed to build general rate-limit config"),
    );

    let auth_config = std::sync::Arc::new(
        GovernorConfigBuilder::default()
            .per_second(12)
            .burst_size(5)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("Failed to build auth rate-limit config"),
    );

    let auth_router: Router<routes::AppState> = Router::new()
        .route("/auth/github", get(auth::github_login))
        .route("/auth/github/callback", get(auth::github_callback))
        .layer(GovernorLayer { config: auth_config });

    let api_router: Router<routes::AppState> = build_routes()
        .layer(GovernorLayer { config: general_config });

    Router::new()
        .merge(api_router)
        .merge(auth_router)
        .with_state(state)
        .layer(cors_layer())
}

fn build_routes() -> Router<routes::AppState> {
    Router::new()
        .route("/", get(index))
        .route("/challenges/topics", get(routes::list_topics))
        .route("/challenges/today/all", get(routes::get_today_all))
        .route("/challenges/today", get(routes::get_today))
        .route("/challenges/:id/submit", post(routes::submit))
        .route("/challenges/:id/stats", get(routes::get_challenge_stats))
        .route("/me", get(routes::me))
        .route("/me/streak", get(routes::me_streak))
        .route("/me/completions", post(routes::me_record_completion))
        .route("/me/completions/today", get(routes::me_completions_today))
        .route("/me/rank", get(routes::me_rank))
        .route("/leaderboard", get(routes::get_leaderboard))
        .route("/leaderboard/ranks", get(routes::leaderboard_ranks))
        .route("/users/search", get(routes::search_users))
        .route("/users/:username/ranks", get(routes::get_user_ranks))
        .route("/squads", post(routes::create_squad))
        .route("/squads/join", post(routes::join_squad))
        .route("/squads/:id", get(routes::get_squad))
        .route("/squads/:id/members/me", delete(routes::leave_squad))
        .route("/squads/:id/leaderboard", get(routes::get_squad_leaderboard))
        .route("/me/squads", get(routes::me_squads))
}

async fn index() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "name": "swe-duolingo API",
        "version": "0.3.0"
    }))
}
