'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, TestTube, LineChart } from 'lucide-react'
import { Card } from './ui/Card'
import { PanelHeader } from './ui/PanelHeader'
import { TrendChart } from './charts/TrendChart'
import { getMarker, markerCategory, KEY_MARKER_SLUGS, KEY_BLOOD_SLUGS, KEY_ECHO_SLUGS } from '@/app/labs/_lib/markers'
import type { LabPanelRow, LabValueRow, MarkerTrend, MarkerTrendPoint } from '@/app/labs/actions'
import {
  evaluateLabMarker,
  LAB_TARGETS,
  LAB_TARGET_PROVISIONAL_NOTE,
  type LabGoalState,
  type LabMarkerStatus,
  type LabTrendDir,
} from '@/app/labs/_lib/targets'

interface Props {
  panels: LabPanelRow[]
  trends: MarkerTrend[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'Asia/Dubai' })
}

function isOutOfRange(v: LabValueRow): boolean {
  if (v.flag && v.flag !== 'N') return true
  if (v.numeric_value === null) return false
  if (v.ref_low !== null && v.numeric_value < v.ref_low) return true
  if (v.ref_high !== null && v.numeric_value > v.ref_high) return true
  return false
}

function flagColor(flag: LabValueRow['flag']): string {
  if (flag === 'L' || flag === 'H') return 'var(--amber)'
  if (flag === 'LL' || flag === 'HH') return 'var(--red)'
  return 'var(--text-dim)'
}

const GOAL_COLOR: Record<LabGoalState, string> = {
  'at-goal': 'var(--teal)',
  'near': 'var(--amber)',
  'off-goal': 'var(--red)',
}
const GOAL_LABEL: Record<LabGoalState, string> = {
  'at-goal': 'at goal',
  'near': 'near goal',
  'off-goal': 'off goal',
}

