'use client'

import { Scale, TrendingDown, TrendingUp } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { TrendChart } from '../charts/TrendChart'
import type { DailyMetricRow, LatestKpis } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]      // already carry-forward-filled for the trend line
  latest: LatestKpis
  rangeDays: number
}

export function WeightPanel({ series, latest, rangeDays }: Props) {
  const hasWeight = series.some((d) => d.weight !== null)
  const first = series.find((d) => d.weight !== null)?.weight ?? null
  const last = [...series].reverse().find((d) => d.weight !== null)?.weight ?? null
  const delta = first !== null && last !== null ? +(last - first).toFixed(1) : null

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Scale size={18} />}
        title="Weight"
        source="withings"
        accent="var(--teal)"
        right={
          delta !== null ? (
            <span className="trend-pill" style={{ color: delta <= 0 ? 'var(--teal)' : 'var(--amber)' }}>
              {delta <= 0 ? <TrendingDown size={14} /> : <TrendingUp size={14} />} {Math.abs(delta)} kg · {rangeDays}d
            </span>
          ) : null
        }
      />
      <div className="big-stat">
        <span className="big-val">{latest.weight ? latest.weight.value.toFixed(1) : '—'}</span>
        <span className="big-unit">kg</span>
      </div>
      {hasWeight ? (
        <TrendChart
          data={series}
          xAccessor={(d) => new Date(d.date)}
          height={188}
          yTicks={4}
          series={[{ accessor: (d) => d.weight, color: 'var(--teal)', label: 'Weight', fill: true }]}
          unit=" kg"
          formatY={(v) => v.toFixed(1)}
          tooltipRows={(d) =>
            d.weight !== null
              ? [{ color: 'var(--teal)', label: 'Weight', value: `${d.weight.toFixed(1)} kg` }]
              : []
          }
        />
      ) : (
        <div className="empty-note">
          No weight readings yet — log one via Quick log or wait for a Withings scale sync
        </div>
      )}
    </Card>
  )
}
