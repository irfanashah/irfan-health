'use client'

import { useState } from 'react'
import { useMeasure } from './useMeasure'
import { fmtDay, fmtDayShort } from './chart-utils'
import { Tooltip } from './Tooltip'

export interface StackedKey {
  key: string
  label: string
  color: string
}

export interface StackedDatum {
  label: Date | string
  values: Record<string, number>
}

interface Props {
  data: StackedDatum[]
  keys: StackedKey[]
  height?: number
  formatX?: (v: Date | string) => string
  unit?: string
}

/** Stacked bar chart — sleep stages. Ported from 06-charts.jsx::StackedBars. */
export function StackedBars({
  data,
  keys,
  height = 200,
  formatX,
  unit = 'h',
}: Props) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)

  if (data.length === 0) {
    return (
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div className="empty-note">No sleep data in this window</div>
      </div>
    )
  }

  const fmt = formatX ?? ((v: Date | string) => (typeof v === 'string' ? v : fmtDayShort(v)))
  const width = w || 500
  const m = { top: 12, right: 8, bottom: 24, left: 30 }
  const iw = Math.max(10, width - m.left - m.right)
  const ih = height - m.top - m.bottom
  const n = data.length
  const totals = data.map((d) => keys.reduce((a, k) => a + (d.values[k.key] || 0), 0))
  const maxT = (Math.max(...totals) || 1) * 1.05
  const yOf = (v: number) => m.top + ih - (v / maxT) * ih
  const bw = Math.min(34, (iw / n) * 0.62)
  const xOf = (i: number) => m.left + (i + 0.5) * (iw / n)

  const yticks = [0, maxT / 2, maxT]

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {yticks.map((t, i) => (
          <g key={i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={m.left - 6} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-dim)">
              {Math.round(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          let yAcc = 0
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect
                x={xOf(i) - iw / n / 2}
                y={m.top}
                width={iw / n}
                height={ih}
                fill="transparent"
              />
              {keys.map((k, ki) => {
                const v = d.values[k.key] || 0
                const h = (v / maxT) * ih
                const y = m.top + ih - yAcc - h
                yAcc += h
                const top = ki === keys.length - 1
                return (
                  <rect
                    key={ki}
                    x={xOf(i) - bw / 2}
                    y={y}
                    width={bw}
                    height={Math.max(0, h - 1)}
                    fill={k.color}
                    rx={top ? 3 : 0}
                    opacity={hover === null || hover === i ? 1 : 0.45}
                  />
                )
              })}
              <text x={xOf(i)} y={height - 7} textAnchor="middle" fontSize="10" fill="var(--text-dim)">
                {fmt(d.label)}
              </text>
            </g>
          )
        })}
      </svg>
      {hover !== null && (
        <Tooltip
          x={xOf(hover)}
          width={width}
          title={typeof data[hover].label === 'string' ? (data[hover].label as string) : fmtDay(data[hover].label as Date)}
          rows={[...keys].reverse().map((k) => ({
            color: k.color,
            label: k.label,
            value: `${(data[hover].values[k.key] ?? 0).toFixed(1)}${unit}`,
          }))}
        />
      )}
    </div>
  )
}
