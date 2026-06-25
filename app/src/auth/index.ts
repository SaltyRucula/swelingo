/**
 * Auth helpers — token storage + current user cache.
 *
 * Token is stored in AsyncStorage under the key 'auth_token'.
 * All API calls that need auth should call `getToken()` and set the
 * Authorization header accordingly.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const TOKEN_KEY = 'auth_token';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

export async function getToken(): Promise<string | null> {
  return AsyncStorage.getItem(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await AsyncStorage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY);
}

// ---------------------------------------------------------------------------
// User type
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  github_id: number;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** Fetch current user from /me. Returns null if not logged in or token expired. */
export async function getMe(): Promise<AuthUser | null> {
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return null;
    const res = await fetch(`${BASE_URL}/me`, { headers });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Streak
// ---------------------------------------------------------------------------

export interface ServerStreak {
  current_streak: number;
  longest_streak: number;
  last_completed_date: string | null;
}

export async function getServerStreak(): Promise<ServerStreak | null> {
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return null;
    const res = await fetch(`${BASE_URL}/me/streak`, { headers });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Completions
// ---------------------------------------------------------------------------

export interface ServerCompletion {
  id: string;
  user_id: string;
  challenge_id: string;
  completed_at: string;
  time_ms: number;
  correct: boolean;
  score_pct: number | null;
}

export async function recordServerCompletion(params: {
  challenge_id: string;
  time_ms: number;
  correct: boolean;
}): Promise<ServerCompletion | null> {
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return null;
    const res = await fetch(`${BASE_URL}/me/completions`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function getTodayServerCompletions(): Promise<ServerCompletion[]> {
  try {
    const headers = await authHeaders();
    if (!headers.Authorization) return [];
    const res = await fetch(`${BASE_URL}/me/completions/today`, { headers });
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}
