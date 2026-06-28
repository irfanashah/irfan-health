'use client'

import { useMemo } from 'react'

// Doctor record — print-optimised, browser-print → PDF.
//
// Why all-in-one client component (rather than per-section files): the
// report is page-1 + a few detail pages, each modest in size. The
// chart pieces need 'use client' for the SVG measure hook anyway, so
// the page-server pre-fetches all data and hands it down. Each detail
// block has `class="report-page"` so `page-break-before: always` in
// the print CSS pages them cleanly.

import { Printer } from 'lucide-react'
import { TrendChart } from '@/components/dashboard/charts/TrendChart'
import { Spo2OvernightChart } from '@/components/dashboard/charts/Spo2OvernightChart'
import { CGMChart } from '@/components/dashboard/charts/CGMChart'
import { Donut } from '@/components/dashboard/charts/Donut'
import { Sparkline } from '@/components/dashboard/charts/Sparkline'
import {
  bpCategory,
  BP_DIA_BANDS,
  BP_SYS_BANDS,
  GLUCOSE_HI,
  GLUCOSE_LO,
  STATUS_COLOR,
  st,
} from '@/components/dashboard/thresholds'
import { getMarker, KEY_MARKER_SLUGS } from '@/app/labs/_lib/markers'
import { LAB_TARGET_PROVISIONAL_NOTE, type LabGoalState, type LabTrendDir } from '@/app/labs/_lib/targets'
import type {
  DailyMetricRow,
  CgmPoint,
  LatestKpis,
  Spo2NightPayload,
  FingerstickPoint,
} from '@/app/lib/dashboard/daily-metrics'
import type { LabPanelRow, LabValueRow, MarkerTrend } from '@/app/labs/actions'
import type { MedicationRow } from '@/app/medications/actions'
import type { BaselinesPayload } from '@/app/lib/dashboard/baselines'
import { DRIFT_METRICS } from '@/components/dashboard/drift-config'
import { evaluateMetric } from '@/components/dashboard/drift/evaluate'
import { buildDriftPanelData, type DriftPanelData } from '@/components/dashboard/drift/present'
import {
  CARDIAC_KEY_MARKERS,
  buildCardiacLabSummary,
  directionLabel,
  fmtDate,
  fmtDateShort,
  fmtInt,
  fmtNum,
} from './_lib/format'

interface Props {
  windowDays: number
  generatedAt: string
  series: DailyMetricRow[]
  cgm24h: CgmPoint[]
  latest: LatestKpis
  spo2Night: Spo2NightPayload | null
  fingersticks: FingerstickPoint[]
  labPanels: LabPanelRow[]
  labTrends: MarkerTrend[]
  medications: MedicationRow[]
  baselines: BaselinesPayload
}

// STEMI date — also in thresholds.ts as STEMI_DATE; mirrored here as a
// constant for the report's static header line so the doctor sees a
// consistent narrative.
const STEMI_LABEL = 'STEMI 28 Apr 2026 — 100% LCx/OM1 occlusion → DES'
const LAD_LABEL = 'Elective LAD balloon angioplasty 13 May 2026'
const EF_LABEL = 'EF 55%'

function isOutOfRange(v: LabValueRow): boolean {
  if (v.flag && v.flag !== 'N') return true
  if (v.numeric_value === null) return false
  if (v.ref_low !== null && v.numeric_value < v.ref_low) return true
  if (v.ref_high !== null && v.numeric_value > v.ref_high) return true
  return false
}

function refRangeText(v: { ref_low: number | null; ref_high: number | null; ref_unit: string | null }): string {
  if (v.ref_low !== null && v.ref_high !== null) {
    return `${v.ref_low}–${v.ref_high}${v.ref_unit ? ' ' + v.ref_unit : ''}`
  }
  if (v.ref_low !== null) return `≥ ${v.ref_low}${v.ref_unit ? ' ' + v.ref_unit : ''}`
  if (v.ref_high !== null) return `≤ ${v.ref_high}${v.ref_unit ? ' ' + v.ref_unit : ''}`
  return '—'
}

