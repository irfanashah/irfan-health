'use client'

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, TestTube, LineChart } from 'lucide-react'
import { Card } from './ui/Card'
import { PanelHeader } from './ui/PanelHeader'
import { TrendChart } from './charts/TrendChart'
import { getMarker, KEY_MARKER_SLUGS } from '@/app/labs/_lib/markers'
import type { LabPanelRow, LabValueRow, MarkerTrend, MarkerTrendPoint } from '@/app/labs/actions'

interface Props {
  panels: LabPanelRow[]
  trends: MarkerTrend[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
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

/** Pad the y-domain around the data + the reference band. */
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
          No lab panels imported yet. Upload a PDF via the <a href="/labs">labs import tool</a> to start.
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

function TrendCard({ trend }: { trend: MarkerTrend }) {
  const def = getMarker(trend.marker_slug)
  const unit = trend.canonical_unit ?? trend.points[trend.points.length - 1]?.unit ?? ''
  const yDomain = deriveYDomain(trend)
  const ref = latestRefBand(trend)
  const series = buildSeries(trend)
  const latest = trend.points[trend.points.length - 1]
  const isKey = def?.keyMarker ?? false

  return (
    <Card className="col-6">
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
        bands={
          ref.low !== null && ref.high !== null
            ? [{ from: ref.low, to: ref.high, color: 'var(--teal)', opacity: 0.1 }]
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
          if (d.flag) rows.push({ color: 'var(--amber)', label: 'Flag', value: d.flag })
          return rows
        }}
      />
    </Card>
  )
}

// ─── Tab shell ───────────────────────────────────────────────────────────

export function LabsTab({ panels, trends }: Props) {
  const trendsBySlug = useMemo(() => new Map(trends.map((t) => [t.marker_slug, t])), [trends])
  const keyTrends = KEY_MARKER_SLUGS
    .map((s) => trendsBySlug.get(s))
    .filter((t): t is MarkerTrend => t !== undefined)
  // Non-key markers with ≥2 draws are pickable via the dropdown — sparse
  // single-draw markers stay only in the panels list (a single dot trend
  // isn't useful and would clutter).
  const pickable = trends.filter(
    (t) => !KEY_MARKER_SLUGS.includes(t.marker_slug) && t.points.length >= 2
  )
  const [pickedSlug, setPickedSlug] = useState<string>('')
  const picked = pickedSlug ? trendsBySlug.get(pickedSlug) ?? null : null

  return (
    <>
      <div className="section-divider tabhead">
        <div className="section-head">
          <span className="section-kicker" style={{ color: 'var(--teal)' }}>
            Labs
          </span>
          <h2 className="section-title">Lab markers &amp; trends</h2>
          <p className="section-sub">
            Cardiac key markers (★) trended across every draw; imported panels listed
            chronologically with out-of-range flagging. Import new reports via the{' '}
            <a href="/labs">labs upload tool</a> — they appear here once committed.
          </p>
        </div>
      </div>
      <main className="grid">
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
