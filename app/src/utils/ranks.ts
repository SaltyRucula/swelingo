import { RankTier } from '../types';

/**
 * Tier color map — one accent color per tier.
 * Used for badges, borders, and overlay backgrounds.
 */
export const TIER_COLORS: Record<RankTier, string> = {
  Tin:          '#9E9E9E',
  Copper:       '#B87333',
  Bronze:       '#CD7F32',
  Silver:       '#A8A9AD',
  Gold:         '#FFD700',
  Platinum:     '#00C9A7',
  Diamond:      '#4FC3F7',
  Master:       '#AB47BC',
  Grandmaster:  '#EF5350',
  Challenger:   '#FFB300',
};

/** Order of tiers for comparison (index 0 = lowest). */
export const TIER_ORDER: RankTier[] = [
  'Tin',
  'Copper',
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
  'Diamond',
  'Master',
  'Grandmaster',
  'Challenger',
];

/** Return true if `a` is a higher tier than `b`. */
export function isHigherTier(a: RankTier, b: RankTier): boolean {
  return TIER_ORDER.indexOf(a) > TIER_ORDER.indexOf(b);
}

/** Minimum LP required for each tier. */
export const TIER_FLOOR: Record<RankTier, number> = {
  Tin: 0,
  Copper: 50,
  Bronze: 150,
  Silver: 350,
  Gold: 700,
  Platinum: 1200,
  Diamond: 2000,
  Master: 3000,
  Grandmaster: 4500,
  Challenger: 5000,
};

/** Return 0-1 progress within the current tier toward the next tier. */
export function tierProgress(tier: RankTier, lp: number): number {
  const idx = TIER_ORDER.indexOf(tier);
  const floor = TIER_FLOOR[tier];
  if (idx < 0 || idx >= TIER_ORDER.length - 1) return 1;
  const nextTier = TIER_ORDER[idx + 1];
  const ceiling = TIER_FLOOR[nextTier];
  if (ceiling <= floor) return 1;
  return Math.min(1, Math.max(0, (lp - floor) / (ceiling - floor)));
}
