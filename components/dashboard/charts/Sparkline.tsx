'use client'

import { useId } from 'react'
import { smoothPath } from './chart-utils'

interface Props {
  data: number[]
  color?: string
  width?: number
  height?: number
  fill?: boolean
}

// Vertical padding inside the SVG: the line + bezier control points stay
// inside a [PAD_Y, height - PAD_Y] band, leaving room so smoothPath
// overshoot can't cross the viewport edge and so the final-point dot
// (r=2.6) isn't clipped.
const PAD_Y = 4

/**
 * Tiny inline sparkline — no axes, no tooltip. Ported from 06-charts.jsx
 * with two fixes from dashboard-7.1-fixes-spec_2026-06-25 Part 3:
 *   1. SVG is now `overflow: hidden` (was 'visible' — bezier overshoot on
 *      sparse data bled out of the tile, visibly on the BP KPI).
 *   2. ≤2 points render a SHORT FLAT CENTERED segment instead of a steep
 *      diagonal across the viewport — sparse series (e.g. BP measured a
 *      couple of times in two weeks) no longer scream visual change that
 *      isn't there.
 * The line's y range is also padded so bezier control points stay
 * comfortably inside the viewport.
 */
export function Sparkline({
  data,
  color = 'var(--teal)',
  width = 96,
  height = 34,
  fill = true,
}: Props) {
  const gid = 'spark' + useId().replace(/:/g, '')
  if (!data || data.length === 0) return null

  const n = data.length
  const clipId = `${gid}-clip`

  // ─── Sparse-data branch: ≤2 points → short flat centered segment ────
  // Honest about "not enough to draw a trend" without drawing nothing.
  // The dot marks the latest value's position; the line is decorative.
  if (n <= 2) {
    const cy = height / 2
    const x0 = width * 0.25
    const x1 = width * 0.75
    return (
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        overflow="hidden"
        style={{ display: 'block', overflow: 'hidden' }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={width} height={height} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${clipId})`}>
          <line
            x1={x0} y1={cy} x2={x1} y2={cy}
            stroke={color} strokeWidth={2} strokeLinecap="round" opacity={0.45}
          />
          <circle cx={x1} cy={cy} r={2.6} fill={color} />
        </g>
      </svg>
    )
  }

  // ─── Normal branch: ≥3 points ────────────────────────────────────────
  const min = Math.min(...data)
  const max = Math.max(...data)
  const pad = (max - min) * 0.15 || 1
  const lo = min - pad
  const hi = max + pad
  // Plot inside [PAD_Y, height - PAD_Y] so bezier overshoot has a buffer;
  // a clipPath below provides the hard clip so anything still escaping
  // gets clipped at the viewBox edges.
  const innerH = height - 2 * PAD_Y
  const pts = data.map((v, i) => ({
    x: (i / Math.max(1, n - 1)) * width,
    y: PAD_Y + (innerH - ((v - lo) / (hi - lo)) * innerH),
  }))
  const d = smoothPath(pts)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      overflow="hidden"
      style={{ display: 'block', overflow: 'hidden' }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
      </defs>
      {/* Hard SVG-level clip — guarantees bezier overshoot stays inside
          the viewport regardless of browser CSS-overflow quirks. */}
      <g clipPath={`url(#${clipId})`}>
        {fill && (
          <path
            d={`${d} L${width} ${height} L0 ${height} Z`}
            fill={`url(#${gid})`}
            stroke="none"
          />
        )}
        <path
          d={d}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={pts[n - 1].x} cy={pts[n - 1].y} r={2.6} fill={color} />
      </g>
    </svg>
  )
}
