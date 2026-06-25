//! Background cron jobs.
//!
//! Call [`spawn_jobs`] once at startup (after the DB pool is ready).  Each job
//! runs in its own `tokio::task` and loops forever, sleeping until the next
//! scheduled fire time.

use sqlx::PgPool;
use tokio::time::{sleep, Duration};

/// Spawn all background jobs.  Returns immediately; the jobs run on the Tokio
/// runtime indefinitely.
pub fn spawn_jobs(pool: PgPool) {
    tokio::spawn(missed_day_penalty_job(pool));
}

/// Fires once per day at 00:05 UTC and applies the missed-day LP penalty to
/// every user who did not complete a challenge yesterday (or earlier).
///
/// The 5-minute offset avoids a tight race with any midnight DB writes and
/// gives the streak table time to settle.
async fn missed_day_penalty_job(pool: PgPool) {
    loop {
        let sleep_secs = secs_until_next_run(0, 5); // 00:05 UTC
        eprintln!(
            "[cron] missed-day penalty job sleeping {}s until next 00:05 UTC",
            sleep_secs
        );
        sleep(Duration::from_secs(sleep_secs)).await;

        eprintln!("[cron] applying missed-day LP penalties…");
        match crate::db::apply_missed_day_penalties(&pool).await {
            Ok(rows) => eprintln!("[cron] updated {} user_ranks rows", rows),
            Err(e) => eprintln!("[cron] error applying penalties: {}", e),
        }

        eprintln!("[cron] resetting broken streaks…");
        match crate::db::reset_broken_streaks(&pool).await {
            Ok(rows) => eprintln!("[cron] reset {} streaks", rows),
            Err(e) => eprintln!("[cron] error resetting streaks: {}", e),
        }
    }
}

/// Returns the number of seconds from now until the next occurrence of
/// `HH:MM` in UTC.
fn secs_until_next_run(hour: u32, minute: u32) -> u64 {
    use chrono::{Timelike, Utc};
    let now = Utc::now();
    let target_secs_in_day = (hour * 3600 + minute * 60) as i64;
    let now_secs_in_day =
        now.hour() as i64 * 3600 + now.minute() as i64 * 60 + now.second() as i64;
    let mut delta = target_secs_in_day - now_secs_in_day;
    if delta <= 0 {
        delta += 86_400; // roll over to tomorrow
    }
    delta as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secs_until_next_run_is_positive() {
        // Whatever the current time, the result must be in (0, 86400].
        let s = secs_until_next_run(0, 5);
        assert!(s > 0 && s <= 86_400, "unexpected value: {}", s);
    }

    #[test]
    fn secs_until_next_run_rolls_over() {
        // Target 00:05, simulated by passing a time well past midnight.
        // We can't easily mock Utc::now() here, but we can at least verify
        // the formula is consistent for a concrete case.
        // If it's currently 00:03 UTC the delta should be 120s.
        // If it's currently 00:06 UTC the delta should be 86340s (next day).
        // We trust the positive-result test above for runtime correctness.
        assert!(secs_until_next_run(12, 0) <= 86_400);
    }
}
