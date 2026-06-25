'use client'

import { Wind } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { Donut } from '../charts/Donut'
import { TrendChart } from '../charts/TrendChart'
import { Spo2OvernightChart } from '../charts/Spo2OvernightChart'
import { st, STATUS_COLOR, LOW_FLOOR_PROVISIONAL_NOTE } from '../thresholds'
import type {
  DailyMetricRow,
  LatestKpis,
  Spo2NightPayload,
} from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]
  latest: LatestKpis
  night: Spo2NightPayload | null
  rangeDays: number
}

function fmtWakeDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * Overnight Oxygen — Oxylink desaturation panel. Modelled on GlucosePanel.
 *
 * Surfaces the highest-value untapped signal in the platform: nocturnal
 * desaturation (ODI + time-below-90%) computed at full ~4 s resolution at
 * ingest, plus the SpO2 distribution donut and a band-shaded overnight trace.
 *
 * SCREENING-GRADE only. All clinical numbers (ODI severity, low-floor band)
 * are provisional pending Dr. Jose.
 */
export function OvernightOxygenPanel({ series, latest, night, rangeDays }: Props) {
  const curve = night?.curve ?? null
  const events = night?.events ?? []
  const hasNight = !!latest.spo2
  const hasTrend = series.some((d) => d.spo2_min !== null || d.spo2_odi !== null)

  // Distribution donut: minutes in each band on the latest night.
  const dist = latest.spo2?.distribution
  const distTotal = dist ? Math.max(1, dist.ge95 + dist.b90_94 + dist.lt90) : 1
  const distPct = dist
    ? {
        ge95: Math.round((dist.ge95 / distTotal) * 100),
        b90_94: Math.round((dist.b90_94 / distTotal) * 100),
        lt90: Math.round((dist.lt90 / distTotal) * 100),
      }
    : { ge95: 0, b90_94: 0, lt90: 0 }

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Wind size={18} />}
        title="Overnight oxygen"
        source="oxylink"
        accent="var(--teal)"
      />

      {/* ─── Last-night readout ───────────────────────────────────────── */}
      {hasNight && latest.spo2 ? (
        <div className="spo2-readout">
          <div className="spo2-stat">
            <div className="spo2-stat-k">Min SpO2</div>
            <div className="spo2-stat-v" style={{ color: STATUS_COLOR[st.spo2(latest.spo2.min)] }}>
              {Math.round(latest.spo2.min)}
              <span className="spo2-stat-u">%</span>
            </div>
          </div>
          <div className="spo2-stat">
            <div className="spo2-stat-k">Avg</div>
            <div className="spo2-stat-v">
              {Math.round(latest.spo2.avg)}
              <span className="spo2-stat-u">%</span>
            </div>
          </div>
          <div className="spo2-stat">
            <div className="spo2-stat-k">
              ODI <span className="spo2-stat-tag">screening</span>
            </div>
            <div
              className="spo2-stat-v"
              style={{ color: latest.spo2.odi !== null ? STATUS_COLOR[st.odi(latest.spo2.odi)] : 'var(--text-dim)' }}
            >
              {latest.spo2.odi !== null ? latest.spo2.odi.toFixed(1) : '—'}
              <span className="spo2-stat-u">/h</span>
            </div>
          </div>
          <div className="spo2-stat">
            <div className="spo2-stat-k">Time &lt; 90%</div>
            <div className="spo2-stat-v">
              {latest.spo2.timeBelow90Pct.toFixed(1)}
              <span className="spo2-stat-u">%</span>
            </div>
          </div>
          <div className="spo2-meta">last night · {fmtWakeDate(latest.spo2.at)}</div>
        </div>
      ) : (
        <div className="empty-note">No overnight oxygen reading yet</div>
      )}

      {/* Whoop SpO2 — corroborating only. The Oxylink readout above is the
          authoritative SpO2 (overnight curve + ODI + time-below); this is a
          second-source sanity check, not the headline + NOT a drift metric. */}
      {latest.spo2Whoop && (
        <div className="spo2-corroborate">
          <span className="spo2-corroborate-dot" style={{ background: 'var(--purple)' }} />
          <span className="spo2-corroborate-label">Whoop · corroborating</span>
          <span className="spo2-corroborate-val">{Math.round(latest.spo2Whoop.value)}%</span>
          <span className="spo2-corroborate-source">via Whoop recovery</span>
        </div>
      )}

      {/* ─── Distribution donut ───────────────────────────────────────── */}
      {hasNight && dist && distTotal > 1 ? (
        <div className="spo2-dist">
          <Donut
            size={132}
            thickness={18}
            segments={[
              { value: dist.ge95, color: 'var(--teal)' },
              { value: dist.b90_94, color: 'var(--amber)' },
              { value: dist.lt90, color: 'var(--red)' },
            ]}
            centerLabel={`${distPct.ge95}%`}
            centerSub="in ≥95% band"
          />
          <div className="tir-legend">
            <div className="tir-row">
              <span className="tir-dot" style={{ background: 'var(--teal)' }} />
              ≥95%<b>{distPct.ge95}%</b>
            </div>
            <div className="tir-row">
              <span className="tir-dot" style={{ background: 'var(--amber)' }} />
              90–94%<b>{distPct.b90_94}%</b>
            </div>
            <div className="tir-row">
              <span className="tir-dot" style={{ background: 'var(--red)' }} />
              &lt;90%<b>{distPct.lt90}%</b>
            </div>
          </div>
        </div>
      ) : null}

      {/* ─── Overnight trace (latest night) ───────────────────────────── */}
      <div className="chart-caption">
        <span>Latest night</span>
        <span className="muted-note">
          ≥95% band shaded · 90% reference · desaturation events marked
          {events.length > 0 ? ` (${events.length})` : ''}
        </span>
      </div>
      {curve && curve.length > 0 ? (
        <Spo2OvernightChart data={curve} events={events} />
      ) : (
        <div className="empty-note">No overnight curve yet</div>
      )}

      {/* ─── Range trend: min SpO2 + ODI ──────────────────────────────── */}
      <div className="chart-caption sm" style={{ marginTop: 14 }}>
        <span>Range trend · min SpO2 + ODI</span>
        <span className="muted-note">{rangeDays}-day</span>
      </div>
      {hasTrend ? (
        <TrendChart
          data={series}
          xAccessor={(d) => new Date(d.date)}
          height={150}
          yDomain={[80, 100]}
          yTicks={3}
          maxXTicks={5}
          formatY={(v) => `${Math.round(v)}`}
          bands={[{ from: 95, to: 100, color: 'var(--teal)', opacity: 0.1 }]}
          series={[
            { accessor: (d) => d.spo2_min, color: 'var(--teal)', label: 'Min SpO2', fill: false },
            // ODI scaled into the same y-domain visually (right-axis would be
            // ideal but TrendChart is single-axis; the y-axis labels are SpO2,
            // ODI just shows shape — actual values in tooltip).
            { accessor: (d) => (d.spo2_odi !== null ? 100 - d.spo2_odi : null), color: 'var(--amber)', label: 'ODI (inv)', dash: '4 4' },
          ]}
          unit="%"
          tooltipRows={(d) => {
            const rows: { color: string; label: string; value: string }[] = []
            if (d.spo2_min !== null) rows.push({ color: 'var(--teal)', label: 'Min SpO2', value: `${Math.round(d.spo2_min)}%` })
            if (d.spo2_odi !== null) rows.push({ color: 'var(--amber)', label: 'ODI', value: `${d.spo2_odi.toFixed(1)}/h` })
            if (d.spo2_time_below_90 !== null) rows.push({ color: 'var(--red)', label: 'Time <90%', value: `${d.spo2_time_below_90.toFixed(1)}%` })
            return rows
          }}
        />
      ) : (
        <div className="empty-note">No overnight oxygen data in this window</div>
      )}

      <div className="spo2-foot">{LOW_FLOOR_PROVISIONAL_NOTE} ODI is a screening signal, not a diagnosis.</div>
    </Card>
  )
}
