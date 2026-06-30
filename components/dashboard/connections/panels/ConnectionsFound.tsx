'use client'

import { useMemo, useState, useTransition } from 'react'
import { Sparkles, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { Card } from '../../ui/Card'
import { PanelHeader } from '../../ui/PanelHeader'
import { DualAxisChart } from '../../charts/DualAxisChart'
import { METRIC_INDEX } from '../metrics'
import {
  discoverConnections,
  lagInWords,
  type EngineConnection,
  type DateRange,
  type DiscoverResult,
  GATE_Q,
  GATE_R,
  LMAX,
} from '../engine'
import { MIN_EFFECTIVE_N } from '../../charts/stats'
import { confoundersFor, splitConfounders, type ConfounderItem } from '../confounders'
import { fetchLlmConfounders, type LlmConfounderResult } from '@/app/lib/dashboard/confounder-llm'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  /** Wide-window series — 365 days (spec §1.1). */
  series: DailyMetricRow[]
  /** Med-change reset windows + context_periods(exclude_from_baseline) overlapping the window. */
  exclusions: DateRange[]
  /** Whether the LLM "what else could explain this?" expand is available (key set on the server). */
  llmAvailable: boolean
}

const HONESTY_NOTE =
  'Exploratory associations on your own data — hypotheses to discuss with Dr. Jose, not findings, not causal, not diagnostic. Each connection survived a detrended, autocorrelation-corrected, FDR-controlled scan; correlation still isn\'t causation, and unmeasured factors (diet, alcohol, stress, illness) can drive both signals at once.'

