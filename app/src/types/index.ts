export type ChallengeType =
  | 'spot-the-bug'
  | 'predict-output'
  | 'logic-puzzle'
  | 'architecture-take';

export type Difficulty = 'easy' | 'medium' | 'hard';

// What the API returns for GET /challenges/today (answer hidden)
export interface ChallengePreview {
  id: string;
  date: string;
  topic: string;
  type: ChallengeType;
  prompt: string;
  code_snippet?: string;
  options: string[];
  difficulty: Difficulty;
}

export interface Topic {
  slug: string;
  display_name: string;
}

// ---------------------------------------------------------------------------
// Rank / Season types
// ---------------------------------------------------------------------------

export type RankTier =
  | 'Tin'
  | 'Copper'
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Diamond'
  | 'Master'
  | 'Grandmaster'
  | 'Challenger';

export interface RankInfo {
  tier: RankTier;
  lp: number;
  season: string;
}

export interface MeRankResponse {
  tier: RankTier;
  lp: number;
  rank_score: number;
  season: string;
  season_id: string;
  correct_this_season: number;
  attempts_this_season: number;
  accuracy_pct: number;
}

export interface RankLeaderboardEntry {
  rank: number;
  user: LeaderboardUser;
  tier: RankTier;
  lp: number;
  correct_this_season: number;
  attempts_this_season: number;
  accuracy_pct: number;
}

export interface RankLeaderboardResponse {
  season: string;
  entries: RankLeaderboardEntry[];
}

export interface SubmitResponse {
  correct: boolean;
  correct_answer: string;
  explanation: string;
  time_ms: number;
  /** Rank after this submission (only when authenticated) */
  rank_info?: RankInfo;
  /** True if the player promoted to a new tier */
  rank_up?: boolean;
  /** True if the player was demoted to a lower tier */
  rank_down?: boolean;
  /** The tier before this submission (present when rank_up or rank_down) */
  prev_tier?: string;
}

export interface ChallengeStats {
  total_attempts: number;
  correct_pct: number;
  avg_time_ms: number;
  /** Percentage of correct solvers the user was faster than */
  faster_than_pct?: number;
  /** Absolute count of correct solvers the user beat */
  faster_than_count?: number;
  /** ISO 3166-1 alpha-2 code of user's detected country (from CF-IPCountry) */
  country?: string;
  /** Percentage of correct solvers from the same country the user beat */
  country_faster_than_pct?: number;
  /** Total correct solvers from the same country */
  country_total?: number;
}

export type TopicStatus = 'not_started' | 'completed' | 'wrong' | 'no_challenge_today';

export interface TopicWithStatus {
  topic: Topic;
  status: TopicStatus;
  challengeId?: string;
}

// ---------------------------------------------------------------------------
// Field types (frontend-defined role clusters)
// ---------------------------------------------------------------------------

export interface Field {
  slug: string;
  display_name: string;
  /** Topic slugs that belong to this field; empty = all topics */
  topics: string[];
}

export const FIELDS: Field[] = [
  { slug: 'all', display_name: 'All Roles', topics: [] },
  { slug: 'software-engineer', display_name: 'Software Engineer', topics: ['javascript', 'python', 'git'] },
  { slug: 'data-engineer', display_name: 'Data Engineer', topics: ['python', 'architecture', 'linux'] },
  { slug: 'devops', display_name: 'DevOps / SRE', topics: ['linux', 'git', 'architecture'] },
  { slug: 'ai-engineer', display_name: 'AI / ML Engineer', topics: ['ai', 'python', 'architecture'] },
];

// ---------------------------------------------------------------------------
// Leaderboard types
// ---------------------------------------------------------------------------

export interface LeaderboardUser {
  username: string;
  display_name?: string;
  avatar_url?: string;
}

export interface StreakEntry {
  rank: number;
  user: LeaderboardUser;
  current_streak: number;
  longest_streak: number;
  rank_tier?: RankTier;
  lp?: number;
}

export interface TopicAccuracy {
  correct: number;
  attempts: number;
  correct_pct: number;
  avg_time_ms: number;
}

export interface AccuracyEntry {
  rank: number;
  user: LeaderboardUser;
  correct_pct: number;
  avg_time_ms: number;
  total_correct: number;
  total_attempts: number;
  /** keyed by topic slug */
  by_topic: Record<string, TopicAccuracy>;
  rank_tier?: RankTier;
  lp?: number;
}

export interface BreadthEntry {
  rank: number;
  user: LeaderboardUser;
  topics_correct: number;
  total_correct: number;
  rank_tier?: RankTier;
  lp?: number;
}

export interface LeaderboardResponse {
  streaks: StreakEntry[];
  accuracy: AccuracyEntry[];
  breadth: BreadthEntry[];
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

export interface SquadMember {
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  role: 'admin' | 'member';
  joined_at: string;
}

export interface Squad {
  id: string;
  name: string;
  /** Only present when the requester is a member */
  invite_code?: string;
  topics: string[];
  created_by: string;
  created_at: string;
  members: SquadMember[];
}

export interface SquadSummary {
  id: string;
  name: string;
  invite_code: string;
  topics: string[];
  member_count: number;
  my_points: number;
  created_at: string;
}

export interface SquadLeaderboardEntry {
  rank: number;
  user_id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  tier: string;
  lp: number;
}

// ---------------------------------------------------------------------------
// User Ranks / Search
// ---------------------------------------------------------------------------

export interface UserTopicRank {
  topic: string;
  lp: number;
  tier: string;
}

export interface UserRanksResponse {
  username: string;
  display_name?: string;
  avatar_url?: string;
  season: string;
  ranks: UserTopicRank[];
}

export interface UserSearchEntry {
  id: string;
  username: string;
  display_name?: string;
  avatar_url?: string;
  best_tier?: string;
}
