'use client'

import { useCallback, useState } from 'react'
import { useMeasure } from './useMeasure'
import { clampN, fmtDay, smoothPath } from './chart-utils'
import { Tooltip, type TooltipRow } from './Tooltip'

export interface TrendBand {
  from: number
  to: number
  color: string
  opacity?: number
}

export interface TrendSeries<T> {
  accessor: (d: T) => number | null
  color: string
  label: string
  fill?: boolean
  width?: number
  dash?: string
}

interface Props<T> {
  data: T[]
  xAccessor: (d: T) => Date
  series: TrendSeries<T>[]
  bands?: TrendBand[]
  height?: number
  yDomain?: [number, number]
  yTicks?: number
  formatY?: (v: number) => string
  formatX?: (v: Date, i: number) => string
  tooltipRows?: (d: T) => TooltipRow[]
  unit?: string
  maxXTicks?: number
}

/**
 * Multi-series line chart with shaded bands + hover tooltip. Ported from
 * prototype-src/06-charts.jsx::TrendChart. Series whose accessor returns null
 * for a point are gracefully skipped (the line breaks across the gap).
 */
export function TrendChart<T>({
  data,
  xAccessor,
  series,
  bands = [],
  height = 260,
  yDomain,
  yTicks = 4,
  formatY = (v) => String(v),
  formatX = fmtDay,
  tooltipRows,
  unit = '',
  maxXTicks = 7,
}: Props<T>) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const width = w || 600
  const m = { top: 14, right: 14, bottom: 26, left: 38 }
  const iw = Math.max(10, width - m.left - m.right)
  const ih = height - m.top - m.bottom
  const n = data.length

  if (n === 0) {
    return (
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div className="empty-note">No data in this window</div>
      </div>
    )
  }

  const allVals: number[] = []
  for (const s of series)
    for (const d of data) {
      const v = s.accessor(d)
      if (v !== null && Number.isFinite(v)) allVals.push(v)
    }
  for (const b of bands) {
    allVals.push(b.from, b.to)
  }
  let lo = yDomain ? yDomain[0] : (allVals.length ? Math.min(...allVals) : 0)
  let hi = yDomain ? yDomain[1] : (allVals.length ? Math.max(...allVals) : 1)
  if (!yDomain) {
    const pad = (hi - lo) * 0.12 || 1
    lo -= pad
    hi += pad
  }

  const xOf = (i: number) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw)
  const yOf = (v: number) => m.top + ih - ((v - lo) / (hi - lo)) * ih

  const ticks: number[] = []
  for (let i = 0; i <= yTicks; i++) ticks.push(lo + ((hi - lo) * i) / yTicks)

  const xTickIdx: number[] = []
  const step = Math.max(1, Math.ceil(n / maxXTicks))
  for (let i = 0; i < n; i += step) xTickIdx.push(i)
  if (xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1)

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left - m.left
      const idx = Math.round(clampN((x / iw) * (n - 1), 0, n - 1))
      setHover(idx)
    },
    [iw, n, m.left]
  )

  // For each series, segment points by null-gaps so smoothPath doesn't span them.
  function buildSegments(s: TrendSeries<T>): Array<Array<{ x: number; y: number }>> {
    const segs: Array<Array<{ x: number; y: number }>> = []
    let cur: Array<{ x: number; y: number }> = []
    data.forEach((d, i) => {
      const v = s.accessor(d)
      if (v === null || !Number.isFinite(v)) {
        if (cur.length) {
          segs.push(cur)
          cur = []
        }
      } else {
        cur.push({ x: xOf(i), y: yOf(v) })
      }
    })
    if (cur.length) segs.push(cur)
    return segs
  }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* shaded zones */}
        {bands.map((b, i) => (
          <rect
            key={'b' + i}
            x={m.left}
            y={yOf(b.to)}
            width={iw}
            height={Math.max(0, yOf(b.from) - yOf(b.to))}
            fill={b.color}
            opacity={b.opacity ?? 0.08}
          />
        ))}
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={'g' + i}>
            <line
              x1={m.left}
              y1={yOf(t)}
              x2={m.left + iw}
              y2={yOf(t)}
              stroke="var(--grid)"
              strokeWidth={1}
            />
            <text
              x={m.left - 8}
              y={yOf(t) + 3.5}
              textAnchor="end"
              fontSize="10.5"
              fill="var(--text-dim)"
            >
              {formatY(t)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xTickIdx.map((i) => (
          <text
            key={'x' + i}
            x={xOf(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="10.5"
            fill="var(--text-dim)"
          >
            {formatX(xAccessor(data[i]), i)}
          </text>
        ))}
        {/* series */}
        {series.map((s, si) => {
          const segs = buildSegments(s)
          return (
            <g key={'s' + si}>
              {s.fill &&
                segs.map((pts, gi) =>
                  pts.length > 1 ? (
                    <path
                      key={`f${si}-${gi}`}
                      d={`${smoothPath(pts)} L${pts[pts.length - 1].x} ${m.top + ih} L${pts[0].x} ${m.top + ih} Z`}
                      fill={s.color}
                      opacity={0.1}
                      stroke="none"
                    />
                  ) : null
                )}
              {segs.map((pts, gi) => (
                <path
                  key={`l${si}-${gi}`}
                  d={smoothPath(pts)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={s.width || 2.2}
                  strokeDasharray={s.dash || undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
            </g>
          )
        })}
        {/* hover guide */}
        {hover !== null && (
          <g>
            <line
              x1={xOf(hover)}
              y1={m.top}
              x2={xOf(hover)}
              y2={m.top + ih}
              stroke="var(--text-dim)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.6}
            />
            {series.map((s, si) => {
              const v = s.accessor(data[hover])
              if (v === null || !Number.isFinite(v)) return null
              return (
                <circle
                  key={'h' + si}
                  cx={xOf(hover)}
                  cy={yOf(v)}
                  r={3.8}
                  fill="var(--surface)"
                  stroke={s.color}
                  strokeWidth={2.4}
                />
              )
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <Tooltip
          x={xOf(hover)}
          width={width}
          title={formatX(xAccessor(data[hover]), hover)}
          rows={
            tooltipRows
              ? tooltipRows(data[hover])
              : series
                  .map((s) => {
                    const v = s.accessor(data[hover])
                    return v === null || !Number.isFinite(v)
                      ? null
                      : {
                          color: s.color,
                          label: s.label,
                          value: `${formatY(v)}${unit}`,
                        }
                  })
                  .filter((r): r is TooltipRow => r !== null)
          }
        />
      )}
    </div>
  )
}
