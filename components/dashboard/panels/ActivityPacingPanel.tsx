'use client'

import { useMemo } from 'react'
import { Footprints } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { DualAxisChart } from '../charts/DualAxisChart'
import { pearson, pairedNonNull, strengthWord, MIN_PAIRED_N } from '../charts/stats'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]      // already range-sliced
}

interface LaggedRow {
  date: Date
  strain: number | null
  nextRecovery: number | null
  nextRhr: number | null
}

function buildLagged(series: DailyMetricRow[]): LaggedRow[] {
  const out: LaggedRow[] = []
  for (let i = 0; i < series.length - 1; i++) {
    out.push({
      date: new Date(series[i].date),
      strain: series[i].strain,
      nextRecovery: series[i + 1].recovery,
      nextRhr: series[i + 1].rhr,
    })
  }
  return out
}

export function ActivityPacingPanel({ series }: Props) {
  const lagged = useMemo(() => buildLagged(series), [series])

  // r over the 1-day lag pairing: strain[day] vs recovery[day+1].
  const { r, n, enough } = useMemo(() => {
    const xs = lagged.map((d) => d.strain)
    const ys = lagged.map((d) => d.nextRecovery)
    const p = pairedNonNull(xs, ys)
    if (p.n < 2) return { r: 0, n: p.n, enough: false }
    return { r: pearson(p.xs, p.ys), n: p.n, enough: p.n >= MIN_PAIRED_N }
  }, [lagged])

  // Advice tuned to last recorded strain.
  const lastStrain = [...series].reverse().find((d) => d.strain !== null)?.strain ?? null
  const advice = lastStrain === null
    ? { color: 'var(--text-dim)', text: 'No recent strain logged — pacing read defers until Whoop scores a cycle.' }
    : lastStrain > 9
      ? { color: 'var(--amber)', text: 'Yesterday ran heavier — a gentler day pairs well after high-strain nights.' }
      : lastStrain < 6
        ? { color: 'var(--teal)', text: 'Light load yesterday — recovery has typically held up well after days like this.' }
        : { color: 'var(--teal)', text: 'Moderate load — recovery has stayed steady across days in this range.' }

  const a = Math.abs(r)
  const badgeColor = enough
    ? (a >= 0.6 ? 'var(--teal)' : a >= 0.4 ? 'var(--amber)' : 'var(--text-muted)')
    : 'var(--text-dim)'

  return (
    <Card className="col-7">
      <PanelHeader
        icon={<Footprints size={18} />}
        title="Activity → recovery pacing"
        accent="var(--amber)"
        right={
          <span
            className="r-badge"
            style={{
              color: badgeColor,
              borderColor: `color-mix(in srgb, ${badgeColor} 40%, transparent)`,
              opacity: enough ? 1 : 0.7,
            }}
            title={enough ? `r over ${n} paired (strain, next-day recovery) days` : `Need ≥ ${MIN_PAIRED_N} paired days; have ${n}.`}
          >
            {enough
              ? `r = ${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`
              : 'r —'}
            <span className="r-strength">{enough ? strengthWord(r) : 'n too low'}</span>
            <span className="r-strength" style={{ opacity: 0.75 }}>· n = {n}</span>
          </span>
        }
      />

      <div className="chart-caption sm">
        <span>Yesterday’s strain vs next-day recovery</span>
        <span className="legend">
          <span className="legend-item">
            <span className="legend-dash" style={{ background: 'var(--amber)' }} />
            Strain
          </span>
          <span className="legend-item">
            <span
              className="legend-dash"
              style={{
                backgroundImage: 'repeating-linear-gradient(90deg, var(--purple) 0 4px, transparent 4px 7px)',
              }}
            />
            Next-day recovery
          </span>
        </span>
      </div>
      <DualAxisChart
        data={lagged}
        xAccessor={(d) => d.date}
        height={210}
        a={{ accessor: (d) => d.strain, color: 'var(--amber)', label: 'Strain', unit: '', fmt: (v) => v.toFixed(1) }}
        b={{ accessor: (d) => d.nextRecovery, color: 'var(--purple)', label: 'Next-day recovery', unit: '%', fmt: (v) => `${Math.round(v)}` }}
      />
      <div
        className="pacing-advice"
        style={{ borderColor: `color-mix(in srgb, ${advice.color} 35%, transparent)` }}
      >
        <span style={{ color: advice.color }}><Footprints size={16} /></span>
        <span><b>Cleared for walking only.</b> {advice.text}</span>
      </div>
      {!enough && (
        <div className="muted-note" style={{ marginTop: 8 }}>
          n = {n} paired (strain, next-day recovery) days — at least {MIN_PAIRED_N} needed to score the link.
        </div>
      )}
    </Card>
  )
}
