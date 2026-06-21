// Calm status thresholds — ported VERBATIM from prototype-src/04-app.jsx `st.*`.
// Intentionally generous on the "watch" band; nothing here is medical advice.

export type Status = 'good' | 'watch' | 'concern' | 'neutral'

export const STATUS_COLOR: Record<Status, string> = {
  good: 'var(--teal)',
  watch: 'var(--amber)',
  concern: 'var(--red)',
  neutral: 'var(--text-muted)',
}

export const st = {
  recovery: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v >= 58 ? 'good' : v >= 45 ? 'watch' : 'concern'
  },
  bp: (s: number | null, d: number | null): Status => {
    if (s === null || d === null) return 'neutral'
    return s < 130 && d < 85 ? 'good' : s < 140 && d < 90 ? 'watch' : 'concern'
  },
  glucose: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v >= 3.9 && v <= 10
      ? 'good'
      : (v >= 3.3 && v < 3.9) || (v > 10 && v <= 12)
      ? 'watch'
      : 'concern'
  },
  sleep: (h: number | null): Status => {
    if (h === null) return 'neutral'
    return h >= 7 ? 'good' : h >= 6 ? 'watch' : 'concern'
  },
  rhr: (v: number | null): Status => {
    if (v === null) return 'neutral'
    return v <= 68 ? 'good' : v <= 75 ? 'watch' : 'concern'
  },
}

export const MMOL_TO_MGDL = 18.0182

export const GLUCOSE_LO = 3.9   // mmol/L
export const GLUCOSE_HI = 10.0  // mmol/L

// STEMI day — used by the recovery-day counter in the header.
// 2026-04-28, GST. Prototype hard-coded April 5 (placeholder); CLAUDE.md is canonical.
export const STEMI_DATE = new Date('2026-04-28T00:00:00+04:00')

export const RANGES = [
  { id: 7 as const, label: '7d' },
  { id: 30 as const, label: '30d' },
  { id: 90 as const, label: '90d' },
]
export type RangeId = (typeof RANGES)[number]['id']
