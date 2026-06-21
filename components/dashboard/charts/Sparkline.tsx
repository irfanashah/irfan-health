'use client'

import { useMemo } from 'react'
import { smoothPath } from './chart-utils'

interface Props {
  data: number[]
  color?: string
  width?: number
  height?: number
  fill?: boolean
}

/** Tiny inline sparkline — no axes, no tooltip. Ported from 06-charts.jsx. */
export function Sparkline({
  data,
  color = 'var(--teal)',
  width = 96,
  height = 34,
  fill = true,
}: Props) {
  const gid = useMemo(() => 'spark' + Math.random().toString(36).slice(2), [])
  if (!data || data.length === 0) return null

  const min = Math.min(...data)
  const max = Math.max(...data)
  const pad = (max - min) * 0.15 || 1
  const lo = min - pad
  const hi = max + pad
  const n = data.length
  const pts = data.map((v, i) => ({
    x: (i / Math.max(1, n - 1)) * width,
    y: height - ((v - lo) / (hi - lo)) * height,
  }))
  const d = smoothPath(pts)

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
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
    </svg>
  )
}
