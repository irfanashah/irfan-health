'use client'

import { useMemo, useState } from 'react'
import { ArrowUp, ArrowDown, ChevronDown, Info, Stethoscope } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { TrendChart } from '../charts/TrendChart'
import {
  READINESS_WEIGHTS,
  readinessBand,
  readinessSeries,
  resolveTodaySnapshot,
} from '../connections/readiness'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]      // already range-sliced
}

function fmtAsOf(d: Date, today: Date): string {
  const t = new Date(today); t.setHours(0, 0, 0, 0)
  const that = new Date(d); that.setHours(0, 0, 0, 0)
  const days = Math.round((t.getTime() - that.getTime()) / 86400000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Dubai' })
}

export function ReadinessPanel({ series }: Props) {
  const [open, setOpen] = useState(true)

  const today = useMemo(() => resolveTodaySnapshot(series), [series])
  const trend = useMemo(() => readinessSeries(series), [series])

  if (!today) {
    return (
      <Card className="col-7">
        <PanelHeader
          icon={<Stethoscope size={18} />}
          title="Cardiac Readiness"
          accent="var(--teal)"
          right={<span className="muted-note">Blends recovery · HRV · BP · resting HR · sleep</span>}
        />
        <div className="empty-note">
          Not enough complete days in this window yet — needs recovery + HRV + BP + resting HR + sleep all on one day.
        </div>
        <ReadinessCaption />
      </Card>
    )
  }

  const { score, inputs } = today.result
  const band = readinessBand(score)
  const delta = today.prev ? score - today.prev.result.score : null
  const todayDate = series.length ? new Date(series[series.length - 1].date) : new Date()

  return (
    <Card className="col-7">
      <PanelHeader
        icon={<Stethoscope size={18} />}
        title="Cardiac Readiness"
        accent="var(--teal)"
        right={<span className="muted-note">Blends recovery · HRV · BP · resting HR · sleep</span>}
      />

      <div className="readiness-top">
        <div className="readiness-score">
          <div className="readiness-num" style={{ color: band.color }}>{score}</div>
          <div className="readiness-meta">
            <span className="readiness-band" style={{ color: band.color }}>{band.label}</span>
            <span
              className="readiness-delta"
              style={{ color: delta === null ? 'var(--text-dim)' : delta >= 0 ? 'var(--teal)' : 'var(--amber)' }}
            >
              {delta === null
                ? '— first scored day in window'
                : `${delta >= 0 ? '▲' : '▼'} ${Math.abs(delta)} vs ${fmtAsOf(new Date(today.prev!.row.date), todayDate)}`}
            </span>
            {today.fallback && (
              <span className="muted-note" style={{ marginTop: 2 }}>
                As of {fmtAsOf(new Date(today.row.date), todayDate)} · today’s cycle isn’t scored yet
              </span>
            )}
          </div>
        </div>
        <div className="readiness-chart">
          <TrendChart
            data={trend}
            xAccessor={(d) => d.date}
            height={120}
            yDomain={[30, 90]}
            yTicks={3}
            maxXTicks={5}
            formatY={(v) => `${Math.round(v)}`}
            series={[{ accessor: (d) => d.score, color: 'var(--teal)', label: 'Readiness', fill: true }]}
            unit=""
            tooltipRows={(d) => [{ color: 'var(--teal)', label: 'Readiness', value: String(Math.round(d.score)) }]}
          />
        </div>
      </div>

      <button type="button" className="expand-btn" onClick={() => setOpen(!open)}>
        <ChevronDown
          size={15}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
        />
        {open ? 'Hide' : 'What’s driving today’s score'}
      </button>

      {open && (
        <div className="drivers">
          {inputs.map((inp) => {
            const lifting = inp.delta >= 0
            return (
              <div className="driver" key={inp.key}>
                <span className="driver-lbl">
                  {inp.label}
                  <span style={{ color: 'var(--text-dim)', marginLeft: 6, fontWeight: 500 }}>
                    {Math.round(inp.weight * 100)}%
                  </span>
                </span>
                <div className="driver-bar">
                  <div
                    className="driver-fill"
                    style={{
                      width: `${inp.score}%`,
                      background: lifting ? 'var(--teal)' : 'var(--amber)',
                    }}
                  />
                </div>
                <span className="driver-score">{inp.score}</span>
                <span
                  className="driver-tag"
                  style={{ color: lifting ? 'var(--teal)' : 'var(--amber)' }}
                >
                  {lifting ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                  {lifting ? 'lifting' : 'dragging'}
                </span>
              </div>
            )
          })}
        </div>
      )}

      <ReadinessCaption />

      {/* Documented breakdown so the weighting is never a black box. */}
      <details style={{ marginTop: 12 }}>
        <summary
          style={{
            cursor: 'pointer',
            fontSize: 11.5,
            color: 'var(--text-dim)',
            fontWeight: 600,
          }}
        >
          How this is computed
        </summary>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.5 }}>
          Weighted blend of five daily sub-scores, each normalised 0–100:
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
            {READINESS_WEIGHTS.map((w) => (
              <li key={w.key}>
                {w.label} — {Math.round(w.weight * 100)}%
              </li>
            ))}
          </ul>
          A day is only scored if all five inputs are present — no renormalising over missing inputs.
        </div>
      </details>
    </Card>
  )
}

function ReadinessCaption() {
  return (
    <div className="headline-note" style={{ marginTop: 14 }}>
      <Info size={13} />
      <span>
        An at-a-glance blend of your recovery signals — <b>an interpretable heuristic, not a medical assessment.</b>
      </span>
    </div>
  )
}
