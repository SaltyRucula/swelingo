use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// Season
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Season {
    pub id: Uuid,
    pub name: String,
    pub starts_at: DateTime<Utc>,
    pub ends_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// UserRankRow
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserRankRow {
    pub user_id: Uuid,
    pub season_id: Uuid,
    pub topic: String,
    pub lp: i64,
    pub tier: String,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: Uuid,
    pub github_id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Public-facing user representation — excludes internal fields like github_id.
#[derive(Debug, Clone, Serialize)]
pub struct UserResponse {
    pub id: Uuid,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl From<User> for UserResponse {
    fn from(u: User) -> Self {
        UserResponse {
            id: u.id,
            username: u.username,
            display_name: u.display_name,
            avatar_url: u.avatar_url,
            created_at: u.created_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Streak {
    pub user_id: Uuid,
    pub current_streak: i32,
    pub longest_streak: i32,
    pub last_completed_date: Option<NaiveDate>,
    pub updated_at: DateTime<Utc>,
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Completion {
    pub id: Uuid,
    pub user_id: Uuid,
    pub challenge_id: String,
    pub completed_at: DateTime<Utc>,
    pub time_ms: i64,
    pub correct: bool,
    pub score_pct: Option<i16>,
}
