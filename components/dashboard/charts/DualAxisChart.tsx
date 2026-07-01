'use client'

import { useCallback, useState } from 'react'
import { useMeasure } from './useMeasure'
import { clampN, fmtDay, smoothPath } from './chart-utils'
import { Tooltip } from './Tooltip'

export interface DualAxisSeries<T> {
  accessor: (d: T) => number | null
  color: string
  label: string
  unit?: string
  fmt?: (v: number) => string | number
}

interface Props<T> {
  data: T[]
  xAccessor: (d: T) => Date
  a: DualAxisSeries<T>
  b: DualAxisSeries<T>
  height?: number
  formatX?: (v: Date, i: number) => string
  maxXTicks?: number
}

/**
 * Two series, independent left/right y-axes, shared x. Ported from
 * prototype-src/06-charts.jsx::DualAxisChart. Series accessors that return
 * null break the line across that point (same convention as TrendChart).
 */
export function DualAxisChart<T>({
  data,
  xAccessor,
  a,
  b,
  height = 240,
  formatX = fmtDay,
  maxXTicks = 7,
}: Props<T>) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const width = w || 600
  const m = { top: 14, right: 46, bottom: 26, left: 46 }
  const iw = Math.max(10, width - m.left - m.right)
  const ih = height - m.top - m.bottom
  const n = data.length

  // Hoisted above the empty-data guard below — every hook must run
  // unconditionally on every render, in the same order, regardless of `n`.
  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left - m.left
      setHover(Math.round(clampN((x / iw) * (n - 1), 0, n - 1)))
    },
    [iw, n, m.left]
  )

  if (n === 0) {
    return (
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div className="empty-note">No data in this window</div>
      </div>
    )
  }

  function domain(acc: (d: T) => number | null): [number, number] {
    const vs: number[] = []
    for (const d of data) {
      const v = acc(d)
      if (v !== null && Number.isFinite(v)) vs.push(v)
    }
    if (vs.length === 0) return [0, 1]
    const lo = Math.min(...vs)
    const hi = Math.max(...vs)
    const p = (hi - lo) * 0.14 || 1
    return [lo - p, hi + p]
  }
  const [aLo, aHi] = domain(a.accessor)
  const [bLo, bHi] = domain(b.accessor)

  const xOf = (i: number) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const aY = (v: number) => m.top + ih - ((v - aLo) / (aHi - aLo)) * ih
  const bY = (v: number) => m.top + ih - ((v - bLo) / (bHi - bLo)) * ih

  // Build segmented point arrays so null gaps don't span across
  function segments(
    acc: (d: T) => number | null,
    y: (v: number) => number
  ): Array<Array<{ x: number; y: number }>> {
    const segs: Array<Array<{ x: number; y: number }>> = []
    let cur: Array<{ x: number; y: number }> = []
    data.forEach((d, i) => {
      const v = acc(d)
      if (v === null || !Number.isFinite(v)) {
        if (cur.length) { segs.push(cur); cur = [] }
      } else {
        cur.push({ x: xOf(i), y: y(v) })
      }
    })
    if (cur.length) segs.push(cur)
    return segs
  }

  const aSegs = segments(a.accessor, aY)
  const bSegs = segments(b.accessor, bY)

  const xTickIdx: number[] = []
  const step = Math.max(1, Math.ceil(n / maxXTicks))
  for (let i = 0; i < n; i += step) xTickIdx.push(i)
  if (xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1)

  const aTicks = [aLo + (aHi - aLo) * 0.1, (aLo + aHi) / 2, aHi - (aHi - aLo) * 0.1]
  const bTicks = [bLo + (bHi - bLo) * 0.1, (bLo + bHi) / 2, bHi - (bHi - bLo) * 0.1]

  const aFmt = a.fmt ?? ((v: number) => Math.round(v))
  const bFmt = b.fmt ?? ((v: number) => Math.round(v))

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg
        width={width} height={height}
        style={{ display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <line x1={m.left} y1={m.top + ih / 2} x2={m.left + iw} y2={m.top + ih / 2} stroke="var(--grid)" strokeWidth={1} />
        {aTicks.map((t, i) => (
          <text key={'a' + i} x={m.left - 7} y={aY(t) + 3.5} textAnchor="end" fontSize="10" fill={a.color} opacity={0.9}>
            {aFmt(t)}
          </text>
        ))}
        {bTicks.map((t, i) => (
          <text key={'b' + i} x={m.left + iw + 7} y={bY(t) + 3.5} textAnchor="start" fontSize="10" fill={b.color} opacity={0.9}>
            {bFmt(t)}
          </text>
        ))}
        {xTickIdx.map((i) => (
          <text key={'x' + i} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-dim)">
            {formatX(xAccessor(data[i]), i)}
          </text>
        ))}
        {aSegs.map((pts, gi) => (
          <path key={`a${gi}`} d={smoothPath(pts)} fill="none" stroke={a.color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {bSegs.map((pts, gi) => (
          <path key={`b${gi}`} d={smoothPath(pts)} fill="none" stroke={b.color} strokeWidth={2.2} strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {hover !== null && (
          <g>
            <line x1={xOf(hover)} y1={m.top} x2={xOf(hover)} y2={m.top + ih} stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            {(() => {
              const av = a.accessor(data[hover])
              return av !== null && Number.isFinite(av) ? (
                <circle cx={xOf(hover)} cy={aY(av)} r={3.8} fill="var(--surface)" stroke={a.color} strokeWidth={2.4} />
              ) : null
            })()}
            {(() => {
              const bv = b.accessor(data[hover])
              return bv !== null && Number.isFinite(bv) ? (
                <circle cx={xOf(hover)} cy={bY(bv)} r={3.8} fill="var(--surface)" stroke={b.color} strokeWidth={2.4} />
              ) : null
            })()}
          </g>
        )}
      </svg>
      {hover !== null && (() => {
        const av = a.accessor(data[hover])
        const bv = b.accessor(data[hover])
        const rows = []
        if (av !== null && Number.isFinite(av)) rows.push({ color: a.color, label: a.label, value: `${aFmt(av)}${a.unit ? ' ' + a.unit : ''}` })
        if (bv !== null && Number.isFinite(bv)) rows.push({ color: b.color, label: b.label, value: `${bFmt(bv)}${b.unit ? ' ' + b.unit : ''}` })
        if (rows.length === 0) return null
        return (
          <Tooltip
            x={xOf(hover)}
            width={width}
            title={formatX(xAccessor(data[hover]), hover)}
            rows={rows}
          />
        )
      })()}
    </div>
  )
}
