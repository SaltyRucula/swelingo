import { ChallengePreview, Topic, SubmitResponse, LeaderboardResponse, ChallengeStats, Squad, SquadSummary, SquadLeaderboardEntry, MeRankResponse, RankLeaderboardResponse, UserRanksResponse, UserSearchEntry } from '../types';
import { getToken } from '../auth';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

export async function fetchTopics(): Promise<Topic[]> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/challenges/topics`, { headers });
  if (!res.ok) throw new Error('Failed to fetch topics');
  return res.json();
}

export interface TodayAllResponse {
  topics: Topic[];
  challenges: Record<string, ChallengePreview | null>;
}

export async function fetchTodayAll(): Promise<TodayAllResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/challenges/today/all`, { headers });
  if (!res.ok) throw new Error('Failed to fetch today\'s challenges');
  return res.json();
}

export async function fetchTodaysChallenge(
  topic: string,
): Promise<ChallengePreview | null> {
  const params = new URLSearchParams({ topic });
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/challenges/today?${params}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to fetch challenge');
  return res.json();
}

export async function submitAnswer(
  challengeId: string,
  answer: string,
  time_ms: number
): Promise<SubmitResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/challenges/${challengeId}/submit`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer, time_ms }),
  });
  if (!res.ok) throw new Error('Failed to submit answer');
  return res.json();
}

export async function fetchLeaderboard(): Promise<LeaderboardResponse> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/leaderboard`, { headers });
  if (!res.ok) throw new Error('Failed to fetch leaderboard');
  return res.json();
}

export async function fetchChallengeStats(
  challengeId: string,
  timeMs?: number,
  correct?: boolean
): Promise<ChallengeStats | null> {
  try {
    const params = new URLSearchParams();
    if (timeMs !== undefined) params.set('time_ms', String(timeMs));
    if (correct !== undefined) params.set('correct', String(correct));
    const query = params.toString() ? `?${params}` : '';
    const headers = await authHeaders();
    const res = await fetch(`${BASE_URL}/challenges/${challengeId}/stats${query}`, { headers });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

export async function createSquad(name: string, topics: string[]): Promise<Squad> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/squads`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, topics }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Failed to create squad');
  }
  return res.json();
}

export async function fetchSquad(squadId: string): Promise<Squad> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/squads/${squadId}`, { headers });
  if (!res.ok) throw new Error('Squad not found');
  return res.json();
}

export async function joinSquad(inviteCode: string): Promise<Squad> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/squads/join`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invite_code: inviteCode }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as any).error ?? 'Invalid invite code');
  }
  return res.json();
}

export async function leaveSquad(squadId: string): Promise<void> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/squads/${squadId}/members/me`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) throw new Error('Failed to leave squad');
}

export async function fetchSquadLeaderboard(squadId: string): Promise<SquadLeaderboardEntry[]> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}/squads/${squadId}/leaderboard`, { headers });
  if (!res.ok) throw new Error('Failed to fetch leaderboard');
  return res.json();
}

export async function fetchMySquads(): Promise<SquadSummary[]> {
  const headers = await authHeaders();
  if (!headers.Authorization) return [];
  const res = await fetch(`${BASE_URL}/me/squads`, { headers });
  if (!res.ok) return [];
  return res.json();
}

// ---------------------------------------------------------------------------
// Rank
// ---------------------------------------------------------------------------

export async function fetchMyRank(): Promise<MeRankResponse | null> {
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return null;
    const res = await fetch(`${BASE_URL}/me/rank`, { headers });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function fetchRankLeaderboard(topic?: string): Promise<RankLeaderboardResponse | null> {
  try {
    const headers = await authHeaders();
    const url = topic
      ? `${BASE_URL}/leaderboard/ranks?topic=${encodeURIComponent(topic)}`
      : `${BASE_URL}/leaderboard/ranks`;
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// User Ranks / Search
// ---------------------------------------------------------------------------

export async function fetchUserRanks(username: string): Promise<UserRanksResponse | null> {
  try {
    const headers = await authHeaders();
    const res = await fetch(`${BASE_URL}/users/${encodeURIComponent(username)}/ranks`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    // Backend returns { season, ranks: [{ topic, lp, tier, ... }] }
    // Merge in the username from our request since the endpoint doesn't echo it
    return { username, ...data };
  } catch {
    return null;
  }
}

export async function fetchUserSearch(q: string): Promise<UserSearchEntry[]> {
  try {
    const headers = await authHeaders();
    const res = await fetch(`${BASE_URL}/users/search?q=${encodeURIComponent(q)}`, { headers });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
