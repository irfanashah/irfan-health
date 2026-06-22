// Pure-TS drift evaluation. Per-metric, takes the recent metric_drift rows
// (windowed by the data module) + the per-metric config + the active anchor
// stats + active context periods, returns the full verdict the panel renders.
//
// The view emits STATS ONLY (per spec §SQL/TS boundary). Everything here —
// the abs+z AND-gate, three sufficiency states, recency-to-today guard,
// ≥M held data-day persistence over a bounded look-back, tier surfacing,
// direction/Win logic, clinical-precedence guardrail, baseline-fired label,
// and suppression UI state — lives in TS.

import {
  DRIFT_CONFIG,
  PERSISTENCE_LOOKBACK_DAYS,
  RECENCY_GUARD_DAYS,
  type DriftMetricConfig,
  type DriftMetricId,
} from '../drift-config'
import {
  LOW_FLOORS,
  clinicalLowState,
  type ClinicalLowState,
} from '../thresholds'
import type {
  ActiveAnchor,
  ActiveContextPeriod,
  ActiveMedChange,
  MetricDriftRow,
} from '@/app/lib/dashboard/baselines'

// ─── Verdict types ─────────────────────────────────────────────────────────

export type SufficiencyState = 'no-recent-data' | 'establishing' | 'active'

/** Surfacing tier the panel renders. */
export type DriftTier = 'stable' | 'watch' | 'drift' | 'win'

/** Which baseline the centre-shift comparison fired against. */
export type BaselineUsed = 'rolling' | 'anchor' | null

