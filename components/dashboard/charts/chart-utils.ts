// Shared chart math + format helpers ported from prototype-src/06-charts.jsx.
// Pure TS — no React.

export function clampN(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v))
}

export interface Pt { x: number; y: number }

export function linePath(pts: Pt[]): string {
  if (!pts.length) return ''
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ')
}

/** Monotone-ish smoothing — same algorithm as the prototype's smoothPath. */
export function smoothPath(pts: Pt[]): string {
  if (pts.length < 2) return linePath(pts)
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
    const t = 0.18
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return d
}

// timeZone pinned to GST (L9): charts SSR then hydrate, so a bare formatter
// labels axes in UTC on the server and GST on the client. GST is the app's
// canonical day boundary (lib/gst.ts), so pin display to it everywhere.
export const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })
export const fmtDay = (d: Date) => d.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'Asia/Dubai' })
export const fmtDayShort = (d: Date) => d.toLocaleDateString([], { weekday: 'short', timeZone: 'Asia/Dubai' })