export function ConnectionsFound({ series, exclusions, llmAvailable }: Props) {
  const result: DiscoverResult = useMemo(
    () => discoverConnections(series, exclusions),
    [series, exclusions],
  )

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Sparkles size={18} />}
        title="Connections found"
        accent="var(--teal)"
        right={
          <span className="conn-found-meta">
            Scanned {result.totalTests} pairs × lags (0–{LMAX}d) · gate q≤{GATE_Q.toFixed(2)} ∧ |rS|≥{GATE_R.toFixed(2)} ∧ n_eff≥{MIN_EFFECTIVE_N} · {result.survivors} surfaced
          </span>
        }
      />

      <div className="conn-honesty">
        <AlertTriangle size={14} />
        <span>{HONESTY_NOTE}</span>
      </div>

      {result.connections.length === 0 ? (
        <div className="conn-found-empty">
          <p>
            <strong>Nothing has cleared the evidence bar yet.</strong> The engine needs enough overlapping
            days where both signals were recorded, AND a relationship strong enough to survive multiple-
            comparison control (Benjamini–Hochberg q ≤ {GATE_Q.toFixed(2)}). Sparse or short-window data
            falls below the gate by design — that&apos;s the engine refusing to cry wolf, not a bug.
          </p>
          <p className="conn-found-empty-tip">
            Keep logging — overnight Oxylink, Whoop, BP, glucose. The wider the daily coverage, the more
            associations the engine can honestly score.
          </p>
        </div>
      ) : (
        <ul className="conn-found-list">
          {result.connections.map((c) => (
            <ConnectionCard
              key={`${c.x}__${c.y}__${c.lag}`}
              connection={c}
              series={series}
              llmAvailable={llmAvailable}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

// ─── One discovered connection ────────────────────────────────────────────

function ConnectionCard({
  connection,
  series,
  llmAvailable,
}: {
  connection: EngineConnection
  series: DailyMetricRow[]
  llmAvailable: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const X = METRIC_INDEX[connection.x]
  const Y = METRIC_INDEX[connection.y]
  if (!X || !Y) return null
  const lagLabel = lagInWords(connection.lag)

  return (
    <li className="conn-found-card">
      <div className="conn-found-head">
        <div className="conn-found-sentence">
          {connection.sentence}
          {connection.nonlinear && (
            <span className="conn-found-tag" title="Rank-based link is stronger than the linear one — suggests a non-linear / threshold relationship.">
              non-linear
            </span>
          )}
        </div>
        <div className="conn-found-stats">
          <span className="conn-found-stat" title="Spearman rho (rank-based correlation, robust to outliers).">
            rS = {connection.rSpearman >= 0 ? '+' : '−'}{Math.abs(connection.rSpearman).toFixed(2)}
          </span>
          <span className="conn-found-stat" title="Paired days at this lag, after exclusions.">
            n = {connection.n}
          </span>
          <span className="conn-found-stat" title="Benjamini–Hochberg q-value across all tested pairs × lags. Lower = stronger evidence the pattern isn't noise from running many tests.">
            q = {connection.q.toFixed(3)}
          </span>
          <span className="conn-found-stat" title="95% CI on Spearman r, Fisher-z, computed on autocorrelation-corrected n_eff.">
            CI [{connection.ci.low.toFixed(2)}, {connection.ci.high.toFixed(2)}]
          </span>
          <span className="conn-found-stat conn-found-lag">
            lag: {lagLabel}
          </span>
        </div>
      </div>

      <div className="conn-found-chart">
        <DualAxisChart
          data={series}
          xAccessor={(d) => new Date(d.date)}
          height={180}
          a={{ accessor: X.acc, color: X.color, label: X.label, unit: X.unit, fmt: (v) => X.fmt(v) }}
          b={{ accessor: Y.acc, color: Y.color, label: Y.label, unit: Y.unit, fmt: (v) => Y.fmt(v) }}
        />
      </div>

      <button
        type="button"
        className="conn-found-expand-btn"
        onClick={() => setExpanded((s) => !s)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        Could this be something else?
      </button>

      {expanded && (
        <ConfounderBlock
          xId={connection.x}
          yId={connection.y}
          lag={connection.lag}
          llmAvailable={llmAvailable}
        />
      )}
    </li>
  )
}

// ─── Confounder expand: curated + optional LLM ────────────────────────────

function ConfounderBlock({
  xId,
  yId,
  lag,
  llmAvailable,
}: {
  xId: string
  yId: string
  lag: number
  llmAvailable: boolean
}) {
  const items = useMemo(() => confoundersFor(yId, xId), [xId, yId])
  const { measured, unmeasured } = splitConfounders(items)

  return (
    <div className="conn-found-confounders">
      <p className="conn-found-conf-intro">
        Surfacing alternative explanations — not adjusting them away. Correlation isn&apos;t causation, even with
        lags + detrending + multiple-comparison control. An n-of-1 experiment (deliberately vary one input,
        randomized) is the actual way to test it.
      </p>

      {measured.length > 0 && (
        <div className="conn-found-conf-section">
          <h4 className="conn-found-conf-title">Plausible — and trackable</h4>
          <ul className="conn-found-conf-list">
            {measured.map((c, i) => (
              <li key={`m-${i}`} className="conn-found-conf-item">
                {c.label}
                {c.covariate && (
                  <span className="conn-found-conf-hint">
                    {' '}— try the Explorer&apos;s &ldquo;control for {METRIC_INDEX[c.covariate]?.short ?? c.covariate}&rdquo; toggle below
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {unmeasured.length > 0 && (
        <div className="conn-found-conf-section">
          <h4 className="conn-found-conf-title">Plausible — but not currently tracked</h4>
          <ul className="conn-found-conf-list">
            {unmeasured.map((c, i) => (
              <li key={`u-${i}`} className="conn-found-conf-item conn-found-conf-unmeasured">
                {c.label}
                {(c.logHref || c.logHint) && (
                  <span className="conn-found-conf-hint">
                    {' '}— {c.logHref ? <a href={c.logHref}>consider logging</a> : <em>consider tracking</em>}
                    {c.logHint && ` (${c.logHint})`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {llmAvailable && <LlmExpand xId={xId} yId={yId} lag={lag} />}
    </div>
  )
}

function LlmExpand({ xId, yId, lag }: { xId: string; yId: string; lag: number }) {
  const [pending, startTransition] = useTransition()
  const [result, setResult] = useState<LlmConfounderResult | null>(null)

  function onClick() {
    if (result) return
    startTransition(async () => {
      const r = await fetchLlmConfounders(xId, yId, lag)
      setResult(r)
    })
  }

  if (result?.text) {
    return (
      <div className="conn-found-llm">
        <h4 className="conn-found-conf-title">AI-suggested considerations</h4>
        <div className="conn-found-llm-text">{result.text}</div>
        <p className="conn-found-llm-foot">
          AI-suggested possibilities a clinician would weigh — not advice, not diagnosis. The platform&apos;s
          standing honesty disclaimer applies.
        </p>
      </div>
    )
  }
  if (result?.error) {
    return <div className="conn-found-llm-error">{result.error}</div>
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="conn-found-llm-btn"
    >
      {pending ? 'Asking…' : 'What else could explain this? (AI)'}
    </button>
  )
}

// ─── Type re-exports for callers that need them ─────────────────────────────
export type { EngineConnection, ConfounderItem }
