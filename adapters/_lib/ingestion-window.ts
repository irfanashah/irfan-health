/**
 * Frontier window construction (backlog H1 + H3, gotcha #157/#158).
 *
 * H1 — devices sync late (a Withings cuff can sit unpaired all weekend; a
 * Whoop cycle can take a day or two to finalise). A lookback pinned tightly
 * to the frontier chases `now` and can advance PAST not-yet-synced data,
 * losing it permanently. Fix: widen the lookback well beyond realistic sync
 * delay — re-fetching the overlap is free because `upsertObservation`/
 * `upsertBpReading` are idempotent on `(source_slug, source_record_id)`.
 *
 * H3 — a single permanently-failing row used to freeze the frontier
 * (`getLastSuccessfulWindowEnd` matched `status='success'` only), so the
 * window grew unbounded run over run until it blew `maxDuration`. Fix:
 * `getLastCoveredWindowEnd` (adjacent file) now also matches `status=
 * 'partial'` — a bad row is a data-quality problem, not a coverage gap —
 * and `maxLookbackMs` here is the belt-and-braces cap so even a genuine
 * multi-week outage can't produce an unbounded window.
 *
 * NOTE: a long outage that never resolves within `maxLookbackMs` still
 * leaves a real hole between the capped window and the actual last-covered
 * point — the cron intentionally won't reach back further than the cap.
 * Recovering that gap is the refill route's job (POST with an explicit
 * `fromDate`), not the cron's. See gotcha #159.
 */
export function computeIngestWindow(
  lastCoveredEnd: Date | null,
  now: number,
  lookbackMs: number,
  maxLookbackMs: number,
  backfillStart: Date
): { windowStart: Date; windowEnd: Date } {
  const windowEnd = new Date(now)
  if (lastCoveredEnd === null) {
    return { windowStart: backfillStart, windowEnd }
  }
  const naiveStart = lastCoveredEnd.getTime() - lookbackMs
  const cappedStart = Math.max(naiveStart, now - maxLookbackMs)
  return { windowStart: new Date(cappedStart), windowEnd }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Per-source lookback/cap constants — PROVISIONAL, tune once real device
 * sync-delay and outage patterns are visible.
 *
 *   - Whoop: phone-tethered, syncs often. 4-day lookback covers a dead
 *     phone over a long weekend; 30-day cap bounds a genuine outage.
 *   - Withings: BP cuffs commonly sit unsynced over a weekend. 7-day
 *     lookback; same 30-day cap.
 *   - Nightscout: near-real-time via xDrip+ normally, so a shorter 4-day
 *     lookback is generous; 14-day cap is tighter than the others since an
 *     xDrip outage that long usually means the sensor itself is down, not
 *     just a sync backlog — the refill route is the right recovery either way.
 */
export const INGEST_WINDOW_CONFIG = {
  whoop: { lookbackMs: 4 * DAY_MS, maxLookbackMs: 30 * DAY_MS },
  withings: { lookbackMs: 7 * DAY_MS, maxLookbackMs: 30 * DAY_MS },
  nightscout: { lookbackMs: 4 * DAY_MS, maxLookbackMs: 14 * DAY_MS },
} as const
