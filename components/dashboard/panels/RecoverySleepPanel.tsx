'use client'

import { Moon, Flame, Activity } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { Legend } from '../ui/Legend'
import { TrendChart } from '../charts/TrendChart'
import { StackedBars, type StackedKey } from '../charts/StackedBars'
import { st, STATUS_COLOR } from '../thresholds'
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
  const hasSpo2 = series.some((d) => d.spo2_avg !== null || d.spo2_min !== null)

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

      {/* ─── Overnight SpO2 (Oxylink) ────────────────────────────────────── */}
      <div className="chart-caption sm" style={{ marginTop: 14 }}>
        <span>Overnight SpO2</span>
        <span className="muted-note">
          {rangeDays}-day trend <span style={{ opacity: 0.7 }}>· via Oxylink</span>
        </span>
      </div>
      {hasSpo2 ? (
        <>
          <TrendChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={150}
            yDomain={[85, 100]}
            yTicks={3}
            maxXTicks={5}
            formatY={(v) => `${Math.round(v)}`}
            bands={[
              // ≥95 normal-band shade, matching the glucose target-band style.
              { from: 95, to: 100, color: 'var(--teal)', opacity: 0.10 },
            ]}
            series={[
              { accessor: (d) => d.spo2_avg, color: 'var(--teal)',   label: 'Avg', fill: true },
              { accessor: (d) => d.spo2_min, color: 'var(--purple)', label: 'Min', dash: '4 4' },
            ]}
            unit="%"
            tooltipRows={(d) => {
              const rows: { color: string; label: string; value: string }[] = []
              if (d.spo2_avg !== null) rows.push({ color: 'var(--teal)',   label: 'Avg', value: `${Math.round(d.spo2_avg)}%` })
              if (d.spo2_min !== null) rows.push({ color: 'var(--purple)', label: 'Min', value: `${Math.round(d.spo2_min)}%` })
              return rows
            }}
          />
          <Legend
            items={[
              { color: 'var(--teal)',   label: 'Avg' },
              { color: 'var(--purple)', label: 'Min', dash: true },
            ]}
          />
          {latest.spo2 && (
            <div
              style={{
                marginTop: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 12.5,
                color: 'var(--text-muted)',
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: STATUS_COLOR[st.spo2(latest.spo2.avg)],
                  }}
                />
                <Activity size={12} />
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>Last night</span>
              </span>
              <span>
                avg <b style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(latest.spo2.avg)}%</b>
                <span style={{ marginLeft: 10 }}>
                  min <b style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(latest.spo2.min)}%</b>
                </span>
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="empty-note">No SpO2 data in this window</div>
      )}
    </Card>
  )
}