export interface DriftVerdict {
  metric: DriftMetricId
  config: DriftMetricConfig
  state: SufficiencyState
  tier: DriftTier
  baselineUsed: BaselineUsed
  /** Latest data-day row in the window, or null if no-recent-data. */
  latest: MetricDriftRow | null
  /** Held data-day count (gate-trip days within the lookback span). */
  heldDays: number
  /** "Concerning" direction (true) vs. "good" direction (false) of the shift. */
  shiftConcerning: boolean | null
  /** Centre shift used (short median − prior/anchor median) and z. */
  shiftDelta: number | null
  shiftZ: number | null
  /** Clinical-low state on the latest value (for the precedence guardrail). */
  clinicalLow: ClinicalLowState
  /** True iff a context_periods row with suppress_alerts covers today. */
  alertsSuppressed: boolean
  suppressedBy: ActiveContextPeriod | null
  /** Active med-change reset relevant to this metric (for UI surface). */
  medReset: ActiveMedChange | null
  /** Data-only callout string, ready to render. Never null — tier 'stable' shows none. */
  callout: string | null
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function todayISO(): string {
  // GST-anchored today (Asia/Dubai is fixed +04:00).
  const now = new Date()
  const gst = new Date(now.getTime() + 4 * 60 * 60 * 1000)
  return gst.toISOString().slice(0, 10)
}

function daysBetween(a: string, b: string): number {
  // Calendar-day distance assuming both are YYYY-MM-DD (GST).
  const da = new Date(a + 'T00:00:00Z')
  const db = new Date(b + 'T00:00:00Z')
  return Math.round((db.getTime() - da.getTime()) / 86400000)
}

/**
 * For a given metric, decide whether each row's `short_vs_prior` gate
 * has tripped (purely abs+z AND-gate, no direction filter applied yet).
 */
function gateTrippedOnRow(row: MetricDriftRow, cfg: DriftMetricConfig): boolean {
  if (row.short_vs_prior_delta === null || row.short_vs_prior_z === null) return false
  if (row.short_n < cfg.minNShort || row.prior_n < cfg.minNPrior) return false
  return Math.abs(row.short_vs_prior_delta) >= cfg.absFloor
      && Math.abs(row.short_vs_prior_z)     >= cfg.zFloor
}

/**
 * Sign of the shift relative to the metric's concerning direction.
 * Returns true if the shift is in the CONCERNING direction; false if it's
 * in the GOOD direction; null if the shift is zero or unknown.
 */
function shiftDirectionConcerning(delta: number, cfg: DriftMetricConfig): boolean | null {
  if (delta === 0) return null
  if (cfg.concerning === 'up') return delta > 0
  return delta < 0
}

// ─── Main evaluator ────────────────────────────────────────────────────────

export function evaluateMetric(
  metric: DriftMetricId,
  rows: MetricDriftRow[],
  ctx: {
    anchor: ActiveAnchor | null
    contextToday: ActiveContextPeriod[]
    medChanges: ActiveMedChange[]
  }
): DriftVerdict {
  const cfg = DRIFT_CONFIG[metric]
  const today = todayISO()

  // The med-change reset is already applied in the view (rolling/short/prior
  // all start on/after the latest active change_date for affected metrics).
  // Here we just surface the most-recent relevant change for the UI.
  const medReset =
    ctx.medChanges.find((mc) => mc.affected_metrics.includes(metric)) ?? null

  // Suppression: any active context covering today with suppress_alerts.
  const suppressedBy =
    ctx.contextToday.find((cp) => cp.suppress_alerts) ?? null
  const alertsSuppressed = suppressedBy !== null

  // Latest row in the recent window — recency-to-today is checked against
  // RECENCY_GUARD_DAYS (spec v1.3): a row exists doesn't make it current.
  const latest = rows.length ? rows[rows.length - 1] : null

  const recencyGapDays = latest ? daysBetween(latest.date, today) : Infinity
  if (latest === null || recencyGapDays > RECENCY_GUARD_DAYS) {
    return {
      metric, config: cfg,
      state: 'no-recent-data',
      tier: 'stable', // panel shows "no recent data", not a tier verdict
      baselineUsed: null,
      latest,
      heldDays: 0,
      shiftConcerning: null,
      shiftDelta: null,
      shiftZ: null,
      clinicalLow: 'normal',
      alertsSuppressed,
      suppressedBy,
      medReset,
      callout: null,
    }
  }

  // `establishing` iff the latest row doesn't have enough n on either side.
  // (Per spec: a metric is `active` only when BOTH windows meet min-n.)
  const latestActive =
    latest.short_n >= cfg.minNShort && latest.prior_n >= cfg.minNPrior

  if (!latestActive) {
    return {
      metric, config: cfg,
      state: 'establishing',
      tier: 'stable', // panel renders an "establishing" pill, not a verdict
      baselineUsed: null,
      latest,
      heldDays: 0,
      shiftConcerning: null,
      shiftDelta: null,
      shiftZ: null,
      clinicalLow: clinicalLowState(latest.today_value, LOW_FLOORS[metric as 'rhr' | 'sys' | 'dia']),
      alertsSuppressed,
      suppressedBy,
      medReset,
      callout: null,
    }
  }

  // Active. Now apply the gate per row across the bounded look-back.
  // A row counts toward `heldDays` iff:
  //   (a) it's within PERSISTENCE_LOOKBACK_DAYS of today, AND
  //   (b) the gate tripped on it AND
  //   (c) the metric was active that day (min-n on both windows). The view
  //       only emits data-days, so (c) is checked at row-level here.
  // Carry-forward across no-data days is naturally forbidden — the rows
  // array is the data-day set; non-data days never enter the count.
  const lookbackStart = (() => {
    const d = new Date(today + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() - PERSISTENCE_LOOKBACK_DAYS + 1)
    return d.toISOString().slice(0, 10)
  })()

  let heldDays = 0
  for (const row of rows) {
    if (row.date < lookbackStart) continue
    if (row.short_n < cfg.minNShort || row.prior_n < cfg.minNPrior) continue
    if (gateTrippedOnRow(row, cfg)) heldDays++
  }

  // Latest centre-shift: prefer the anchor when one is active for this
  // metric (anchor catches slow chronic drift the rolling window would
  // absorb). Fall back to short-vs-prior (rolling) otherwise.
  const anchorStats = ctx.anchor?.metrics[metric] ?? null
  let baselineUsed: BaselineUsed
  let shiftDelta: number | null
  let shiftZ: number | null

  if (anchorStats && latest.short_vs_anchor_delta !== null && latest.short_vs_anchor_z !== null) {
    baselineUsed = 'anchor'
    shiftDelta = latest.short_vs_anchor_delta
    shiftZ = latest.short_vs_anchor_z
  } else {
    baselineUsed = 'rolling'
    shiftDelta = latest.short_vs_prior_delta
    shiftZ = latest.short_vs_prior_z
  }

  const shiftConcerning = shiftDelta === null ? null : shiftDirectionConcerning(shiftDelta, cfg)
  const clinicalLow = clinicalLowState(
    latest.today_value,
    LOW_FLOORS[metric as 'rhr' | 'sys' | 'dia']
  )

  // Tier decision:
  //   - drift = held ≥ M data-days AND the latest shift is in the concerning
  //     direction.
  //   - watch = the gate is currently tripping (held < M) AND the shift is
  //     concerning — a forming move; never an alert.
  //   - win  = held ≥ M AND the shift is in the GOOD direction AND the
  //     metric acknowledges good drift AND the clinical-low state is not
  //     'caution'/'breach' (i.e. the value isn't approaching the floor).
  //   - stable otherwise.
  //
  // Clinical-precedence: a 'breach' clinical-low state ALWAYS surfaces its
  // own warning regardless of tier — the panel renders both (Win + breach
  // co-surface, clinical wins precedence). 'caution' demotes a would-be
  // Win to stable/neutral.
  let tier: DriftTier = 'stable'
  const heldEnough = heldDays >= cfg.M
  const latestTripping = gateTrippedOnRow(latest, cfg)

  if (heldEnough && shiftConcerning === true) {
    tier = 'drift'
  } else if (latestTripping && shiftConcerning === true) {
    tier = 'watch'
  } else if (heldEnough && shiftConcerning === false && cfg.acknowledgeGood) {
    // Win — but suppressed inside caution buffer (fix #1).
    tier = clinicalLow === 'normal' ? 'win' : 'stable'
  }

  // Suppression overlays — never silently fake-stable, panel labels it.
  // Verdict still computed honestly; the panel uses `alertsSuppressed`
  // to render the "suppressed — <type>" label without hiding the verdict.

  const callout = buildCallout({
    cfg, state: 'active', tier, baselineUsed, shiftDelta, shiftZ,
    heldDays, M: cfg.M, latest, anchor: anchorStats, clinicalLow,
  })

  return {
    metric, config: cfg,
    state: 'active',
    tier,
    baselineUsed,
    latest,
    heldDays,
    shiftConcerning,
    shiftDelta,
    shiftZ,
    clinicalLow,
    alertsSuppressed,
    suppressedBy,
    medReset,
    callout,
  }
}

// ─── Callout text ──────────────────────────────────────────────────────────

interface CalloutInput {
  cfg: DriftMetricConfig
  state: SufficiencyState
  tier: DriftTier
  baselineUsed: BaselineUsed
  shiftDelta: number | null
  shiftZ: number | null
  heldDays: number
  M: number
  latest: MetricDriftRow
  anchor: { median: number; mad: number; n: number } | null
  clinicalLow: ClinicalLowState
}

function fmt(v: number, dp: number): string {
  return Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(dp)
}

function buildCallout(c: CalloutInput): string | null {
  const { cfg, tier, baselineUsed, shiftDelta, shiftZ, heldDays, M, latest, anchor } = c
  if (tier === 'stable') return null

  const baselineLabel = baselineUsed === 'anchor'
    ? `vs anchor baseline (median ${fmt((anchor?.median ?? 0), cfg.unit === 'mmol/L' ? 1 : 0)} ${cfg.unit}${anchor ? `, n=${anchor.n}` : ''})`
    : `vs prior 21d (median ${fmt(latest.prior_median ?? 0, cfg.unit === 'mmol/L' ? 1 : 0)} ${cfg.unit}, n=${latest.prior_n})`

  const shortPart =
    `7d median ${fmt(latest.short_median ?? 0, cfg.unit === 'mmol/L' ? 1 : 0)} ${cfg.unit} (n=${latest.short_n})`

  const movedBy = shiftDelta === null
    ? ''
    : ` — moved ${fmt(Math.abs(shiftDelta), cfg.unit === 'mmol/L' ? 1 : 0)} ${cfg.unit}` +
      (shiftZ !== null ? ` (${shiftZ >= 0 ? '+' : '−'}${Math.abs(shiftZ).toFixed(1)} MAD)` : '')

  if (tier === 'drift') {
    return `${cfg.label}: ${shortPart} ${baselineLabel}${movedBy}. Held ${heldDays}/${M} data-days. Worth mentioning to Dr. Jose.`
  }
  if (tier === 'watch') {
    return `${cfg.label}: forming — ${shortPart} ${baselineLabel}${movedBy}. Held ${heldDays}/${M} data-days so far; not yet confirmed.`
  }
  if (tier === 'win') {
    return `${cfg.label}: trending the right way — ${shortPart} ${baselineLabel}${movedBy}. Held ${heldDays}/${M} data-days.`
  }
  return null
}
