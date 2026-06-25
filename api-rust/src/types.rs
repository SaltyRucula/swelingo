use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum ChallengeType {
    SpotTheBug,
    PredictOutput,
    LogicPuzzle,
    ArchitectureTake,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Difficulty {
    Easy,
    Medium,
    Hard,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Challenge {
    pub id: String,
    /// YYYY-MM-DD
    pub date: String,
    pub topic: String,
    #[serde(rename = "type")]
    pub challenge_type: ChallengeType,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_snippet: Option<String>,
    pub options: Vec<String>,
    pub correct_answer: String,
    pub explanation: String,
    pub difficulty: Difficulty,
}

/// Safe view of a Challenge — omits correct_answer and explanation
#[derive(Debug, Serialize)]
pub struct ChallengePreview {
    pub id: String,
    pub date: String,
    pub topic: String,
    #[serde(rename = "type")]
    pub challenge_type: ChallengeType,
    pub prompt: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_snippet: Option<String>,
    pub options: Vec<String>,
    pub difficulty: Difficulty,
}

impl From<&Challenge> for ChallengePreview {
    fn from(c: &Challenge) -> Self {
        ChallengePreview {
            id: c.id.clone(),
            date: c.date.clone(),
            topic: c.topic.clone(),
            challenge_type: c.challenge_type.clone(),
            prompt: c.prompt.clone(),
            code_snippet: c.code_snippet.clone(),
            options: c.options.clone(),
            difficulty: c.difficulty.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Topic {
    pub slug: String,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
pub struct SubmitRequest {
    pub answer: String,
    pub time_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct RankInfo {
    pub tier: String,
    pub lp: i64,
    pub season: String,
}

#[derive(Debug, Serialize)]
pub struct SubmitResponse {
    pub correct: bool,
    pub correct_answer: String,
    pub explanation: String,
    pub time_ms: u64,
    /// Only present for code-completion challenges: 0-100 token-match score
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score_pct: Option<u8>,
    /// Rank info after this submission (only when authenticated + DB available)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_info: Option<RankInfo>,
    /// True if the player promoted to a new tier this submission
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_up: Option<bool>,
    /// True if the player was demoted to a lower tier this submission
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rank_down: Option<bool>,
    /// The tier before this submission (present when rank_up or rank_down is true)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prev_tier: Option<String>,
    /// Updated streak after this submission (only when authenticated + correct)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_streak: Option<i32>,
    /// True if this submission hit a streak milestone
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_streak_milestone: Option<bool>,
}
