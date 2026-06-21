'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { DualAxisChart } from '../charts/DualAxisChart'
import { ScatterChart, type ScatterPoint } from '../charts/ScatterChart'
import { fmtDay } from '../charts/chart-utils'
import { pairedNonNull, MIN_PAIRED_N } from '../charts/stats'
import { METRICS, METRIC_INDEX, PRESETS, SOURCE_LABELS, type MetricDef, type SourceKey } from '../connections/metrics'
import { buildInsight } from '../connections/insight'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]      // already range-sliced
}

const SOURCE_ORDER: SourceKey[] = ['whoop', 'withings', 'nightscout']

function MetricSelect({
  value,
  onChange,
  exclude,
  label,
}: {
  value: string
  onChange: (id: string) => void
  exclude: string
  label: string
}) {
  return (
    <div className="corr-pick">
      <span className="corr-pick-lbl">{label}</span>
      <div className="select-wrap conn-select">
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          {SOURCE_ORDER.map((src) => (
            <optgroup key={src} label={SOURCE_LABELS[src]}>
              {METRICS.filter((m) => m.source === src).map((m) => (
                <option key={m.id} value={m.id} disabled={m.id === exclude}>
                  {m.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown size={15} />
      </div>
    </div>
  )
}

function RBadge({ r, n, enough }: { r: number; n: number; enough: boolean }) {
  const a = Math.abs(r)
  const baseColor = a >= 0.6 ? 'var(--teal)' : a >= 0.4 ? 'var(--amber)' : 'var(--text-muted)'
  const color = enough ? baseColor : 'var(--text-dim)'
  const strength = enough
    ? a >= 0.6 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'mild' : 'weak'
    : 'n too low'
  return (
    <span
      className="r-badge"
      style={{
        color,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
        opacity: enough ? 1 : 0.7,
      }}
      title={enough ? `r computed over ${n} paired days` : `Need at least ${MIN_PAIRED_N} paired days to score; have ${n}.`}
    >
      {enough
        ? `r = ${r >= 0 ? '+' : '−'}${Math.abs(r).toFixed(2)}`
        : `r —`}
      <span className="r-strength">{strength}</span>
      <span className="r-strength" style={{ opacity: 0.75 }}>· n = {n}</span>
    </span>
  )
}

export function CorrelationExplorerPanel({ series }: Props) {
  const [aId, setAId] = useState('sleepHours')
  const [bId, setBId] = useState('sys')
  const A: MetricDef = METRIC_INDEX[aId]
  const B: MetricDef = METRIC_INDEX[bId]

  const xs = useMemo(() => series.map(A.acc), [series, A])
  const ys = useMemo(() => series.map(B.acc), [series, B])

  // Honesty layer: r/insight/scatter all from non-null pairs only.
  // The dual-axis overlay draws each series independently (gaps across nulls
  // are handled inside DualAxisChart).
  const insight = useMemo(() => buildInsight(xs, ys, A, B), [xs, ys, A, B])

  const points: ScatterPoint[] = useMemo(() => {
    const p = pairedNonNull(xs, ys)
    return p.idx.map((srcIdx, i) => ({
      x: p.xs[i],
      y: p.ys[i],
      label: fmtDay(new Date(series[srcIdx].date)),
    }))
  }, [xs, ys, series])

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Sparkles size={18} />}
        title="Correlation Explorer"
        accent="var(--teal)"
        right={<span className="muted-note">Whoop · Withings · Nightscout — association only, not causation</span>}
      />

      <div className="corr-controls">
        <MetricSelect value={aId} onChange={setAId} exclude={bId} label="Metric A" />
        <span className="corr-vs">vs</span>
        <MetricSelect value={bId} onChange={setBId} exclude={aId} label="Metric B" />
        <div className="corr-presets">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`chip ${aId === p.a && bId === p.b ? 'active' : ''}`}
              onClick={() => { setAId(p.a); setBId(p.b) }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="corr-grid">
        <div className="corr-overlay">
          <div className="chart-caption sm">
            <span>Time overlay</span>
            <span className="legend">
              <span className="legend-item">
                <span className="legend-dash" style={{ background: A.color }} />
                {A.short}
              </span>
              <span className="legend-item">
                <span
                  className="legend-dash"
                  style={{
                    backgroundImage: `repeating-linear-gradient(90deg, ${B.color} 0 4px, transparent 4px 7px)`,
                  }}
                />
                {B.short}
              </span>
            </span>
          </div>
          <DualAxisChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={250}
            a={{ accessor: A.acc, color: A.color, label: A.label, unit: A.unit, fmt: (v) => A.fmt(v) }}
            b={{ accessor: B.acc, color: B.color, label: B.label, unit: B.unit, fmt: (v) => B.fmt(v) }}
          />
        </div>
        <div className="corr-scatter">
          <div className="chart-caption sm">
            <span>{A.short} vs {B.short}</span>
            <RBadge r={insight.r} n={insight.n} enough={insight.enough} />
          </div>
          <ScatterChart
            points={points}
            height={250}
            color={B.color}
            xLabel={A.short}
            yLabel={B.short}
            xUnit={A.unit}
            yUnit={B.unit}
            fmtX={(v) => A.fmt(v)}
            fmtY={(v) => B.fmt(v)}
            showFit={insight.enough}
          />
        </div>
      </div>

      <div className="insight" style={insight.enough ? undefined : { opacity: 0.85 }}>
        <span className="insight-icon"><Sparkles size={16} /></span>
        <p>{insight.sentence}</p>
      </div>
    </Card>
  )
}
