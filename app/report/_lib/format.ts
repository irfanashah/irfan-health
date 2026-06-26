// Tiny formatting + selection helpers shared across report sections.
// Print-context: nothing that depends on locale state at runtime
// (formatted dates use en-GB style so the doctor doesn't see a US date).

import type { MarkerTrend } from '@/app/labs/actions'

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

export function fmtNum(v: number | null | undefined, dp: number = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return v.toFixed(dp)
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return Math.round(v).toString()
}

/** Stable cardiac key markers, in the order they should appear on page 1. */
export const CARDIAC_KEY_MARKERS: readonly string[] = [
  'ldl',
  'hdl',
  'non_hdl',
  'triglycerides',
  'lipoprotein_a',
  'apob',
  'hs_crp',
  'hba1c',
]

export interface CardiacLabSummary {
  slug: string
  display: string
  latest: number | null
  unit: string
  drawnAt: string | null
  refLow: number | null
  refHigh: number | null
  refSource: 'reported' | 'standard' | null
  flag: 'H' | 'L' | 'HH' | 'LL' | 'N' | null
  /** Latest minus prior; null when there isn't a prior draw. */
  delta: number | null
  /** 'up' | 'down' | 'flat' | null — mini-direction indicator. */
  direction: 'up' | 'down' | 'flat' | null
}

/**
 * Build the cardiac-labs row set for the page-1 table. Pulls the latest
 * draw per key marker; computes a delta vs the prior draw for the
 * direction arrow. Returns null entries pruned — markers Irfan doesn't
 * have are omitted gracefully (per spec).
 */
export function buildCardiacLabSummary(trends: MarkerTrend[]): CardiacLabSummary[] {
  const bySlug = new Map(trends.map((t) => [t.marker_slug, t]))
  const out: CardiacLabSummary[] = []
  for (const slug of CARDIAC_KEY_MARKERS) {
    const t = bySlug.get(slug)
    if (!t || t.points.length === 0) continue
    const last = t.points[t.points.length - 1]
    const prior = t.points.length >= 2 ? t.points[t.points.length - 2] : null
    let delta: number | null = null
    let direction: 'up' | 'down' | 'flat' | null = null
    if (prior) {
      delta = last.value - prior.value
      const eps = Math.abs(last.value) * 0.02 || 0.01
      direction = Math.abs(delta) < eps ? 'flat' : delta > 0 ? 'up' : 'down'
    }
    out.push({
      slug,
      display: t.display,
      latest: last.value,
      unit: t.canonical_unit ?? last.unit ?? '',
      drawnAt: last.drawn_at,
      refLow: last.ref_low,
      refHigh: last.ref_high,
      refSource: last.ref_source,
      flag: last.flag,
      delta,
      direction,
    })
  }
  return out
}

/** Direction word for cardiac labs — "up" / "down" / "stable" / "—". */
export function directionLabel(d: 'up' | 'down' | 'flat' | null): string {
  if (d === 'up') return '↑'
  if (d === 'down') return '↓'
  if (d === 'flat') return '→'
  return '—'
}

/** Pick the latest non-null entry from a series. */
export function latestNonNull<T>(rows: T[], pick: (r: T) => number | null): { value: number; at: number } | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const v = pick(rows[i])
    if (v !== null && Number.isFinite(v)) return { value: v, at: i }
  }
  return null
}
