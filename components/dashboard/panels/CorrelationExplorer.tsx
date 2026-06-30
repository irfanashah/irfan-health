'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, Sparkles } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { ScatterChart, type ScatterPoint } from '../charts/ScatterChart'
import { fmtDay } from '../charts/chart-utils'
import {
  pearson,
  spearman,
  effectiveN,
  ciAndP,
  partialCorr,
  pairedNonNull,
  MIN_EFFECTIVE_N,
} from '../charts/stats'
import {
  METRIC_INDEX,
  EXPLORER_METRIC_IDS,
  PRESETS,
  SOURCE_LABELS,
  METRICS,
  type MetricDef,
  type SourceKey,
} from '../connections/metrics'
import {
  detrendRollingMedian,
  applyExclusionsToSeries,
  buildExclusionMask,
  laggedProfile,
  pairKey,
  DERIVED_PAIRS,
  LMAX,
  type DateRange,
  type LagResult,
} from '../connections/engine'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  /** Wide-window series (365d). */
  series: DailyMetricRow[]
  /** Exclusions applied before detrending — same as the engine uses. */
  exclusions: DateRange[]
}

const SOURCE_ORDER: SourceKey[] = ['whoop', 'withings', 'nightscout', 'oxylink']
/** Minimum n for the partial-correlation toggle — semipartial at low n is df-unstable (spec §1.8). */
const MIN_PARTIAL_N = 20

const EXPLORER_DEFS = METRICS.filter((m) => EXPLORER_METRIC_IDS.includes(m.id))

