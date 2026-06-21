'use client'

import { useCallback, useMemo, useState } from 'react'
import { useMeasure } from './useMeasure'
import { clampN, fmtTime, smoothPath } from './chart-utils'
import { Tooltip } from './Tooltip'

export interface CgmDatum {
  time: Date
  value: number
}

interface Props {
  data: CgmDatum[]
  lo?: number                      // target band lower bound (display units)
  hi?: number                      // target band upper bound
  unit?: string
  toDisplay?: (mmol: number) => number
  height?: number
}

/**
 * 24-hour CGM area chart with target band + hover tooltip. Ported from
 * prototype-src/06-charts.jsx::CGMChart, minus the meal/event markers
 * (not in Slice 7.1 scope).
 */
export function CGMChart({
  data,
  lo = 3.9,
  hi = 10.0,
  unit = 'mmol/L',
  toDisplay = (v) => v,
  height = 240,
}: Props) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useMemo(() => 'cgm' + Math.random().toString(36).slice(2), [])

  if (data.length === 0) {
    return (
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div className="empty-note">No CGM readings in the last 24 hours</div>
      </div>
    )
  }

  const width = w || 700
  const m = { top: 14, right: 14, bottom: 26, left: 40 }
  const iw = Math.max(10, width - m.left - m.right)
  const ih = height - m.top - m.bottom
  const n = data.length

  const vals = data.map((d) => d.value)
  let dLo = Math.min(...vals, lo)
  let dHi = Math.max(...vals, hi)
  dLo = Math.floor(dLo - 0.6)
  dHi = Math.ceil(dHi + 0.6)

  const xOf = (i: number) => m.left + (i / Math.max(1, n - 1)) * iw
  const yOf = (v: number) => m.top + ih - ((v - dLo) / (dHi - dLo)) * ih
  const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.value) }))

  const xticks: number[] = []
  for (let i = 0; i < n; i++) {
    const t = data[i].time
    if (t.getMinutes() === 0 && t.getHours() % 4 === 0) xticks.push(i)
  }

  const yticks: number[] = []
  const yStep = dHi - dLo <= 8 ? 2 : 3
  for (let v = dLo; v <= dHi; v += yStep) yticks.push(v)

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left - m.left
      const idx = Math.round(clampN((x / iw) * (n - 1), 0, n - 1))
      setHover(idx)
    },
    [iw, n, m.left]
  )

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--purple)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--purple)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* target band */}
        <rect
          x={m.left}
          y={yOf(hi)}
          width={iw}
          height={Math.max(0, yOf(lo) - yOf(hi))}
          fill="var(--teal)"
          opacity={0.1}
        />
        <line x1={m.left} y1={yOf(hi)} x2={m.left + iw} y2={yOf(hi)}
          stroke="var(--teal)" strokeWidth={1} strokeDasharray="4 4" opacity={0.45} />
        <line x1={m.left} y1={yOf(lo)} x2={m.left + iw} y2={yOf(lo)}
          stroke="var(--teal)" strokeWidth={1} strokeDasharray="4 4" opacity={0.45} />
        {/* y grid + labels */}
        {yticks.map((t, i) => (
          <g key={'y' + i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={m.left - 8} y={yOf(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--text-dim)">
              {toDisplay(t)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xticks.map((i) => (
          <text key={'x' + i} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-dim)">
            {data[i].time.toLocaleTimeString([], { hour: 'numeric' })}
          </text>
        ))}
        {/* area + line */}
        <path
          d={`${smoothPath(pts)} L${pts[n - 1].x} ${m.top + ih} L${pts[0].x} ${m.top + ih} Z`}
          fill={`url(#${gid})`}
          stroke="none"
        />
        <path d={smoothPath(pts)} fill="none" stroke="var(--purple)" strokeWidth={2.2}
          strokeLinecap="round" strokeLinejoin="round" />
        {/* hover guide */}
        {hover !== null && (
          <g>
            <line x1={xOf(hover)} y1={m.top} x2={xOf(hover)} y2={m.top + ih}
              stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            <circle cx={xOf(hover)} cy={yOf(data[hover].value)} r={4}
              fill="var(--surface)" stroke="var(--purple)" strokeWidth={2.4} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <Tooltip
          x={xOf(hover)}
          width={width}
          title={fmtTime(data[hover].time)}
          rows={[
            { color: 'var(--purple)', label: 'Glucose', value: `${toDisplay(data[hover].value)} ${unit}` },
          ]}
        />
      )}
    </div>
  )
}
