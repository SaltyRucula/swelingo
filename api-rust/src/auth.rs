use axum::{
    async_trait,
    extract::{FromRequestParts, Query, State},
    http::{request::Parts, StatusCode},
    response::{IntoResponse, Redirect, Response},
    Json,
};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand::Rng;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::db;
use crate::routes::AppState;

// ---------------------------------------------------------------------------
// JWT
// ---------------------------------------------------------------------------

const JWT_EXPIRY_SECS: i64 = 30 * 24 * 3600; // 30 days

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Claims {
    pub sub: String, // user UUID
    pub exp: i64,
}

pub fn sign_jwt(user_id: Uuid, secret: &str) -> Result<String, jsonwebtoken::errors::Error> {
    let exp = chrono::Utc::now().timestamp() + JWT_EXPIRY_SECS;
    let claims = Claims {
        sub: user_id.to_string(),
        exp,
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
}

pub fn verify_jwt(token: &str, secret: &str) -> Result<Claims, jsonwebtoken::errors::Error> {
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::new(Algorithm::HS256),
    )?;
    Ok(data.claims)
}

// ---------------------------------------------------------------------------
// Axum extractor: AuthUser
// Reads Bearer token from Authorization header, verifies it, returns Claims.
// ---------------------------------------------------------------------------

pub struct AuthUser(pub Claims);

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = Response;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let secret = match &state.jwt_secret {
            Some(s) => s.clone(),
            None => {
                return Err((
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(serde_json::json!({ "error": "Auth not configured" })),
                )
                    .into_response());
            }
        };

        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        let token = if auth_header.starts_with("Bearer ") {
            &auth_header[7..]
        } else {
            return Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Missing or invalid Authorization header" })),
            )
                .into_response());
        };

        match verify_jwt(token, &secret) {
            Ok(claims) => Ok(AuthUser(claims)),
            Err(_) => Err((
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Invalid or expired token" })),
            )
                .into_response()),
        }
    }
}

// ---------------------------------------------------------------------------
// GitHub OAuth helpers
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GithubTokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct GithubUser {
    id: i64,
    login: String,
    name: Option<String>,
    avatar_url: Option<String>,
}

async fn exchange_code_for_token(
    client_id: &str,
    client_secret: &str,
    code: &str,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let body: GithubTokenResponse = res.json().await.map_err(|e| e.to_string())?;
    Ok(body.access_token)
}

async fn fetch_github_user(access_token: &str) -> Result<GithubUser, String> {
    let client = reqwest::Client::new();
    let res = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {}", access_token))
        .header("User-Agent", "swe-duolingo")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    res.json::<GithubUser>().await.map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// GET /auth/github — redirect to GitHub OAuth
// ---------------------------------------------------------------------------

/// Generate a cryptographically random state token (32 hex bytes = 64 chars).
fn generate_oauth_state() -> String {
    let bytes: [u8; 32] = rand::thread_rng().gen();
    hex::encode(bytes)
}

pub async fn github_login(State(state): State<AppState>) -> impl IntoResponse {
    let client_id = match &state.github_client_id {
        Some(id) => id.clone(),
        None => {
            return (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(serde_json::json!({ "error": "GitHub OAuth not configured" })),
            )
                .into_response();
        }
    };

    let redirect_uri = format!(
        "{}/auth/github/callback",
        state.api_base_url.as_deref().unwrap_or("http://localhost:3001")
    );

    // Generate and store the state token for CSRF protection.
    let oauth_state = generate_oauth_state();
    if let Ok(mut store) = state.oauth_states.lock() {
        store.insert(oauth_state.clone());
    }

    let url = format!(
        "https://github.com/login/oauth/authorize?client_id={}&redirect_uri={}&scope=read:user&state={}",
        client_id,
        urlencoding::encode(&redirect_uri),
        oauth_state,
    );

    Redirect::temporary(&url).into_response()
}

// ---------------------------------------------------------------------------
// GET /auth/github/callback — complete OAuth flow
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CallbackQuery {
    pub code: Option<String>,
    pub error: Option<String>,
    /// CSRF protection: must match the state token issued in github_login.
    pub state: Option<String>,
}

pub async fn github_callback(
    State(state): State<AppState>,
    Query(params): Query<CallbackQuery>,
) -> impl IntoResponse {
    let web_url = state
        .web_url
        .clone()
        .unwrap_or_else(|| "http://localhost:8080".to_string());

    // Helper: redirect back to the web app with an error message so the user
    // sees a useful page instead of raw JSON.
    let error_redirect = |msg: &str| -> Response {
        let url = format!(
            "{}/?auth_error={}",
            web_url,
            urlencoding::encode(msg)
        );
        eprintln!("[auth] callback error → redirecting to app: {}", msg);
        Redirect::temporary(&url).into_response()
    };

    // Bail out if GitHub sent an error
    if let Some(_err) = &params.error {
        // Do not forward the raw GitHub error string to the frontend.
        return error_redirect("Login failed — please try again");
    }

    // Validate the OAuth state token (CSRF protection).
    let incoming_state = match &params.state {
        Some(s) => s.clone(),
        None => return error_redirect("Missing state parameter — please try again"),
    };

    let state_valid = state
        .oauth_states
        .lock()
        .map(|mut store| store.remove(&incoming_state))
        .unwrap_or(false);

    if !state_valid {
        eprintln!("[auth] invalid or replayed OAuth state token");
        return error_redirect("Invalid session — please try again");
    }

    let code = match params.code {
        Some(c) => c,
        None => return error_redirect("Missing code param from GitHub"),
    };

    eprintln!("[auth] callback received code (len={})", code.len());

    let (pool, client_id, client_secret, jwt_secret) = match (
        &state.db,
        &state.github_client_id,
        &state.github_client_secret,
        &state.jwt_secret,
    ) {
        (Some(p), Some(id), Some(sec), Some(jwt)) => {
            (p.clone(), id.clone(), sec.clone(), jwt.clone())
        }
        _ => return error_redirect("Auth not fully configured on server"),
    };

    // Exchange code for access token
    let access_token = match exchange_code_for_token(&client_id, &client_secret, &code).await {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[auth] token exchange failed: {}", e);
            return error_redirect("Failed to exchange GitHub code — try again");
        }
    };

    eprintln!("[auth] token exchange succeeded");

    // Fetch GitHub user profile
    let gh_user = match fetch_github_user(&access_token).await {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[auth] GitHub user fetch failed: {}", e);
            return error_redirect("Failed to fetch GitHub profile — try again");
        }
    };

    eprintln!("[auth] fetched GitHub user: {}", gh_user.login);

    // Upsert user in DB
    let user = match db::upsert_user(
        &pool,
        gh_user.id,
        &gh_user.login,
        gh_user.name.as_deref(),
        gh_user.avatar_url.as_deref(),
    )
    .await
    {
        Ok(u) => u,
        Err(e) => {
            eprintln!("[auth] DB upsert failed: {}", e);
            return error_redirect("Database error — please try again");
        }
    };

    eprintln!("[auth] upserted user id={}", user.id);

    // Sign JWT
    let token = match sign_jwt(user.id, &jwt_secret) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[auth] JWT sign failed: {}", e);
            return error_redirect("Could not create session — please try again");
        }
    };

    // Redirect to web app with token in query param
    let redirect_url = format!("{}/?token={}", web_url, urlencoding::encode(&token));
    eprintln!("[auth] login complete for user={}, redirecting to web app", gh_user.login);
    Redirect::temporary(&redirect_url).into_response()
}