function trendArrowMeta(d: LabTrendDir): { arrow: string; color: string; label: string } {
  if (d === 'improving') return { arrow: '↘', color: 'var(--teal)', label: 'improving toward goal' }
  if (d === 'worsening') return { arrow: '↗', color: 'var(--red)', label: 'moving away from goal' }
  if (d === 'flat') return { arrow: '→', color: 'var(--text-dim)', label: 'flat vs prior' }
  return { arrow: '', color: 'var(--text-dim)', label: 'single draw — trend needs a second' }
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

/** Pad the y-domain around the data + ref band + goal line/band. */
function deriveYDomain(t: MarkerTrend, status: LabMarkerStatus | null): [number, number] | undefined {
  const vals: number[] = []
  for (const p of t.points) {
    vals.push(p.value)
    if (p.ref_low !== null) vals.push(p.ref_low)
    if (p.ref_high !== null) vals.push(p.ref_high)
  }
  if (status?.goalLine !== null && status?.goalLine !== undefined) vals.push(status.goalLine)
  // hba1c-style range: pull the watchHigh into the domain too.
  if (status?.target?.watchHigh !== undefined) vals.push(status.target.watchHigh)
  if (vals.length === 0) return undefined
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const pad = (max - min) * 0.2 || Math.max(1, Math.abs(max) * 0.1)
  return [min - pad, max + pad]
}

/**
 * Pick the latest non-null ref range for the band — prefer 'reported'
 * (a fresh lab range overrides a remembered standard) and surface the
 * provenance so the trend can be honest about where the band came from.
 */
function latestRefBand(t: MarkerTrend): {
  low: number | null
  high: number | null
  source: 'reported' | 'standard' | null
} {
  for (let i = t.points.length - 1; i >= 0; i--) {
    const p = t.points[i]
    if (p.ref_source === 'reported' && (p.ref_low !== null || p.ref_high !== null)) {
      return { low: p.ref_low, high: p.ref_high, source: 'reported' }
    }
  }
  for (let i = t.points.length - 1; i >= 0; i--) {
    const p = t.points[i]
    if (p.ref_low !== null || p.ref_high !== null) {
      return { low: p.ref_low, high: p.ref_high, source: p.ref_source }
    }
  }
  return { low: null, high: null, source: null }
}

// ─── Imported-panels list (in-card, dashboard-styled) ────────────────────

function PanelsCard({ panels }: { panels: LabPanelRow[] }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  return (
    <Card className="col-12">
      <PanelHeader
        icon={<TestTube size={18} />}
        title={`Imported panels (${panels.length})`}
        accent="var(--teal)"
      />
      {panels.length === 0 ? (
        <div className="empty-note">
          No lab panels imported yet. Upload a PDF via the <a href="/labs">labs import tool</a> (under Diagnostics) to start.
        </div>
      ) : (
        <ul className="labs-tab-panels">
          {panels.map((p) => {
            const isOpen = expanded[p.id] ?? false
            const oorCount = p.values.filter(isOutOfRange).length
            return (
              <li key={p.id} className="labs-tab-panel">
                <button
                  type="button"
                  className="labs-tab-panel-head"
                  onClick={() => setExpanded((s) => ({ ...s, [p.id]: !isOpen }))}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="labs-tab-panel-date">{fmtDate(p.drawn_at)}</span>
                  {p.lab_name && <span className="labs-tab-panel-lab">{p.lab_name}</span>}
                  <span className="labs-tab-panel-count">{p.values.length} markers</span>
                  {oorCount > 0 && (
                    <span className="labs-tab-panel-oor">{oorCount} out of range</span>
                  )}
                </button>
                {isOpen && (
                  <div className="labs-tab-panel-body">
                    {p.ordering_physician && (
                      <div className="labs-tab-panel-meta">Ordered by {p.ordering_physician}</div>
                    )}
                    {p.notes && <div className="labs-tab-panel-meta">{p.notes}</div>}
                    <div className="labs-tab-values-wrap">
                    <table className="labs-tab-values">
                      <thead>
                        <tr>
                          <th>Marker</th>
                          <th>Result</th>
                          <th>Reference</th>
                          <th>Flag</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.values.map((v, i) => {
                          const def = v.marker_slug !== 'unmapped' ? getMarker(v.marker_slug) : null
                          const display = def?.display ?? v.raw_marker_name
                          const oor = isOutOfRange(v)
                          const result =
                            v.numeric_value !== null
                              ? `${v.numeric_value}${v.unit ? ' ' + v.unit : ''}`
                              : v.text_value ?? '—'
                          const ref =
                            v.ref_low !== null && v.ref_high !== null
                              ? `${v.ref_low}–${v.ref_high}${v.ref_unit ? ' ' + v.ref_unit : ''}`
                              : v.ref_low !== null
                                ? `≥ ${v.ref_low}${v.ref_unit ? ' ' + v.ref_unit : ''}`
                                : v.ref_high !== null
                                  ? `≤ ${v.ref_high}${v.ref_unit ? ' ' + v.ref_unit : ''}`
                                  : '—'
                          return (
                            <tr key={i} className={oor ? 'oor' : ''}>
                              <td>
                                <div className="labs-tab-marker-name">{display}</div>
                                {def && def.display !== v.raw_marker_name && (
                                  <div className="labs-tab-marker-raw">{v.raw_marker_name}</div>
                                )}
                              </td>
                              <td className="labs-tab-marker-result">{result}</td>
                              <td className="labs-tab-marker-ref">
                                {ref}
                                {v.ref_source === 'standard' && (
                                  <span className="labs-tab-prov" title="Confirmed standard range, not from this lab's print">
                                    standard
                                  </span>
                                )}
                              </td>
                              <td>
                                {v.flag && (
                                  <span
                                    className="labs-tab-flag"
                                    style={{
                                      color: flagColor(v.flag),
                                      borderColor: flagColor(v.flag),
                                    }}
                                  >
                                    {v.flag}
                                  </span>
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// ─── A single trend card (one canonical marker) ─────────────────────────

function TrendCard({ trend, wide = false }: { trend: MarkerTrend; wide?: boolean }) {
  const def = getMarker(trend.marker_slug)
  const status = LAB_TARGETS[trend.marker_slug] ? evaluateLabMarker(trend) : null
  const unit = status?.unit || trend.canonical_unit || trend.points[trend.points.length - 1]?.unit || ''
  const yDomain = deriveYDomain(trend, status)
  const ref = latestRefBand(trend)
  const series = buildSeries(trend)
  const latest = trend.points[trend.points.length - 1]
  const isKey = def?.keyMarker ?? false
  const informational = status && !status.modifiable
  const trendMeta = status ? trendArrowMeta(status.trend) : null

  // Goal-line / goal-band setup.
  // - For 'lower' / 'higher' targets: a dashed reference line at goalLine
  //   (via TrendChart's `divider` prop — distinct from the lab ref band
  //   so it doesn't read as "normal range").
  // - For 'range' (hba1c): a shaded "at-goal" band [-∞, targetHigh] +
  //   a "watch" band (targetHigh, watchHigh].
  const target = status?.target
  let goalDivider: { value: number; labelAbove?: string; labelBelow?: string } | undefined
  const extraBands: { from: number; to: number; color: string; opacity: number }[] = []
  if (target?.goalDirection === 'lower' && status?.goalLine !== null && yDomain) {
    goalDivider = { value: status!.goalLine!, labelAbove: 'goal' }
  } else if (target?.goalDirection === 'higher' && status?.goalLine !== null && yDomain) {
    goalDivider = { value: status!.goalLine!, labelBelow: 'goal' }
  } else if (target?.goalDirection === 'range' && target.targetHigh !== undefined && yDomain) {
    extraBands.push({ from: yDomain[0], to: target.targetHigh, color: 'var(--teal)', opacity: 0.08 })
    if (target.watchHigh !== undefined) {
      extraBands.push({ from: target.targetHigh, to: target.watchHigh, color: 'var(--amber)', opacity: 0.08 })
    }
  }

  return (
    <Card className={wide ? 'col-12' : 'col-6'}>
      <PanelHeader
        icon={<LineChart size={16} />}
        title={`${def?.display ?? trend.marker_slug}${isKey ? ' ★' : ''}`}
        accent="var(--purple)"
        right={
          <div className="labs-tab-trend-meta">
            <span className="labs-tab-trend-latest">
              {latest.value}
              <span className="labs-tab-trend-unit">{unit}</span>
            </span>
            {latest.flag && (
              <span
                className="labs-tab-flag"
                style={{
                  color: flagColor(latest.flag),
                  borderColor: flagColor(latest.flag),
                }}
              >
                {latest.flag}
              </span>
            )}
            {status?.goalState && (
              <span
                className="labs-tab-goal-pill"
                style={{ color: GOAL_COLOR[status.goalState], borderColor: GOAL_COLOR[status.goalState] }}
                title={target?.label}
              >
                {GOAL_LABEL[status.goalState]}
              </span>
            )}
            {status && !status.goalState && status.unmatchedReason && (
              <span className="labs-tab-goal-pill labs-tab-goal-unmatched" title={status.unmatchedReason}>
                unit not matched
              </span>
            )}
            {trendMeta && trendMeta.arrow && (
              <span
                className="labs-tab-goal-arrow"
                style={{ color: trendMeta.color }}
                title={trendMeta.label}
              >
                {trendMeta.arrow}
              </span>
            )}
            {ref.source === 'standard' && (
              <span className="labs-tab-prov" title="Normal band from a confirmed standard, not this lab's printed range">
                standard band
              </span>
            )}
            <span className="labs-tab-trend-count">
              {trend.points.length} draw{trend.points.length === 1 ? '' : 's'}
            </span>
          </div>
        }
      />
      <TrendChart
        data={series}
        xAccessor={(d) => d.date}
        height={160}
        yDomain={yDomain}
        yTicks={4}
        maxXTicks={5}
        formatY={(v) => String(Math.round(v * 100) / 100)}
        bands={[
          ...(ref.low !== null && ref.high !== null
            ? [{ from: ref.low, to: ref.high, color: 'var(--teal)', opacity: 0.1 }]
            : []),
          ...extraBands,
        ]}
        divider={goalDivider}
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
          if (d.flag) rows.push({ color: 'var(--amber)', label: 'Flag', value: d.flag })
          return rows
        }}
      />
      {target && (
        <div className="labs-tab-goal-foot">
          <span className="labs-tab-goal-label">Target: {target.label}</span>
          {informational && (
            <span className="labs-tab-goal-info" title="Non-modifiable risk marker — track for context, not a treatment goal.">
              informational — not therapy-modifiable
            </span>
          )}
          {target.reductionGoalPct && status?.reductionPct !== null && status?.baseline !== null && (
            <span className="labs-tab-goal-reduction">
              {(status.reductionPct ?? 0) >= 0
                ? `↓ ${(status.reductionPct ?? 0).toFixed(0)}%`
                : `↑ ${Math.abs(status.reductionPct ?? 0).toFixed(0)}%`}{' '}
              from baseline {status.baseline}
              {status.meetsReductionGoal ? ' · ≥50% goal met' : ' · ≥50% goal not yet met'}
            </span>
          )}
        </div>
      )}
    </Card>
  )
}

// ─── Tab shell ───────────────────────────────────────────────────────────

export function LabsTab({ panels, trends }: Props) {
  const trendsBySlug = useMemo(() => new Map(trends.map((t) => [t.marker_slug, t])), [trends])
  // Blood key-marker trends only — echo keys are grouped into their own
  // Echocardiogram section below (category-based split, not keyMarker alone).
  const keyTrends = KEY_BLOOD_SLUGS
    .map((s) => trendsBySlug.get(s))
    .filter((t): t is MarkerTrend => t !== undefined)
  // Echo key markers, EF first. Single-draw echo markers (e.g. April-only
  // E/e′) still render — TrendChart draws a labelled dot (sparse-safe).
  const echoTrends = KEY_ECHO_SLUGS
    .map((s) => trendsBySlug.get(s))
    .filter((t): t is MarkerTrend => t !== undefined)
  // Non-key markers with ≥2 draws are pickable via the dropdown — sparse
  // single-draw markers stay only in the panels list (a single dot trend
  // isn't useful and would clutter). Covers non-key echo markers too.
  const pickable = trends.filter(
    (t) => !KEY_MARKER_SLUGS.includes(t.marker_slug) && t.points.length >= 2
  )
  // Echo findings — the qualitative narrative committed into each echo
  // panel's notes (LVH, diastolic-dysfunction grade, RWMA, valve grades).
  // An echo panel = one whose committed values include ≥1 echo-category marker.
  const echoFindings = panels
    .filter((p) => p.notes && p.values.some((v) => markerCategory(v.marker_slug) === 'echo'))
    .map((p) => ({ id: p.id, drawnAt: p.drawn_at, lab: p.lab_name, notes: p.notes! }))
  const [pickedSlug, setPickedSlug] = useState<string>('')
  const picked = pickedSlug ? trendsBySlug.get(pickedSlug) ?? null : null

  // "Cardiac labs vs target" summary — one glance answers "where do I stand."
  // Counted across LAB_TARGETS slugs (cardiac-first set). Markers with no
  // draws or with an unmatched unit count as `notDrawn` / not-evaluable so
  // the totals are honest.
  const targetSummary = useMemo(() => {
    const summary = { atGoal: 0, near: 0, off: 0, notDrawn: 0 }
    for (const slug of Object.keys(LAB_TARGETS)) {
      const t = trendsBySlug.get(slug)
      if (!t) { summary.notDrawn++; continue }
      const status = evaluateLabMarker(t)
      if (status.goalState === 'at-goal') summary.atGoal++
      else if (status.goalState === 'near') summary.near++
      else if (status.goalState === 'off-goal') summary.off++
      else summary.notDrawn++
    }
    return summary
  }, [trendsBySlug])

  return (
    <>
      <div className="section-divider tabhead">
        <div className="section-head">
          <span className="section-kicker" style={{ color: 'var(--teal)' }}>
            Labs
          </span>
          <h2 className="section-title">Lab markers &amp; trends</h2>
          <p className="section-sub">
            Cardiac key markers (★) trended across every draw with clinical-target tracking; imported
            panels listed chronologically with out-of-range flagging. Import new reports via the{' '}
            <a href="/labs">labs upload tool</a> (under Diagnostics) — they appear here once committed.
          </p>
        </div>
      </div>
      <main className="grid">
        <Card className="col-12">
          <PanelHeader
            icon={<LineChart size={18} />}
            title="Cardiac labs vs target"
            accent="var(--teal)"
          />
          <div className="labs-tab-summary">
            <div className="labs-tab-summary-stat">
              <span className="labs-tab-summary-dot" style={{ background: GOAL_COLOR['at-goal'] }} />
              <span className="labs-tab-summary-n">{targetSummary.atGoal}</span> at goal
            </div>
            <div className="labs-tab-summary-stat">
              <span className="labs-tab-summary-dot" style={{ background: GOAL_COLOR['near'] }} />
              <span className="labs-tab-summary-n">{targetSummary.near}</span> near
            </div>
            <div className="labs-tab-summary-stat">
              <span className="labs-tab-summary-dot" style={{ background: GOAL_COLOR['off-goal'] }} />
              <span className="labs-tab-summary-n">{targetSummary.off}</span> off
            </div>
            <div className="labs-tab-summary-stat labs-tab-summary-dim">
              <span className="labs-tab-summary-dot" style={{ background: 'var(--text-dim)' }} />
              <span className="labs-tab-summary-n">{targetSummary.notDrawn}</span> not drawn / not evaluable
            </div>
          </div>
          <p className="labs-tab-summary-foot">{LAB_TARGET_PROVISIONAL_NOTE}</p>
        </Card>

        <PanelsCard panels={panels} />

        {keyTrends.length === 0 ? (
          <Card className="col-12">
            <PanelHeader
              icon={<LineChart size={18} />}
              title="Key-marker trends"
              accent="var(--purple)"
            />
            <div className="empty-note">
              No key-marker readings yet. Once a panel includes LDL / HDL / triglycerides /
              HbA1c / hs-CRP / Lp(a) / fasting glucose / ApoB / non-HDL, those trends populate here.
            </div>
          </Card>
        ) : (
          keyTrends.map((t) => <TrendCard key={t.marker_slug} trend={t} />)
        )}

        {echoTrends.length > 0 && (
          <>
            <div className="section-divider tabhead col-12">
              <div className="section-head">
                <span className="section-kicker" style={{ color: 'var(--purple)' }}>
                  Echocardiogram
                </span>
                <h2 className="section-title">Cardiac imaging &amp; trends</h2>
                <p className="section-sub">
                  TTE measurements trended across studies. Ejection fraction is the headline;
                  chamber &amp; wall dimensions are shown in cm (mm reports normalised). Normal
                  bands are provisional — confirm with Dr. Jose.
                </p>
              </div>
            </div>
            {echoTrends.map((t) => (
              <TrendCard key={t.marker_slug} trend={t} wide={t.marker_slug === 'ef'} />
            ))}
            {echoFindings.length > 0 && (
              <Card className="col-12">
                <PanelHeader
                  icon={<TestTube size={18} />}
                  title="Echo findings (qualitative)"
                  accent="var(--purple)"
                />
                <ul className="labs-tab-echo-findings">
                  {echoFindings.map((f) => (
                    <li key={f.id} className="labs-tab-echo-finding">
                      <span className="labs-tab-echo-finding-date">{fmtDate(f.drawnAt)}</span>
                      {f.lab && <span className="labs-tab-echo-finding-lab">{f.lab}</span>}
                      <span className="labs-tab-echo-finding-text">{f.notes}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </>
        )}

        {pickable.length > 0 && (
          <Card className="col-12">
            <PanelHeader
              icon={<LineChart size={18} />}
              title="Trend any marker"
              accent="var(--teal)"
              right={
                <select
                  className="labs-tab-picker"
                  value={pickedSlug}
                  onChange={(e) => setPickedSlug(e.target.value)}
                >
                  <option value="">— pick a marker with ≥2 draws —</option>
                  {pickable.map((t) => (
                    <option key={t.marker_slug} value={t.marker_slug}>
                      {getMarker(t.marker_slug)?.display ?? t.marker_slug} ({t.points.length})
                    </option>
                  ))}
                </select>
              }
            />
            {picked ? (
              <TrendCard trend={picked} />
            ) : (
              <div className="empty-note">Pick a marker above to render its trend.</div>
            )}
          </Card>
        )}
      </main>
    </>
  )
}
