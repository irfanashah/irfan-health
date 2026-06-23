'use client'

import { Moon, Flame } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { Legend } from '../ui/Legend'
import { TrendChart } from '../charts/TrendChart'
import { StackedBars, type StackedKey } from '../charts/StackedBars'
import type { DailyMetricRow, LatestKpis } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]
  latest: LatestKpis
  rangeDays: number
}

const SLEEP_KEYS: StackedKey[] = [
  { key: 'deep', label: 'Deep', color: '#6C3FA8' },
  { key: 'light', label: 'Light', color: '#C49AE0' },
  { key: 'rem', label: 'REM', color: '#9B59B6' },
  { key: 'awake', label: 'Awake', color: 'var(--text-dim)' },
]

export function RecoverySleepPanel({ series, latest, rangeDays }: Props) {
  const hasRecovery = series.some((d) => d.recovery !== null)
  const sleepLast7 = series.slice(-7).filter((d) => d.sleep_deep !== null)
  const sleepData = sleepLast7.map((d) => ({
    label: new Date(d.date),
    values: {
      deep: d.sleep_deep ?? 0,
      light: d.sleep_light ?? 0,
      rem: d.sleep_rem ?? 0,
      awake: d.sleep_awake ?? 0,
    },
  }))

  return (
    <Card className="col-5">
      <PanelHeader
        icon={<Moon size={18} />}
        title="Recovery & sleep"
        source="whoop"
        accent="var(--purple)"
        right={
          latest.strain ? (
            <div className="strain-readout">
              <Flame size={14} />
              <span>Strain {latest.strain.value.toFixed(1)}</span>
              <span className="strain-sub">/21</span>
            </div>
          ) : null
        }
      />
      <div className="chart-caption sm">
        <span>Recovery</span>
        <span className="muted-note">{rangeDays}-day trend</span>
      </div>
      {hasRecovery ? (
        <TrendChart
          data={series}
          xAccessor={(d) => new Date(d.date)}
          height={140}
          yDomain={[30, 90]}
          yTicks={3}
          maxXTicks={5}
          formatY={(v) => `${Math.round(v)}`}
          series={[{ accessor: (d) => d.recovery, color: 'var(--purple)', label: 'Recovery', fill: true }]}
          unit="%"
          tooltipRows={(d) =>
            d.recovery !== null
              ? [{ color: 'var(--purple)', label: 'Recovery', value: `${Math.round(d.recovery)}%` }]
              : []
          }
        />
      ) : (
        <div className="empty-note">No recovery data in this window</div>
      )}
      <div className="chart-caption sm" style={{ marginTop: 14 }}>
        <span>Sleep stages · last 7 nights</span>
      </div>
      <StackedBars data={sleepData} keys={SLEEP_KEYS} height={170} />
      <Legend items={SLEEP_KEYS.map((k) => ({ color: k.color, label: k.label }))} />
    </Card>
  )
}
