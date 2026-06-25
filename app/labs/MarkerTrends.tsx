'use client'

import { useMemo, useState } from 'react'
import { LineChart } from 'lucide-react'
import { TrendChart } from '@/components/dashboard/charts/TrendChart'
import { getMarker, KEY_MARKER_SLUGS } from './_lib/markers'
import type { MarkerTrend, MarkerTrendPoint } from './actions'

interface Props {
  trends: MarkerTrend[]
}

interface TrendDay {
  date: Date
  value: number | null
  flag: MarkerTrendPoint['flag']
}

function buildSeries(t: MarkerTrend): TrendDay[] {
  return t.points.map((p) => ({
    date: new Date(p.drawn_at),
    value: p.value,
    flag: p.flag,
  }))
}

/** Conservative y-domain padded around the data range + the reference band. */
function deriveYDomain(t: MarkerTrend): [number, number] | undefined {
  const vals: number[] = []
  for (const p of t.points) {
    vals.push(p.value)
    if (p.ref_low !== null) vals.push(p.ref_low)
    if (p.ref_high !== null) vals.push(p.ref_high)
  }
  if (vals.length === 0) return undefined
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = (max - min) * 0.2 || Math.max(1, Math.abs(max) * 0.1)
  return [min - pad, max + pad]
}

/** Use the latest non-null ref range (labs may report slightly different bands over time). */
function latestRefBand(t: MarkerTrend): { low: number | null; high: number | null } {
  for (let i = t.points.length - 1; i >= 0; i--) {
    const p = t.points[i]
    if (p.ref_low !== null || p.ref_high !== null) return { low: p.ref_low, high: p.ref_high }
  }
  return { low: null, high: null }
}

function TrendCard({ trend }: { trend: MarkerTrend }) {
  const def = getMarker(trend.marker_slug)
  const unit = trend.canonical_unit ?? trend.points[trend.points.length - 1]?.unit ?? ''
  const yDomain = deriveYDomain(trend)
  const ref = latestRefBand(trend)
  const series = buildSeries(trend)
  const latest = trend.points[trend.points.length - 1]

  return (
    <div className="labs-trend-card">
      <div className="labs-trend-head">
        <div className="labs-trend-title">
          {def?.display ?? trend.marker_slug}
          {def?.keyMarker && <span className="labs-key-star">★</span>}
        </div>
        <div className="labs-trend-meta">
          <span className="labs-trend-latest">
            {latest.value}<span className="labs-trend-unit">{unit}</span>
          </span>
          {latest.flag && (
            <span
              className="labs-flag-badge"
              style={{
                color: latest.flag === 'L' || latest.flag === 'H' ? 'var(--amber)' : 'var(--red)',
                borderColor: latest.flag === 'L' || latest.flag === 'H' ? 'var(--amber)' : 'var(--red)',
              }}
            >
              {latest.flag}
            </span>
          )}
          <span className="labs-trend-count">{trend.points.length} draw{trend.points.length === 1 ? '' : 's'}</span>
        </div>
      </div>
      <TrendChart
        data={series}
        xAccessor={(d) => d.date}
        height={160}
        yDomain={yDomain}
        yTicks={4}
        maxXTicks={5}
        formatY={(v) => String(Math.round(v * 100) / 100)}
        bands={
          ref.low !== null && ref.high !== null
            ? [{ from: ref.low, to: ref.high, color: 'var(--teal)', opacity: 0.08 }]
            : []
        }
        series={[
          {
            accessor: (d: TrendDay) => d.value,
            color: 'var(--purple)',
            label: def?.display ?? trend.marker_slug,
            fill: true,
          },
        ]}
        tooltipRows={(d: TrendDay) => {
          const rows: { color: string; label: string; value: string }[] = []
          if (d.value !== null) {
            rows.push({
              color: 'var(--purple)',
              label: def?.display ?? trend.marker_slug,
              value: `${d.value}${unit ? ' ' + unit : ''}`,
            })
          }
          if (d.flag) {
            rows.push({ color: 'var(--amber)', label: 'Flag', value: d.flag })
          }
          return rows
        }}
      />
    </div>
  )
}

export function MarkerTrends({ trends }: Props) {
  // Curated key markers first — those that have ≥1 reading land on top.
  const trendsBySlug = useMemo(() => new Map(trends.map((t) => [t.marker_slug, t])), [trends])
  const keyTrends = KEY_MARKER_SLUGS
    .map((s) => trendsBySlug.get(s))
    .filter((t): t is MarkerTrend => t !== undefined)
  const nonKeyTrends = trends.filter((t) => !KEY_MARKER_SLUGS.includes(t.marker_slug))
  const pickable = nonKeyTrends.filter((t) => t.points.length >= 2)

  const [pickedSlug, setPickedSlug] = useState<string>('')
  const picked = pickedSlug ? trendsBySlug.get(pickedSlug) ?? null : null

  return (
    <section className="labs-card">
      <h2 className="labs-section-title">
        <LineChart size={16} /> Trends
      </h2>
      <p className="labs-section-sub">
        Cardiac key markers (★) trended across every draw. Reference band shaded; flagged points highlighted.
      </p>

      {keyTrends.length === 0 ? (
        <div className="labs-empty">
          No key-marker readings yet. Once a panel includes LDL / HDL / triglycerides / HbA1c / hs-CRP / Lp(a) / fasting glucose / ApoB / non-HDL, those trends populate here.
        </div>
      ) : (
        <div className="labs-trend-grid">
          {keyTrends.map((t) => (
            <TrendCard key={t.marker_slug} trend={t} />
          ))}
        </div>
      )}

      {pickable.length > 0 && (
        <div className="labs-picker">
          <label>
            <span>Trend any marker with ≥2 draws</span>
            <select value={pickedSlug} onChange={(e) => setPickedSlug(e.target.value)}>
              <option value="">— pick a marker —</option>
              {pickable.map((t) => (
                <option key={t.marker_slug} value={t.marker_slug}>
                  {getMarker(t.marker_slug)?.display ?? t.marker_slug} ({t.points.length})
                </option>
              ))}
            </select>
          </label>
          {picked && (
            <div className="labs-trend-grid" style={{ marginTop: 12 }}>
              <TrendCard trend={picked} />
            </div>
          )}
        </div>
      )}
    </section>
  )
}
