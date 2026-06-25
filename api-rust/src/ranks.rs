/// Rank system — "Seasons of Code"
///
/// All balancing constants are grouped here so they can be retuned without
/// touching any logic.  The core `compute_rank` function is a pure function
/// with no DB calls, making it trivially unit-testable.

// ---------------------------------------------------------------------------
// Balancing constants
// ---------------------------------------------------------------------------

/// Multiplier applied to total correct-answer points earned this season.
pub const POINTS_WEIGHT: f64 = 0.1;

/// LP contributed per day of current streak.
pub const STREAK_WEIGHT: f64 = 1.0;

/// LP contributed per percentage point of accuracy (0-100).
pub const ACCURACY_WEIGHT: f64 = 0.2;

/// LP lost for each wrong answer.
pub const WRONG_LP_PENALTY: i64 = 10;

/// When demoted, the player lands at (prev_tier_floor + DEMOTION_CARRY_LP).
pub const DEMOTION_CARRY_LP: i64 = 25;

/// Absolute LP floor required to be *considered* for Challenger.
pub const CHALLENGER_LP_MIN: i64 = 5000;

/// Maximum number of simultaneous Challenger-tier players.
pub const CHALLENGER_TOP_N: i64 = 200;

// ---------------------------------------------------------------------------
// Tier definitions
// ---------------------------------------------------------------------------

/// A rank tier.  `min_lp` is inclusive; there is no hard cap — the next
/// tier's `min_lp` is the implicit upper boundary.
#[derive(Debug, Clone, PartialEq)]
pub struct Tier {
    pub name: &'static str,
    pub min_lp: i64,
}

/// All tiers in ascending order.  Challenger's `min_lp` is set to
/// `CHALLENGER_LP_MIN`; whether a player is *actually* Challenger is
/// determined at query time (top-200 check).
pub const TIERS: &[Tier] = &[
    Tier {
        name: "Tin",
        min_lp: 0,
    },
    Tier {
        name: "Copper",
        min_lp: 50,
    },
    Tier {
        name: "Bronze",
        min_lp: 150,
    },
    Tier {
        name: "Silver",
        min_lp: 350,
    },
    Tier {
        name: "Gold",
        min_lp: 700,
    },
    Tier {
        name: "Platinum",
        min_lp: 1200,
    },
    Tier {
        name: "Diamond",
        min_lp: 2000,
    },
    Tier {
        name: "Master",
        min_lp: 3000,
    },
    Tier {
        name: "Grandmaster",
        min_lp: 4500,
    },
    Tier {
        name: "Challenger",
        min_lp: CHALLENGER_LP_MIN,
    },
];

// ---------------------------------------------------------------------------
// Pure helper functions
// ---------------------------------------------------------------------------

/// Return the tier index for a given LP value (ignoring the Challenger top-N
/// constraint, which is applied at query time).
pub fn tier_index_for_lp(lp: i64) -> usize {
    let mut idx = 0;
    for (i, tier) in TIERS.iter().enumerate() {
        if lp >= tier.min_lp {
            idx = i;
        }
    }
    idx
}

/// Return the tier name for a given LP value (no Challenger top-N check).
pub fn tier_name_for_lp(lp: i64) -> &'static str {
    TIERS[tier_index_for_lp(lp)].name
}

/// Compute the raw rank score from the three composite inputs.
///
/// `season_points`  — sum of per-challenge point values for correct answers
///                    this season (formula: 100 + max(0, 50 − floor(secs)))
/// `current_streak` — the user's server-side current streak (days)
/// `accuracy_pct`   — correct / total * 100 (pass 0.0 if no attempts)
///
/// Returns `(tier_name, lp)` where `lp == rank_score`.  The Challenger
/// top-200 constraint is NOT applied here; callers must overlay it when
/// serving leaderboard / rank responses.
pub fn compute_rank(
    season_points: i64,
    current_streak: i32,
    accuracy_pct: f64,
) -> (&'static str, i64) {
    let lp = (season_points as f64 * POINTS_WEIGHT
        + current_streak as f64 * STREAK_WEIGHT
        + accuracy_pct * ACCURACY_WEIGHT)
        .floor() as i64;
    let lp = lp.max(0);
    (tier_name_for_lp(lp), lp)
}

