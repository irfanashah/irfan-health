'use client'

import { Heart } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { Legend } from '../ui/Legend'
import { TrendChart, type TrendBand } from '../charts/TrendChart'
import { BP_SYS_BANDS, BP_DIA_BANDS, bpCategory } from '../thresholds'
import type { DailyMetricRow, LatestKpis } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]
  latest: LatestKpis
}

// Y-axis for the BP chart — wide enough to comfortably show:
//   diastolic territory ~55–95  (covers Low <60 → Stage 2 90–119)
//   systolic territory  ~95–185 (covers Low <90 → Stage 2 140–179)
// The visual divider sits at 95 (just below Irfan's typical systolic and
// just above his typical diastolic).
const BP_Y_MIN = 55
const BP_Y_MAX = 185
const BP_DIVIDER = 95

// Render the ACC/AHA bands on a shared y-axis — diastolic in the lower
// y-region (its own band ranges below ~90), systolic in the upper
// (its own band ranges above ~90). The constants from thresholds.ts
// (BP_SYS_BANDS / BP_DIA_BANDS) already use the correct mmHg values, so
// just concatenate — they don't overlap visually.
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export function CardiacPanel({ series, latest }: Props) {
  const hasAnyBp = series.some((d) => d.sys !== null)
  const hasAnyRhrHrv = series.some((d) => d.rhr !== null || d.hrv !== null)

  // Combined ACC/AHA category for the latest reading (readout above the chart).
  // Hidden when no BP — the panel still renders the chart's empty-note.
  const latestCategory = latest.bp ? bpCategory(latest.bp.sys, latest.bp.dia) : null

  // Stacked-territory bands: diastolic + systolic on the same y-axis.
  const bpBands: TrendBand[] = [...BP_DIA_BANDS, ...BP_SYS_BANDS]

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
          {/* ACC/AHA category readout — combined classification of the
              latest reading (the spec's "combination" view: chart + status). */}
          {latestCategory && latest.bp && (
            <div
              className="bp-category"
              style={{
                borderLeft: `3px solid ${latestCategory.color}`,
              }}
            >
              <span
                className="bp-category-dot"
                style={{ background: latestCategory.color }}
              />
              <span className="bp-category-label" style={{ color: latestCategory.color }}>
                {latestCategory.label}
              </span>
              <span className="bp-category-val">
                {Math.round(latest.bp.sys)}/{Math.round(latest.bp.dia)}
                <span className="bp-category-unit">mmHg</span>
              </span>
              <span className="bp-category-when">as of {fmtDate(latest.bp.at)}</span>
            </div>
          )}
          <div className="chart-caption">
            <span>Blood pressure</span>
            <span className="muted-note">ACC/AHA zones · diastolic lower · systolic upper</span>
          </div>
          {hasAnyBp ? (
            <TrendChart
              data={series}
              xAccessor={(d) => new Date(d.date)}
              height={300}
              yDomain={[BP_Y_MIN, BP_Y_MAX]}
              yTicks={6}
              bands={bpBands}
              divider={{
                value: BP_DIVIDER,
                labelAbove: 'Systolic',
                labelBelow: 'Diastolic',
              }}
              series={[
                { accessor: (d) => d.sys, color: 'var(--red)', label: 'Systolic', fill: false },
                { accessor: (d) => d.dia, color: 'var(--teal)', label: 'Diastolic', fill: false },
              ]}
              tooltipRows={(d) => {
                const rows: { color: string; label: string; value: string }[] = []
                if (d.sys !== null) rows.push({ color: 'var(--red)', label: 'Systolic', value: `${d.sys} mmHg` })
                if (d.dia !== null) rows.push({ color: 'var(--teal)', label: 'Diastolic', value: `${d.dia} mmHg` })
                if (d.pulse !== null) rows.push({ color: 'var(--text-muted)', label: 'Pulse', value: `${d.pulse} bpm` })
                if (d.sys !== null && d.dia !== null) {
                  const cat = bpCategory(d.sys, d.dia)
                  rows.push({ color: cat.color, label: 'Category', value: cat.label })
                }
                return rows
              }}
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