function provenance(src: 'reported' | 'standard' | null): string {
  if (src === 'reported') return 'lab-printed'
  if (src === 'standard') return 'standard'
  return ''
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

function trendArrow(d: LabTrendDir): { arrow: string; color: string } {
  if (d === 'improving') return { arrow: '↘', color: 'var(--teal)' }
  if (d === 'worsening') return { arrow: '↗', color: 'var(--red)' }
  if (d === 'flat') return { arrow: '→', color: 'var(--text-dim)' }
  return { arrow: '', color: 'var(--text-dim)' }
}

// ─── Trend-series helpers ────────────────────────────────────────────────

function bpSeriesYDomain(): [number, number] {
  return [55, 185]
}

function rhrHrvYDomain(rows: DailyMetricRow[]): [number, number] | undefined {
  const vals: number[] = []
  for (const r of rows) {
    if (r.rhr !== null) vals.push(r.rhr)
    if (r.hrv !== null) vals.push(r.hrv)
  }
  if (vals.length === 0) return undefined
  return [Math.min(...vals) - 5, Math.max(...vals) + 5]
}

// ─── Component ───────────────────────────────────────────────────────────

export function Report(props: Props) {
  const {
    windowDays, generatedAt, series, cgm24h, latest, spo2Night, fingersticks,
    labPanels, labTrends, medications, baselines,
  } = props

  // Build the drift panel client-side (mirrors BaselinesDriftPanel).
  // Doing this server-side would push function fields like signal.fmt
  // across the server→client boundary, which Next.js rejects.
  const driftPanel = useMemo<DriftPanelData>(() => {
    const verdicts = DRIFT_METRICS.map((m) =>
      evaluateMetric(m, baselines.drift[m] ?? [], {
        anchor: baselines.anchor,
        contextToday: baselines.context,
        medChanges: baselines.medChanges,
      })
    )
    return buildDriftPanelData(verdicts, baselines.drift, 30)
  }, [baselines])

  const bpCat = latest.bp ? bpCategory(latest.bp.sys, latest.bp.dia) : null
  const cardiacLabs = buildCardiacLabSummary(labTrends)
  const sysSpark = series.map((d) => d.sys).filter((v): v is number => v !== null)
  const rhrSpark = series.map((d) => d.rhr).filter((v): v is number => v !== null)
  const hrvSpark = series.map((d) => d.hrv).filter((v): v is number => v !== null)

  // Non-key markers that have been imported (for the labs detail page).
  const nonKeyTrends = labTrends.filter((t) => !KEY_MARKER_SLUGS.includes(t.marker_slug))

  // BP bands for the cardiac trend chart — same logic as CardiacPanel.
  const bpBands = [...BP_DIA_BANDS, ...BP_SYS_BANDS]

  // TIR computation for the glucose page — count-based proxy on the
  // last 24h CGM (matches GlucosePanel).
  const tirCounts = { below: 0, inRange: 0, above: 0 }
  for (const p of cgm24h) {
    if (p.mmol < GLUCOSE_LO) tirCounts.below++
    else if (p.mmol > GLUCOSE_HI) tirCounts.above++
    else tirCounts.inRange++
  }
  const tirTotal = Math.max(1, tirCounts.below + tirCounts.inRange + tirCounts.above)
  const tirPct = {
    below: Math.round((tirCounts.below / tirTotal) * 100),
    inRange: Math.round((tirCounts.inRange / tirTotal) * 100),
    above: Math.round((tirCounts.above / tirTotal) * 100),
  }

  return (
    <article className="report-doc">
      {/* On-screen print button — hidden in print CSS. */}
      <div className="report-toolbar print-hide">
        <button type="button" className="report-print-btn" onClick={() => window.print()}>
          <Printer size={14} /> Print / Save as PDF
        </button>
        <span className="report-toolbar-meta">
          Window: vitals/glucose/sleep last {windowDays} days · labs: all draws.
        </span>
      </div>

      {/* ────────────── PAGE 1 — Cardiac snapshot ────────────── */}
      <section className="report-page report-page-1">
        <header className="report-header">
          <div>
            <h1 className="report-title">Cardiac record — Irfan Ali Shah</h1>
            <div className="report-subtitle">
              Male, 47 yrs · NKDA · {STEMI_LABEL} · {LAD_LABEL} · {EF_LABEL}
            </div>
            <div className="report-meta">
              Generated {fmtDate(generatedAt)} · data window {windowDays} days (labs: all draws)
            </div>
          </div>
        </header>

        {/* Meds */}
        <section className="report-section">
          <h2 className="report-section-title">Current medications</h2>
          {medications.length === 0 ? (
            <p className="report-empty">No active medications recorded.</p>
          ) : (
            <ul className="report-meds">
              {medications.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong>
                  {m.dose && <> {m.dose}</>}
                  {m.frequency && <span className="report-meds-freq"> · {m.frequency}</span>}
                  {m.notes && <span className="report-meds-notes"> ({m.notes})</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* BP + HR/HRV side by side */}
        <section className="report-row">
          <div className="report-tile">
            <h3 className="report-tile-title">Blood pressure</h3>
            {latest.bp && bpCat ? (
              <>
                <div className="report-tile-value">
                  {latest.bp.sys}/{latest.bp.dia} <span className="report-tile-unit">mmHg</span>
                </div>
                <div className="report-tile-tag" style={{ color: bpCat.color }}>{bpCat.label}</div>
                <div className="report-tile-meta">as of {fmtDate(latest.bp.at)}</div>
                {sysSpark.length > 0 && (
                  <div className="report-tile-spark">
                    <Sparkline data={sysSpark} color="var(--red)" width={220} height={36} />
                  </div>
                )}
              </>
            ) : (
              <div className="report-empty">No BP reading in window.</div>
            )}
          </div>

          <div className="report-tile">
            <h3 className="report-tile-title">Resting HR &amp; HRV</h3>
            <div className="report-tile-pair">
              <div>
                <div className="report-tile-mini-label">RHR</div>
                <div className="report-tile-mini-val">{fmtInt(latest.rhr?.value ?? null)}<span className="report-tile-unit">bpm</span></div>
              </div>
              <div>
                <div className="report-tile-mini-label">HRV</div>
                <div className="report-tile-mini-val">{fmtInt(latest.hrv?.value ?? null)}<span className="report-tile-unit">ms</span></div>
              </div>
            </div>
            <div className="report-tile-meta">
              latest as of {fmtDate(latest.rhr?.at ?? latest.hrv?.at ?? null)}
            </div>
            {(rhrSpark.length > 0 || hrvSpark.length > 0) && (
              <div className="report-tile-spark report-tile-spark-pair">
                {rhrSpark.length > 0 && <Sparkline data={rhrSpark} color="var(--purple)" width={220} height={28} />}
                {hrvSpark.length > 0 && <Sparkline data={hrvSpark} color="var(--teal)" width={220} height={28} />}
              </div>
            )}
          </div>
        </section>

        {/* Cardiac labs table — the centerpiece */}
        <section className="report-section">
          <h2 className="report-section-title">Cardiac labs (latest)</h2>
          {cardiacLabs.length === 0 ? (
            <p className="report-empty">No cardiac key-marker labs imported yet.</p>
          ) : (
            <>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Marker</th>
                    <th>Value</th>
                    <th>Target</th>
                    <th>Status</th>
                    <th>Δ vs prior</th>
                    <th>Drawn</th>
                  </tr>
                </thead>
                <tbody>
                  {cardiacLabs.map((r) => {
                    const trend = trendArrow(r.goalTrend)
                    const oor = r.flag && r.flag !== 'N'
                    return (
                      <tr key={r.slug} className={oor ? 'oor' : ''}>
                        <td>
                          <strong>{r.display}</strong>
                          {!r.modifiable && <span className="report-tag" title="Non-modifiable risk marker — not a treatment target">info</span>}
                        </td>
                        <td className="num">
                          {fmtNum(r.latest, 2)} <span className="unit">{r.unit}</span>
                          {r.flag && r.flag !== 'N' && (
                            <span className={`report-flag report-flag-${r.flag.toLowerCase()}`} style={{ marginLeft: 4 }}>
                              {r.flag}
                            </span>
                          )}
                          {r.slug === 'ldl' && r.reductionPct !== null && r.baseline !== null && (
                            <div className="report-ldl-reduction">
                              ↓ {r.reductionPct >= 0 ? r.reductionPct.toFixed(0) : `+${Math.abs(r.reductionPct).toFixed(0)}`}% from baseline {fmtNum(r.baseline, 2)}
                              {r.meetsReductionGoal ? ' · ≥50% goal met' : ' · ≥50% goal not yet met'}
                            </div>
                          )}
                        </td>
                        <td className="num">
                          {r.target ? (
                            <span title={r.target.label}>{r.target.label.split(' · ')[0]}</span>
                          ) : (
                            <>
                              {refRangeText({ ref_low: r.refLow, ref_high: r.refHigh, ref_unit: r.unit })}
                              {r.refSource && <span className="report-prov"> · {provenance(r.refSource)}</span>}
                            </>
                          )}
                        </td>
                        <td>
                          {r.goalState ? (
                            <span
                              className="report-goal-pill"
                              style={{ color: GOAL_COLOR[r.goalState], borderColor: GOAL_COLOR[r.goalState] }}
                            >
                              {GOAL_LABEL[r.goalState]}
                            </span>
                          ) : r.unmatchedReason ? (
                            <span className="report-empty" title={r.unmatchedReason}>unit not matched</span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="num">
                          {r.delta !== null ? (
                            <>
                              {`${directionLabel(r.direction)} ${Math.abs(r.delta).toFixed(2)}`}
                              {trend.arrow && (
                                <span style={{ color: trend.color, marginLeft: 4 }} title={r.goalTrend ?? ''}>
                                  {trend.arrow}
                                </span>
                              )}
                            </>
                          ) : '—'}
                        </td>
                        <td>{fmtDateShort(r.drawnAt)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="report-footnote-inline">{LAB_TARGET_PROVISIONAL_NOTE}</p>
            </>
          )}
        </section>

        {/* Overnight oxygen + notable drift */}
        <section className="report-row">
          <div className="report-tile">
            <h3 className="report-tile-title">Overnight oxygen <span className="report-tag">screening-grade</span></h3>
            {latest.spo2 ? (
              <>
                <div className="report-tile-pair report-tile-pair-3">
                  <div>
                    <div className="report-tile-mini-label">Avg</div>
                    <div className="report-tile-mini-val">{fmtInt(latest.spo2.avg)}<span className="report-tile-unit">%</span></div>
                  </div>
                  <div>
                    <div className="report-tile-mini-label">Min</div>
                    <div className="report-tile-mini-val" style={{ color: STATUS_COLOR[st.spo2(latest.spo2.min)] }}>
                      {fmtInt(latest.spo2.min)}<span className="report-tile-unit">%</span>
                    </div>
                  </div>
                  <div>
                    <div className="report-tile-mini-label">ODI</div>
                    <div className="report-tile-mini-val" style={{ color: latest.spo2.odi !== null ? STATUS_COLOR[st.odi(latest.spo2.odi)] : 'var(--text-dim)' }}>
                      {latest.spo2.odi !== null ? fmtNum(latest.spo2.odi, 1) : '—'}<span className="report-tile-unit">/h</span>
                    </div>
                  </div>
                </div>
                <div className="report-tile-meta">
                  Time below 90%: {fmtNum(latest.spo2.timeBelow90Pct, 1)}% · last night {fmtDate(latest.spo2.at)}
                </div>
              </>
            ) : (
              <div className="report-empty">No overnight SpO2 in window.</div>
            )}
          </div>

          <div className="report-tile">
            <h3 className="report-tile-title">Notable drift</h3>
            {driftPanel.safety.length === 0 && driftPanel.drift.length === 0 ? (
              <div className="report-empty">Nothing currently drifting — all tracked signals holding within personal-normal.</div>
            ) : (
              <ul className="report-drift-list">
                {driftPanel.safety.map((s) => (
                  <li key={`safety-${s.id}`} className="report-drift-safety">
                    <strong>{s.label}</strong>: {s.lead}
                  </li>
                ))}
                {driftPanel.drift.map((s) => (
                  <li key={`drift-${s.id}`}>
                    {s.early && <span className="report-tag">early</span>}{' '}
                    <strong>{s.label}</strong>: {s.lead}
                  </li>
                ))}
              </ul>
            )}
            <div className="report-tile-meta">
              {driftPanel.steady.length} steady · {driftPanel.improvement.length} improving · {driftPanel.settling.length} settling in · {driftPanel.nodata.length} no recent data
            </div>
          </div>
        </section>

        <footer className="report-footer">
          Patient-tracked data, screening-grade — not a diagnostic record.
          Devices: Whoop 5.0 MG, Withings BPM, Oxylink overnight ring, Nightscout/G7 CGM, Contour Next One fingerstick, lab reports (Fakeeh + other providers).
        </footer>
      </section>

      {/* ────────────── DETAIL — Cardiac trends ────────────── */}
      <section className="report-page">
        <h2 className="report-page-title">Cardiac trends — last {windowDays} days</h2>

        <h3 className="report-h3">Blood pressure (ACC/AHA zones)</h3>
        {series.some((d) => d.sys !== null) ? (
          <TrendChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={260}
            yDomain={bpSeriesYDomain()}
            yTicks={6}
            bands={bpBands}
            divider={{ value: 95, labelAbove: 'Systolic', labelBelow: 'Diastolic' }}
            series={[
              { accessor: (d: DailyMetricRow) => d.sys, color: 'var(--red)', label: 'Systolic', fill: false },
              { accessor: (d: DailyMetricRow) => d.dia, color: 'var(--teal)', label: 'Diastolic', fill: false },
            ]}
            tooltipRows={(d: DailyMetricRow) => {
              const rows: { color: string; label: string; value: string }[] = []
              if (d.sys !== null) rows.push({ color: 'var(--red)', label: 'Systolic', value: `${d.sys} mmHg` })
              if (d.dia !== null) rows.push({ color: 'var(--teal)', label: 'Diastolic', value: `${d.dia} mmHg` })
              if (d.pulse !== null) rows.push({ color: 'var(--text-muted)', label: 'Pulse', value: `${d.pulse} bpm` })
              return rows
            }}
            formatY={(v) => `${Math.round(v)}`}
          />
        ) : (
          <p className="report-empty">No BP readings in window.</p>
        )}

        <h3 className="report-h3">Resting HR &amp; HRV</h3>
        {series.some((d) => d.rhr !== null || d.hrv !== null) ? (
          <TrendChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={200}
            yDomain={rhrHrvYDomain(series)}
            yTicks={4}
            formatY={(v) => `${Math.round(v)}`}
            series={[
              { accessor: (d: DailyMetricRow) => d.rhr, color: 'var(--purple)', label: 'Resting HR', fill: true },
              { accessor: (d: DailyMetricRow) => d.hrv, color: 'var(--teal)', label: 'HRV', fill: false },
            ]}
            tooltipRows={(d: DailyMetricRow) => {
              const rows: { color: string; label: string; value: string }[] = []
              if (d.rhr !== null) rows.push({ color: 'var(--purple)', label: 'RHR', value: `${Math.round(d.rhr)} bpm` })
              if (d.hrv !== null) rows.push({ color: 'var(--teal)', label: 'HRV', value: `${Math.round(d.hrv)} ms` })
              return rows
            }}
          />
        ) : (
          <p className="report-empty">No Whoop RHR/HRV in window.</p>
        )}
      </section>

      {/* ────────────── DETAIL — Glucose ────────────── */}
      <section className="report-page">
        <h2 className="report-page-title">Glucose — last {windowDays} days</h2>

        <h3 className="report-h3">Last 24 hours (CGM) — TIR donut</h3>
        {cgm24h.length > 0 ? (
          <div className="report-row">
            <div className="report-tile">
              <Donut
                size={140}
                thickness={20}
                segments={[
                  { value: tirCounts.inRange, color: 'var(--teal)' },
                  { value: tirCounts.above, color: 'var(--amber)' },
                  { value: tirCounts.below, color: 'var(--red)' },
                ]}
                centerLabel={`${tirPct.inRange}%`}
                centerSub="in range (24h)"
              />
              <ul className="report-tir-legend">
                <li><span className="dot" style={{ background: 'var(--teal)' }} />in range {tirPct.inRange}%</li>
                <li><span className="dot" style={{ background: 'var(--amber)' }} />above {tirPct.above}%</li>
                <li><span className="dot" style={{ background: 'var(--red)' }} />below {tirPct.below}%</li>
              </ul>
            </div>
            <div className="report-tile report-tile-wide">
              <CGMChart
                data={cgm24h.map((p) => ({ time: new Date(p.time), value: p.mmol }))}
                lo={GLUCOSE_LO}
                hi={GLUCOSE_HI}
                unit="mmol/L"
                height={200}
              />
            </div>
          </div>
        ) : (
          <p className="report-empty">No CGM readings in the last 24 hours.</p>
        )}

        <h3 className="report-h3">Fasting glucose (window)</h3>
        {series.some((d) => d.fasting !== null) ? (
          <TrendChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={180}
            yTicks={4}
            formatY={(v) => v.toFixed(1)}
            bands={[{ from: 3.9, to: 5.6, color: 'var(--teal)', opacity: 0.1 }]}
            series={[
              { accessor: (d: DailyMetricRow) => d.fasting, color: 'var(--purple)', label: 'Fasting', fill: true },
            ]}
            tooltipRows={(d: DailyMetricRow) =>
              d.fasting !== null
                ? [{ color: 'var(--purple)', label: 'Fasting', value: `${d.fasting} mmol/L` }]
                : []
            }
          />
        ) : (
          <p className="report-empty">No fasting glucose in window.</p>
        )}

        {fingersticks.length > 0 && (
          <>
            <h3 className="report-h3">Recent fingersticks ({fingersticks.length})</h3>
            <table className="report-table report-table-compact">
              <thead>
                <tr><th>Date / time</th><th>Value</th><th>Meal</th><th>Source</th></tr>
              </thead>
              <tbody>
                {[...fingersticks].reverse().slice(0, 20).map((fs, i) => (
                  <tr key={i}>
                    <td>{fmtDate(fs.time.toISOString())} {fs.time.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="num">{fmtNum(fs.mmol, 1)} mmol/L</td>
                    <td>{fs.mealMarker ?? '—'}</td>
                    <td>{fs.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {/* ────────────── DETAIL — Sleep, Recovery & Overnight oxygen ────────────── */}
      <section className="report-page">
        <h2 className="report-page-title">Sleep, recovery &amp; overnight oxygen — last {windowDays} days</h2>

        <h3 className="report-h3">Recovery score</h3>
        {series.some((d) => d.recovery !== null) ? (
          <TrendChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={180}
            yDomain={[30, 90]}
            yTicks={4}
            formatY={(v) => `${Math.round(v)}`}
            series={[{ accessor: (d: DailyMetricRow) => d.recovery, color: 'var(--purple)', label: 'Recovery', fill: true }]}
            tooltipRows={(d: DailyMetricRow) =>
              d.recovery !== null ? [{ color: 'var(--purple)', label: 'Recovery', value: `${Math.round(d.recovery)}%` }] : []
            }
            unit="%"
          />
        ) : (
          <p className="report-empty">No Whoop recovery in window.</p>
        )}

        <h3 className="report-h3">Sleep duration (total hours)</h3>
        {series.some((d) => d.sleep_total !== null) ? (
          <TrendChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={160}
            yTicks={4}
            formatY={(v) => v.toFixed(1)}
            bands={[{ from: 7, to: 9, color: 'var(--teal)', opacity: 0.1 }]}
            series={[{ accessor: (d: DailyMetricRow) => d.sleep_total, color: 'var(--purple)', label: 'Total sleep', fill: true }]}
            tooltipRows={(d: DailyMetricRow) =>
              d.sleep_total !== null ? [{ color: 'var(--purple)', label: 'Total sleep', value: `${d.sleep_total.toFixed(1)}h` }] : []
            }
          />
        ) : (
          <p className="report-empty">No Whoop sleep data in window.</p>
        )}

        <h3 className="report-h3">Overnight SpO2 (avg / min)</h3>
        {series.some((d) => d.spo2_avg !== null || d.spo2_min !== null) ? (
          <TrendChart
            data={series}
            xAccessor={(d) => new Date(d.date)}
            height={170}
            yDomain={[80, 100]}
            yTicks={3}
            formatY={(v) => `${Math.round(v)}`}
            bands={[{ from: 95, to: 100, color: 'var(--teal)', opacity: 0.1 }]}
            series={[
              { accessor: (d: DailyMetricRow) => d.spo2_avg, color: 'var(--teal)', label: 'Avg', fill: true },
              { accessor: (d: DailyMetricRow) => d.spo2_min, color: 'var(--purple)', label: 'Min', dash: '4 4' },
            ]}
            tooltipRows={(d: DailyMetricRow) => {
              const rows: { color: string; label: string; value: string }[] = []
              if (d.spo2_avg !== null) rows.push({ color: 'var(--teal)', label: 'Avg', value: `${Math.round(d.spo2_avg)}%` })
              if (d.spo2_min !== null) rows.push({ color: 'var(--purple)', label: 'Min', value: `${Math.round(d.spo2_min)}%` })
              return rows
            }}
          />
        ) : (
          <p className="report-empty">No overnight SpO2 in window.</p>
        )}

        <h3 className="report-h3">Latest overnight oxygen curve</h3>
        {spo2Night && spo2Night.curve.length > 0 ? (
          <Spo2OvernightChart data={spo2Night.curve} events={spo2Night.events} />
        ) : (
          <p className="report-empty">No overnight oxygen curve yet.</p>
        )}

        {(series.some((d) => d.spo2_odi !== null) || series.some((d) => d.spo2_time_below_90 !== null)) && (
          <>
            <h3 className="report-h3">ODI &amp; time below 90% (window)</h3>
            <TrendChart
              data={series}
              xAccessor={(d) => new Date(d.date)}
              height={150}
              yTicks={3}
              formatY={(v) => v.toFixed(1)}
              series={[
                { accessor: (d: DailyMetricRow) => d.spo2_odi, color: 'var(--amber)', label: 'ODI (/h)', fill: true },
                { accessor: (d: DailyMetricRow) => d.spo2_time_below_90, color: 'var(--red)', label: 'Time <90% (%)', dash: '4 4' },
              ]}
              tooltipRows={(d: DailyMetricRow) => {
                const rows: { color: string; label: string; value: string }[] = []
                if (d.spo2_odi !== null) rows.push({ color: 'var(--amber)', label: 'ODI', value: `${d.spo2_odi.toFixed(1)}/h` })
                if (d.spo2_time_below_90 !== null) rows.push({ color: 'var(--red)', label: 'Time <90%', value: `${d.spo2_time_below_90.toFixed(1)}%` })
                return rows
              }}
            />
          </>
        )}
      </section>

      {/* ────────────── DETAIL — Labs history + per-marker trends ────────────── */}
      <section className="report-page">
        <h2 className="report-page-title">Lab history — all draws</h2>

        {labPanels.length === 0 ? (
          <p className="report-empty">No lab panels imported yet.</p>
        ) : (
          <div className="report-labs-history">
            {labPanels.map((p) => (
              <div key={p.id} className="report-panel">
                <div className="report-panel-head">
                  <strong>{fmtDate(p.drawn_at)}</strong>
                  {p.lab_name && <span className="report-panel-lab"> · {p.lab_name}</span>}
                  {p.ordering_physician && <span className="report-panel-md"> · {p.ordering_physician}</span>}
                </div>
                <table className="report-table report-table-compact">
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
                      const result = v.numeric_value !== null
                        ? `${v.numeric_value}${v.unit ? ' ' + v.unit : ''}`
                        : v.text_value ?? '—'
                      const oor = isOutOfRange(v)
                      return (
                        <tr key={i} className={oor ? 'oor' : ''}>
                          <td>{display}</td>
                          <td className="num">{result}</td>
                          <td className="num">
                            {refRangeText(v)}
                            {v.ref_source && <span className="report-prov"> · {provenance(v.ref_source)}</span>}
                          </td>
                          <td>{v.flag ? <span className={`report-flag report-flag-${v.flag.toLowerCase()}`}>{v.flag}</span> : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {labTrends.length > 0 && (
        <section className="report-page">
          <h2 className="report-page-title">Lab trends — key markers + others (≥2 draws)</h2>
          <div className="report-trend-grid">
            {labTrends
              .filter((t) => t.points.length >= 2 || KEY_MARKER_SLUGS.includes(t.marker_slug))
              .map((t) => {
                // Skip non-key markers with only 1 draw (TrendCard for 1
                // point reads as "single dot" — keep the page clean).
                if (t.points.length < 2 && !CARDIAC_KEY_MARKERS.includes(t.marker_slug)) return null
                const latestRef = (() => {
                  for (let i = t.points.length - 1; i >= 0; i--) {
                    const p = t.points[i]
                    if (p.ref_low !== null || p.ref_high !== null) return { low: p.ref_low, high: p.ref_high, src: p.ref_source }
                  }
                  return null
                })()
                return (
                  <div key={t.marker_slug} className="report-trend-card">
                    <h4 className="report-trend-title">
                      {t.display}
                      {KEY_MARKER_SLUGS.includes(t.marker_slug) && <span className="report-key-star"> ★</span>}
                      <span className="report-trend-meta">
                        {' '}— {t.points.length} draw{t.points.length === 1 ? '' : 's'}
                      </span>
                    </h4>
                    <TrendChart
                      data={t.points}
                      xAccessor={(p) => new Date(p.drawn_at)}
                      height={140}
                      yTicks={3}
                      formatY={(v) => v.toFixed(2)}
                      bands={
                        latestRef && latestRef.low !== null && latestRef.high !== null
                          ? [{ from: latestRef.low, to: latestRef.high, color: 'var(--teal)', opacity: 0.1 }]
                          : []
                      }
                      series={[
                        {
                          accessor: (p: typeof t.points[number]) => p.value,
                          color: 'var(--purple)',
                          label: t.display,
                          fill: true,
                        },
                      ]}
                      tooltipRows={(p: typeof t.points[number]) => {
                        const u = t.canonical_unit ?? p.unit ?? ''
                        return [{ color: 'var(--purple)', label: t.display, value: `${p.value}${u ? ' ' + u : ''}` }]
                      }}
                    />
                  </div>
                )
              })}
          </div>
        </section>
      )}

      {/* ────────────── DETAIL — Baselines & drift summary ────────────── */}
      <section className="report-page">
        <h2 className="report-page-title">Baselines &amp; drift</h2>
        <p className="report-drift-overall" style={{ borderLeftColor: driftPanel.tone === 'safety' ? 'var(--red)' : driftPanel.tone === 'attention' ? 'var(--amber)' : 'var(--teal)' }}>
          <strong>{driftPanel.title}</strong> — {driftPanel.body}
        </p>

        {driftPanel.safety.length > 0 && (
          <>
            <h3 className="report-h3 report-h3-safety">Below a safe line</h3>
            <ul className="report-drift-detail">
              {driftPanel.safety.map((s) => (
                <li key={s.id}><strong>{s.label}</strong> ({s.source}) — {s.lead}</li>
              ))}
            </ul>
          </>
        )}

        {driftPanel.drift.length > 0 && (
          <>
            <h3 className="report-h3">Worth a look</h3>
            <ul className="report-drift-detail">
              {driftPanel.drift.map((s) => (
                <li key={s.id}>
                  <strong>{s.label}</strong> ({s.source})
                  {s.early && <span className="report-tag"> early</span>}
                  {s.caution && <span className="report-tag"> caution</span>}
                  {' '}— {s.lead}
                </li>
              ))}
            </ul>
          </>
        )}

        {driftPanel.improvement.length > 0 && (
          <>
            <h3 className="report-h3">Going the right way</h3>
            <ul className="report-drift-detail">
              {driftPanel.improvement.map((s) => (
                <li key={s.id}><strong>{s.label}</strong> ({s.source}) — {s.lead}</li>
              ))}
            </ul>
          </>
        )}

        {driftPanel.steady.length > 0 && (
          <>
            <h3 className="report-h3">Steady ({driftPanel.steady.length})</h3>
            <p className="report-drift-steady">
              {driftPanel.steady.map((s) => s.label).join(' · ')}
            </p>
          </>
        )}

        {(driftPanel.settling.length > 0 || driftPanel.nodata.length > 0) && (
          <>
            <h3 className="report-h3">Not reading yet</h3>
            <p className="report-drift-steady">
              {[...driftPanel.settling, ...driftPanel.nodata].map((s) => s.label).join(' · ')}
            </p>
          </>
        )}

        <footer className="report-footer">
          Baselines &amp; drift compares against this patient&apos;s own rolling history (not population averages).
          Patterns to notice, not diagnoses. Generated {fmtDate(generatedAt)}.
        </footer>
      </section>

      {/* Reference to silence unused-imports for tab-bar charts that
          appear only conditionally. (No-op.) */}
      <div style={{ display: 'none' }}>
        {nonKeyTrends.length}
      </div>
    </article>
  )
}
