/**
 * Lightweight in-memory response cache.
 *
 * Two cache policies:
 *   - "until-midnight"  — entry expires at the next UTC midnight
 *   - "forever"         — entry lives until the JS process restarts (app restart)
 */

type Policy = 'until-midnight' | 'forever';

interface CacheEntry<T> {
  value: T;
  expiresAt: number; // ms since epoch; Infinity = never
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const store = new Map<string, CacheEntry<any>>();

function nextMidnightUTC(): number {
  const now = new Date();
  const midnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
  );
  return midnight.getTime();
}

function expiresAt(policy: Policy): number {
  if (policy === 'forever') return Infinity;
  return nextMidnightUTC();
}

/** Return the cached value if still valid, otherwise null. */
export function getCached<T>(key: string): T | null {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

/** Store a value under a key with the given expiry policy. */
export function setCached<T>(key: string, value: T, policy: Policy): void {
  store.set(key, { value, expiresAt: expiresAt(policy) });
}

/**
 * Fetch-or-cache helper.
 * If the key is in cache and valid, returns the cached value immediately.
 * Otherwise calls `fetcher()`, stores the result, and returns it.
 */
export async function withCache<T>(
  key: string,
  policy: Policy,
  fetcher: () => Promise<T>
): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== null) return hit;
  const value = await fetcher();
  setCached(key, value, policy);
  return value;
}
