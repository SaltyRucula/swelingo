import AsyncStorage from '@react-native-async-storage/async-storage';

const STREAK_KEY = 'streak_data';
const MILESTONES = new Set([3, 7, 14, 30]);

export interface StreakData {
  current_streak: number;
  last_completed_date: string; // YYYY-MM-DD
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayUTC(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export async function getStreak(): Promise<StreakData> {
  try {
    const raw = await AsyncStorage.getItem(STREAK_KEY);
    if (!raw) return { current_streak: 0, last_completed_date: '' };
    return JSON.parse(raw) as StreakData;
  } catch {
    return { current_streak: 0, last_completed_date: '' };
  }
}

/**
 * Call once when a challenge is completed.
 * Returns the new streak count and whether it hit a milestone.
 * Safe to call multiple times on the same day — only increments once.
 */
export async function incrementStreak(): Promise<{ streak: number; isMilestone: boolean }> {
  const today = todayUTC();
  const yesterday = yesterdayUTC();
  const data = await getStreak();

  // Already completed today — no change
  if (data.last_completed_date === today) {
    return { streak: data.current_streak, isMilestone: false };
  }

  const newStreak =
    data.last_completed_date === yesterday ? data.current_streak + 1 : 1;

  const updated: StreakData = {
    current_streak: newStreak,
    last_completed_date: today,
  };

  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(updated));

  return { streak: newStreak, isMilestone: MILESTONES.has(newStreak) };
}

/**
 * Resets the local streak to 0. Called when a missed day is detected on app load.
 */
export async function resetStreak(): Promise<void> {
  const data = await getStreak();
  const reset: StreakData = { current_streak: 0, last_completed_date: data.last_completed_date };
  await AsyncStorage.setItem(STREAK_KEY, JSON.stringify(reset));
}

/** Milliseconds until the next UTC midnight. */
export function msUntilMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

/** Format a millisecond duration as HH:MM:SS. */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}
