'use client'

import { useState } from 'react'
import { useMeasure } from './useMeasure'
import { clampN } from './chart-utils'
import { linReg } from './stats'
import { Tooltip } from './Tooltip'

export interface ScatterPoint {
  x: number
  y: number
  label?: string
}

interface Props {
  points: ScatterPoint[]
  xLabel: string
  yLabel: string
  xUnit?: string
  yUnit?: string
  color?: string
  height?: number
  fmtX?: (v: number) => string | number
  fmtY?: (v: number) => string | number
  showFit?: boolean
}

/**
 * Scatter with optional linear-fit line. Ported from
 * prototype-src/06-charts.jsx::ScatterChart. Points are caller-prepared via
 * `pairedNonNull` — this component does not filter; it draws what's given.
 */
export function ScatterChart({
  points,
  xLabel,
  yLabel,
  xUnit = '',
  yUnit = '',
  color = 'var(--teal)',
  height = 240,
  fmtX = (v) => v,
  fmtY = (v) => v,
  showFit = true,
}: Props) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const width = w || 460
  const m = { top: 14, right: 16, bottom: 38, left: 46 }
  const iw = Math.max(10, width - m.left - m.right)
  const ih = height - m.top - m.bottom

  if (points.length === 0) {
    return (
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div className="empty-note">No paired days yet — keep logging</div>
      </div>
    )
  }

  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  let xLo = Math.min(...xs)
  let xHi = Math.max(...xs)
  let yLo = Math.min(...ys)
  let yHi = Math.max(...ys)
  const px = (xHi - xLo) * 0.08 || 1
  const py = (yHi - yLo) * 0.08 || 1
  xLo -= px; xHi += px; yLo -= py; yHi += py

  const xOf = (v: number) => m.left + ((v - xLo) / (xHi - xLo)) * iw
  const yOf = (v: number) => m.top + ih - ((v - yLo) / (yHi - yLo)) * ih

  const xticks = [
    xLo + (xHi - xLo) * 0.1,
    (xLo + xHi) / 2,
    xHi - (xHi - xLo) * 0.1,
  ]
  const yticks = [
    yLo + (yHi - yLo) * 0.12,
    (yLo + yHi) / 2,
    yHi - (yHi - yLo) * 0.12,
  ]

  let fit: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (showFit && points.length >= 2) {
    const { slope, intercept } = linReg(xs, ys)
    fit = {
      x1: xLo,
      y1: slope * xLo + intercept,
      x2: xHi,
      y2: slope * xHi + intercept,
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {yticks.map((t, i) => (
          <g key={'y' + i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={m.left - 7} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-dim)">
              {fmtY(t)}
            </text>
          </g>
        ))}
        {xticks.map((t, i) => (
          <text key={'x' + i} x={xOf(t)} y={height - 20} textAnchor="middle" fontSize="10" fill="var(--text-dim)">
            {fmtX(t)}
          </text>
        ))}
        {fit && (
          <line
            x1={xOf(fit.x1)} y1={yOf(fit.y1)}
            x2={xOf(fit.x2)} y2={yOf(fit.y2)}
            stroke={color} strokeWidth={2}
            strokeDasharray="5 4" opacity={0.9}
          />
        )}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={xOf(p.x)} cy={yOf(p.y)}
            r={hover === i ? 5 : 3.4}
            fill={color}
            opacity={hover === null ? 0.55 : hover === i ? 1 : 0.28}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          />
        ))}
        <text
          x={m.left + iw / 2} y={height - 4}
          textAnchor="middle" fontSize="10.5" fontWeight={600} fill="var(--text-muted)"
        >
          {xLabel}{xUnit ? ` (${xUnit})` : ''}
        </text>
        <text
          x={12} y={m.top + ih / 2}
          textAnchor="middle" fontSize="10.5" fontWeight={600} fill="var(--text-muted)"
          transform={`rotate(-90 12 ${m.top + ih / 2})`}
        >
          {yLabel}{yUnit ? ` (${yUnit})` : ''}
        </text>
      </svg>
      {hover !== null && (
        <Tooltip
          x={clampN(xOf(points[hover].x), 70, width - 70)}
          width={width}
          title={points[hover].label ?? ''}
          rows={[
            { color: 'var(--text-muted)', label: xLabel, value: `${fmtX(points[hover].x)}${xUnit ? ' ' + xUnit : ''}` },
            { color, label: yLabel, value: `${fmtY(points[hover].y)}${yUnit ? ' ' + yUnit : ''}` },
          ]}
        />
      )}
    </div>
  )
}
