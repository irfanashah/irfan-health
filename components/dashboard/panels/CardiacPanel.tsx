'use client'

import { Heart } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { Legend } from '../ui/Legend'
import { TrendChart } from '../charts/TrendChart'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'
import type { LatestKpis } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]
  latest: LatestKpis
}

export function CardiacPanel({ series, latest }: Props) {
  const hasAnyBp = series.some((d) => d.sys !== null)
  const hasAnyRhrHrv = series.some((d) => d.rhr !== null || d.hrv !== null)

  return (
    <Card className="col-12 hero">
      <PanelHeader
        icon={<Heart size={18} />}
        title="Cardiac"
        source="withings"
        accent="var(--red)"
        right={
          <Legend
            items={[
              { color: 'var(--red)', label: 'Systolic' },
              { color: 'var(--teal)', label: 'Diastolic' },
            ]}
          />
        }
      />
      <div className="cardiac-grid">
        <div className="cardiac-main">
          <div className="chart-caption">
            <span>Blood pressure</span>
            <span className="muted-note">mmHg · healthy &lt; 120/80 · elevated zones shaded</span>
          </div>
          {hasAnyBp ? (
            <TrendChart
              data={series}
              xAccessor={(d) => new Date(d.date)}
              height={300}
              yDomain={[60, 160]}
              yTicks={5}
              bands={[
                { from: 120, to: 130, color: 'var(--amber)', opacity: 0.07 },
                { from: 130, to: 160, color: 'var(--red)', opacity: 0.07 },
                { from: 60, to: 120, color: 'var(--teal)', opacity: 0.05 },
              ]}
              series={[
                { accessor: (d) => d.sys, color: 'var(--red)', label: 'Systolic', fill: false },
                { accessor: (d) => d.dia, color: 'var(--teal)', label: 'Diastolic', fill: false },
              ]}
              tooltipRows={(d) => [
                ...(d.sys !== null ? [{ color: 'var(--red)', label: 'Systolic', value: `${d.sys} mmHg` }] : []),
                ...(d.dia !== null ? [{ color: 'var(--teal)', label: 'Diastolic', value: `${d.dia} mmHg` }] : []),
                ...(d.pulse !== null ? [{ color: 'var(--text-muted)', label: 'Pulse', value: `${d.pulse} bpm` }] : []),
              ]}
              formatY={(v) => `${Math.round(v)}`}
            />
          ) : (
            <div className="empty-note">No BP readings in this window</div>
          )}
        </div>
        <div className="cardiac-side">
          <div className="mini-stat-row">
            <div className="mini-stat">
              <div className="mini-lbl">Resting HR</div>
              <div className="mini-val">
                {latest.rhr ? Math.round(latest.rhr.value) : '—'}
                <span>bpm</span>
              </div>
            </div>
            <div className="mini-stat">
              <div className="mini-lbl">HRV</div>
              <div className="mini-val">
                {latest.hrv ? Math.round(latest.hrv.value) : '—'}
                <span>ms</span>
              </div>
            </div>
          </div>
          <div className="chart-caption sm">
            <span>Resting HR &amp; HRV</span>
            <Legend
              items={[
                { color: 'var(--purple)', label: 'RHR' },
                { color: 'var(--teal)', label: 'HRV' },
              ]}
            />
          </div>
          {hasAnyRhrHrv ? (
            <TrendChart
              data={series}
              xAccessor={(d) => new Date(d.date)}
              height={188}
              yDomain={[30, 70]}
              yTicks={4}
              maxXTicks={5}
              formatY={(v) => `${Math.round(v)}`}
              series={[
                { accessor: (d) => d.rhr, color: 'var(--purple)', label: 'Resting HR', fill: true },
                { accessor: (d) => d.hrv, color: 'var(--teal)', label: 'HRV', fill: false },
              ]}
              tooltipRows={(d) => [
                ...(d.rhr !== null ? [{ color: 'var(--purple)', label: 'Resting HR', value: `${Math.round(d.rhr)} bpm` }] : []),
                ...(d.hrv !== null ? [{ color: 'var(--teal)', label: 'HRV', value: `${Math.round(d.hrv)} ms` }] : []),
              ]}
            />
          ) : (
            <div className="empty-note">No Whoop RHR/HRV in this window</div>
          )}
        </div>
      </div>
    </Card>
  )
}