// ─── Selects ───────────────────────────────────────────────────────────────

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
          {SOURCE_ORDER.map((src) => {
            const items = EXPLORER_DEFS.filter((m) => m.source === src)
            if (items.length === 0) return null
            return (
              <optgroup key={src} label={SOURCE_LABELS[src]}>
                {items.map((m) => (
                  <option key={m.id} value={m.id} disabled={m.id === exclude}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
        <ChevronDown size={15} />
      </div>
    </div>
  )
}

// ─── Lag-profile bar chart (compact, custom SVG) ──────────────────────────

function LagProfile({
  profileFwd,
  profileRev,
  selectedLag,
  onSelectLag,
  width = 320,
  height = 110,
}: {
  /** X → Y lag profile (lags 0..LMAX). */
  profileFwd: LagResult[]
  /** Y → X lag profile (lags 0..LMAX). */
  profileRev: LagResult[]
  /** Selected signed lag: -LMAX..+LMAX. Positive = X precedes Y. */
  selectedLag: number
  onSelectLag: (lag: number) => void
  width?: number
  height?: number
}) {
  // Combined bars: lags -LMAX..-1 from rev (Y→X reversed onto negative axis),
  // lag 0 once (same-day, take fwd), lags +1..+LMAX from fwd.
  type Bar = { lag: number; rS: number; n: number; nEff: number }
  const bars: Bar[] = []
  for (let L = LMAX; L >= 1; L--) {
    const r = profileRev[L]
    bars.push({ lag: -L, rS: r.rSpearman, n: r.n, nEff: r.nEff })
  }
  bars.push({ lag: 0, rS: profileFwd[0].rSpearman, n: profileFwd[0].n, nEff: profileFwd[0].nEff })
  for (let L = 1; L <= LMAX; L++) {
    const r = profileFwd[L]
    bars.push({ lag: L, rS: r.rSpearman, n: r.n, nEff: r.nEff })
  }

  const pad = { l: 28, r: 8, t: 12, b: 28 }
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const bw = innerW / bars.length
  // Y axis from -1 to +1.
  const yOf = (v: number) => pad.t + ((1 - v) / 2) * innerH
  const zeroY = yOf(0)

  return (
    <svg width={width} height={height} role="img" aria-label="Lag profile">
      {/* Y reference lines */}
      <line x1={pad.l} x2={pad.l + innerW} y1={zeroY} y2={zeroY} stroke="var(--card-border)" />
      <line x1={pad.l} x2={pad.l + innerW} y1={yOf(0.5)} y2={yOf(0.5)} stroke="var(--card-border)" strokeDasharray="2 3" opacity={0.5} />
      <line x1={pad.l} x2={pad.l + innerW} y1={yOf(-0.5)} y2={yOf(-0.5)} stroke="var(--card-border)" strokeDasharray="2 3" opacity={0.5} />
      {/* Y labels */}
      <text x={pad.l - 4} y={yOf(1) + 4} fontSize="9" fill="var(--text-dim)" textAnchor="end">+1</text>
      <text x={pad.l - 4} y={zeroY + 3} fontSize="9" fill="var(--text-dim)" textAnchor="end">0</text>
      <text x={pad.l - 4} y={yOf(-1)} fontSize="9" fill="var(--text-dim)" textAnchor="end">−1</text>
      {/* Bars */}
      {bars.map((b, i) => {
        const x = pad.l + i * bw + bw * 0.15
        const w = bw * 0.7
        const y = b.rS >= 0 ? yOf(b.rS) : zeroY
        const h = Math.abs(yOf(b.rS) - zeroY)
        const selected = b.lag === selectedLag
        const fill = selected
          ? 'var(--teal)'
          : b.rS >= 0
            ? 'color-mix(in srgb, var(--teal) 50%, transparent)'
            : 'color-mix(in srgb, var(--red) 50%, transparent)'
        return (
          <g key={i} onClick={() => onSelectLag(b.lag)} style={{ cursor: 'pointer' }}>
            <rect x={x} y={y} width={w} height={h} fill={fill} stroke={selected ? 'var(--teal)' : 'none'} strokeWidth={selected ? 1.5 : 0} />
            <text
              x={x + w / 2}
              y={height - pad.b + 12}
              fontSize="9"
              fill={selected ? 'var(--text)' : 'var(--text-dim)'}
              textAnchor="middle"
            >
              {b.lag === 0 ? '0' : b.lag > 0 ? `+${b.lag}` : `${b.lag}`}
            </text>
          </g>
        )
      })}
      {/* x-axis label */}
      <text x={pad.l + innerW / 2} y={height - 2} fontSize="9" fill="var(--text-dim)" textAnchor="middle">
        Lag (days) — negative = Y precedes X, positive = X precedes Y
      </text>
    </svg>
  )
}

// ─── Main panel ────────────────────────────────────────────────────────────

export function CorrelationExplorerPanel({ series, exclusions }: Props) {
  const [aId, setAId] = useState('sleepHours')
  const [bId, setBId] = useState('fasting')
  const [useDetrended, setUseDetrended] = useState(true)
  const [selectedLag, setSelectedLag] = useState(0)
  const [controlStrain, setControlStrain] = useState(false)
  const [controlDow, setControlDow] = useState(false)

  const A: MetricDef = METRIC_INDEX[aId]
  const B: MetricDef = METRIC_INDEX[bId]
  const isDerivedPair = DERIVED_PAIRS.has(pairKey(aId, bId))

  // Build per-metric series + apply exclusions + optionally detrend.
  // (Detrending the same way the engine does — single source of truth.)
  const { xSeries, ySeries } = useMemo(() => {
    const dates = series.map((d) => d.date)
    const mask = buildExclusionMask(dates, exclusions, [aId, bId])
    const xRaw = series.map(A.acc)
    const yRaw = series.map(B.acc)
    const xMasked = applyExclusionsToSeries(xRaw, mask[aId])
    const yMasked = applyExclusionsToSeries(yRaw, mask[bId])
    if (!useDetrended) return { xSeries: xMasked, ySeries: yMasked }
    return {
      xSeries: detrendRollingMedian(xMasked),
      ySeries: detrendRollingMedian(yMasked),
    }
  }, [series, exclusions, aId, bId, A, B, useDetrended])

  // Lag profiles — always Spearman (the engine's primary metric).
  const profileFwd = useMemo(() => laggedProfile(xSeries, ySeries, LMAX), [xSeries, ySeries])
  const profileRev = useMemo(() => laggedProfile(ySeries, xSeries, LMAX), [xSeries, ySeries])

  // Selected-lag computations: scatter + r + CI + n.
  const selected = useMemo(() => {
    // Selected lag may be negative (Y→X) — pick the right profile entry.
    if (selectedLag === 0) return { ...profileFwd[0], dirLabel: 'same day' }
    if (selectedLag > 0) return { ...profileFwd[selectedLag], dirLabel: `${A.short} precedes ${B.short} by ${selectedLag}d` }
    const L = -selectedLag
    return { ...profileRev[L], dirLabel: `${B.short} precedes ${A.short} by ${L}d` }
  }, [profileFwd, profileRev, selectedLag, A, B])

  // Pair (X, Y) at the chosen lag for the scatter — re-do the pairing with the
  // axis the engine actually used at that lag.
  const scatter: ScatterPoint[] = useMemo(() => {
    const pts: ScatterPoint[] = []
    const L = selectedLag
    const N = xSeries.length
    if (L >= 0) {
      for (let t = 0; t < N - L; t++) {
        const x = xSeries[t]
        const y = ySeries[t + L]
        if (x === null || y === null) continue
        pts.push({ x, y, label: fmtDay(new Date(series[t].date)) })
      }
    } else {
      const Lpos = -L
      for (let t = 0; t < N - Lpos; t++) {
        const x = ySeries[t]
        const y = xSeries[t + Lpos]
        if (x === null || y === null) continue
        pts.push({ x, y, label: fmtDay(new Date(series[t].date)) })
      }
    }
    return pts
  }, [xSeries, ySeries, selectedLag, series])

  // Partial-correlation toggle (Explorer-only, n-gated). Re-pairs at the
  // selected lag, residualises x & y against the covariate(s) chosen, then
  // re-correlates. The unadjusted r above is also Spearman so the two are
  // directly comparable.
  const partial = useMemo(() => {
    if (!controlStrain && !controlDow) return null
    if (scatter.length < MIN_PARTIAL_N) {
      return { adjusted: false, reason: `n=${scatter.length} < ${MIN_PARTIAL_N}` }
    }
    // Build covariate vectors aligned with the scatter pairs.
    const L = selectedLag
    const N = xSeries.length
    const covs: number[][] = []
    if (controlStrain) {
      const strain = series.map((d) => d.strain ?? NaN)
      const cv: number[] = []
      for (let t = 0; t < (L >= 0 ? N - L : N + L); t++) {
        const idx = L >= 0 ? t : t // covariate sampled at the same t-anchor as the predictor.
        const s = strain[idx]
        if (Number.isFinite(s)) cv.push(s)
        else cv.push(0)
      }
      covs.push(cv)
    }
    if (controlDow) {
      const cv: number[] = []
      for (let t = 0; t < (L >= 0 ? N - L : N + L); t++) {
        cv.push(new Date(series[t].date).getUTCDay())
      }
      covs.push(cv)
    }
    // Re-pair sans nulls (covariates already filled with 0 where missing).
    // Realign with the surviving x,y indices.
    const xs: number[] = []
    const ys: number[] = []
    const cs: number[][] = covs.map(() => [])
    if (L >= 0) {
      for (let t = 0; t < N - L; t++) {
        const x = xSeries[t]
        const y = ySeries[t + L]
        if (x === null || y === null) continue
        xs.push(x); ys.push(y)
        for (let k = 0; k < covs.length; k++) cs[k].push(covs[k][t])
      }
    } else {
      const Lpos = -L
      for (let t = 0; t < N - Lpos; t++) {
        const x = ySeries[t]
        const y = xSeries[t + Lpos]
        if (x === null || y === null) continue
        xs.push(x); ys.push(y)
        for (let k = 0; k < covs.length; k++) cs[k].push(covs[k][t])
      }
    }
    if (xs.length < MIN_PARTIAL_N) return { adjusted: false, reason: `n=${xs.length} < ${MIN_PARTIAL_N}` }
    const { r } = partialCorr(xs, ys, cs, 'spearman')
    return { adjusted: true, rPartial: r, n: xs.length }
  }, [controlStrain, controlDow, selectedLag, xSeries, ySeries, series, scatter.length])

  // Significance bundle for the selected lag (uses n_eff).
  const sig = useMemo(() => {
    const p = pairedNonNull(scatter.map((s) => s.x), scatter.map((s) => s.y))
    if (p.n < 3) return null
    const rS = spearman(p.xs, p.ys)
    const rP = pearson(p.xs, p.ys)
    const nEff = effectiveN(p.xs, p.ys)
    return { rS, rP, ...ciAndP(rS, nEff), n: p.n }
  }, [scatter])

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Sparkles size={18} />}
        title="Lagged correlation explorer"
        accent="var(--teal)"
        right={<span className="muted-note">association only · pick two metrics + a lag</span>}
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
              onClick={() => { setAId(p.a); setBId(p.b); setSelectedLag(0) }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="corr-toggles">
        <label className="corr-toggle">
          <input
            type="checkbox"
            checked={useDetrended}
            onChange={(e) => setUseDetrended(e.target.checked)}
          />
          <span>Detrended (rolling-median residual)</span>
          {!useDetrended && (
            <span className="corr-warn"> — raw levels; may reflect a shared trend</span>
          )}
        </label>
        <label className="corr-toggle">
          <input
            type="checkbox"
            checked={controlStrain}
            onChange={(e) => setControlStrain(e.target.checked)}
          />
          <span>Control for strain</span>
        </label>
        <label className="corr-toggle">
          <input
            type="checkbox"
            checked={controlDow}
            onChange={(e) => setControlDow(e.target.checked)}
          />
          <span>Control for day-of-week</span>
        </label>
      </div>

      {isDerivedPair && (
        <p className="corr-derived-note">
          Note: this pair is expected by design (one is partly derived from the other) — the discovery
          scan suppresses it. Useful for sanity-checking, not as a finding.
        </p>
      )}

      <div className="corr-grid">
        <div className="corr-overlay">
          <div className="chart-caption sm">
            <span>Lag profile · Spearman rS across lags</span>
            <span className="muted-note">{selected.dirLabel}</span>
          </div>
          <LagProfile
            profileFwd={profileFwd}
            profileRev={profileRev}
            selectedLag={selectedLag}
            onSelectLag={setSelectedLag}
            width={460}
            height={140}
          />
        </div>
        <div className="corr-scatter">
          <div className="chart-caption sm">
            <span>{A.short} vs {B.short} at lag {selectedLag >= 0 ? `+${selectedLag}` : selectedLag}</span>
            {sig && (
              <span className="r-badge" style={{ color: 'var(--text)' }}>
                rS = {sig.rS >= 0 ? '+' : '−'}{Math.abs(sig.rS).toFixed(2)}
                <span className="r-strength">· rP {sig.rP >= 0 ? '+' : '−'}{Math.abs(sig.rP).toFixed(2)}</span>
                <span className="r-strength">· n {sig.n} (n_eff {sig.nEff.toFixed(0)})</span>
                <span className="r-strength">· CI [{sig.ciLow.toFixed(2)}, {sig.ciHigh.toFixed(2)}]</span>
              </span>
            )}
          </div>
          <ScatterChart
            points={scatter}
            height={220}
            color={B.color}
            xLabel={A.short}
            yLabel={B.short}
            xUnit={A.unit}
            yUnit={B.unit}
            fmtX={(v) => A.fmt(v)}
            fmtY={(v) => B.fmt(v)}
            showFit={(sig?.n ?? 0) >= MIN_EFFECTIVE_N}
          />
        </div>
      </div>

      {partial && (
        <div className="corr-partial">
          {partial.adjusted ? (
            <>
              <strong>Adjusted rS = {partial.rPartial!.toFixed(2)}</strong>{' '}
              (controlling for {[controlStrain && 'strain', controlDow && 'day-of-week'].filter(Boolean).join(' + ')}, n={partial.n}).
              Compare against the unadjusted rS above — if they diverge a lot, the covariate is doing real work.
            </>
          ) : (
            <span className="corr-warn">Need ≥ {MIN_PARTIAL_N} paired days for partial correlation — currently {partial.reason}.</span>
          )}
        </div>
      )}

      <div className="corr-foot">
        Spearman is the primary correlation (robust to outliers + monotonic-nonlinear); Pearson shown for the linear comparison.
        Significance + CI use an autocorrelation-corrected effective n.
        <strong> Correlation is not causation</strong> — the Explorer surfaces patterns, never claims them as effects.
      </div>
    </Card>
  )
}
