'use client'

import { clampN } from './chart-utils'

export interface TooltipRow {
  color: string
  label: string
  value: string
}

interface Props {
  x: number
  width: number
  title: string
  rows: TooltipRow[]
}

export function Tooltip({ x, width, title, rows }: Props) {
  const left = clampN(x, 70, width - 70)
  return (
    <div className="chart-tip" style={{ left, transform: 'translate(-50%, 0)' }}>
      <div className="chart-tip-title">{title}</div>
      {rows.map((r, i) => (
        <div className="chart-tip-row" key={i}>
          <span className="chart-tip-dot" style={{ background: r.color }} />
          <span className="chart-tip-label">{r.label}</span>
          <span className="chart-tip-val">{r.value}</span>
        </div>
      ))}
    </div>
  )
}