/// Apply a wrong-answer LP penalty to the stored LP and return the new LP
/// and tier, plus whether a demotion occurred.
///
/// Rules:
/// - Subtract `WRONG_LP_PENALTY` from `lp`.
/// - Clamp to the current tier's `min_lp`.
/// - If the player is already at the tier floor → demote to the tier below,
///   landing at `prev_tier_floor + DEMOTION_CARRY_LP` (clamped).
/// - Tin (index 0) cannot be demoted further; LP stays at 0.
///
/// Returns `(new_tier, new_lp, demoted)`.
pub fn apply_wrong_answer_penalty(
    current_lp: i64,
    current_tier: &str,
) -> (&'static str, i64, bool) {
    let tier_idx = TIERS
        .iter()
        .position(|t| t.name == current_tier)
        .unwrap_or_else(|| tier_index_for_lp(current_lp));
    let tier_floor = TIERS[tier_idx].min_lp;

    if current_lp > tier_floor {
        // Normal penalty — stay in same tier
        let new_lp = (current_lp - WRONG_LP_PENALTY).max(tier_floor);
        (TIERS[tier_idx].name, new_lp, false)
    } else if tier_idx == 0 {
        // Already Tin floor — cannot demote
        (TIERS[0].name, 0, false)
    } else {
        // Demote
        let prev_idx = tier_idx - 1;
        let prev_floor = TIERS[prev_idx].min_lp;
        let prev_max = TIERS[tier_idx].min_lp - 1;
        let new_lp = (prev_floor + DEMOTION_CARRY_LP).min(prev_max);
        (TIERS[prev_idx].name, new_lp, true)
    }
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_user_is_tin() {
        let (tier, lp) = compute_rank(0, 0, 0.0);
        assert_eq!(tier, "Tin");
        assert_eq!(lp, 0);
    }

    #[test]
    fn few_correct_answers_copper() {
        // 7 days: season_points=1050, streak=7, accuracy=90%
        // lp = floor(1050*0.1 + 7*1.0 + 90*0.2) = floor(105+7+18) = 130 → Copper
        let (tier, lp) = compute_rank(1050, 7, 90.0);
        assert_eq!(tier, "Copper");
        assert_eq!(lp, 130);
    }

    #[test]
    fn boundary_exactly_at_gold() {
        // Find inputs that land exactly at 700
        // season_points=6700, streak=10, accuracy=50%
        // lp = floor(670 + 10 + 10) = 690 → Silver
        // season_points=6800, streak=10, accuracy=50%
        // lp = floor(680 + 10 + 10) = 700 → Gold
        let (tier, lp) = compute_rank(6800, 10, 50.0);
        assert_eq!(tier, "Gold");
        assert_eq!(lp, 700);
    }

    #[test]
    fn high_performer_is_master() {
        // 90 days: season_points=14000, streak=90, accuracy=90%
        // lp = floor(1400 + 90 + 18) = 1508 → Platinum
        // Bump up: season_points=30000, streak=60, accuracy=95%
        // lp = floor(3000 + 60 + 19) = 3079 → Master
        let (tier, lp) = compute_rank(30000, 60, 95.0);
        assert_eq!(tier, "Master");
        assert_eq!(lp, 3079);
    }

    #[test]
    fn challenger_threshold() {
        // lp must be >= 5000
        // season_points=48000, streak=80, accuracy=100%
        // lp = floor(4800 + 80 + 20) = 4900 — not quite
        // season_points=50000, streak=80, accuracy=100%
        // lp = floor(5000 + 80 + 20) = 5100 → Challenger
        let (tier, lp) = compute_rank(50000, 80, 100.0);
        assert_eq!(tier, "Challenger");
        assert!(lp >= CHALLENGER_LP_MIN);
    }

    // -- LP penalty / demotion tests --

    #[test]
    fn wrong_answer_normal_penalty() {
        // Gold, lp=800.  Penalty = 10.  Should land at 790, still Gold.
        let (tier, lp, demoted) = apply_wrong_answer_penalty(800, "Gold");
        assert_eq!(tier, "Gold");
        assert_eq!(lp, 790);
        assert!(!demoted);
    }

    #[test]
    fn wrong_answer_clamps_to_tier_floor() {
        // Gold floor = 700.  Current lp=705.  705-10=695 < 700 → clamp to 700.
        let (tier, lp, demoted) = apply_wrong_answer_penalty(705, "Gold");
        assert_eq!(tier, "Gold");
        assert_eq!(lp, 700);
        assert!(!demoted);
    }

    #[test]
    fn wrong_answer_triggers_demotion() {
        // Gold floor = 700.  Already at floor.  Demote to Silver.
        // Silver floor=350, Gold floor=700, DEMOTION_CARRY_LP=25
        // new_lp = 350 + 25 = 375.  prev_max = 699.  375 <= 699 → 375.
        let (tier, lp, demoted) = apply_wrong_answer_penalty(700, "Gold");
        assert_eq!(tier, "Silver");
        assert_eq!(lp, 375);
        assert!(demoted);
    }

    #[test]
    fn tin_cannot_demote_below_zero() {
        let (tier, lp, demoted) = apply_wrong_answer_penalty(0, "Tin");
        assert_eq!(tier, "Tin");
        assert_eq!(lp, 0);
        assert!(!demoted);
    }

    #[test]
    fn tier_index_boundaries() {
        assert_eq!(tier_name_for_lp(0), "Tin");
        assert_eq!(tier_name_for_lp(49), "Tin");
        assert_eq!(tier_name_for_lp(50), "Copper");
        assert_eq!(tier_name_for_lp(149), "Copper");
        assert_eq!(tier_name_for_lp(150), "Bronze");
        assert_eq!(tier_name_for_lp(349), "Bronze");
        assert_eq!(tier_name_for_lp(350), "Silver");
        assert_eq!(tier_name_for_lp(699), "Silver");
        assert_eq!(tier_name_for_lp(700), "Gold");
        assert_eq!(tier_name_for_lp(1199), "Gold");
        assert_eq!(tier_name_for_lp(1200), "Platinum");
        assert_eq!(tier_name_for_lp(1999), "Platinum");
        assert_eq!(tier_name_for_lp(2000), "Diamond");
        assert_eq!(tier_name_for_lp(2999), "Diamond");
        assert_eq!(tier_name_for_lp(3000), "Master");
        assert_eq!(tier_name_for_lp(4499), "Master");
        assert_eq!(tier_name_for_lp(4500), "Grandmaster");
        assert_eq!(tier_name_for_lp(4999), "Grandmaster");
        assert_eq!(tier_name_for_lp(5000), "Challenger");
    }
}
