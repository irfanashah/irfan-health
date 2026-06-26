'use client'

import { useState } from 'react'
import { ChevronDown, ChevronRight, Beaker } from 'lucide-react'
import type { LabPanelRow } from './actions'
import { getMarker } from './_lib/markers'

interface Props {
  panels: LabPanelRow[]
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' })
}

function flagBadgeColor(flag: string | null): string {
  if (flag === 'L' || flag === 'H') return 'var(--amber)'
  if (flag === 'LL' || flag === 'HH') return 'var(--red)'
  return 'var(--text-dim)'
}

function isOutOfRange(v: { numeric_value: number | null; ref_low: number | null; ref_high: number | null; flag: string | null }): boolean {
  if (v.flag && v.flag !== 'N') return true
  if (v.numeric_value === null) return false
  if (v.ref_low !== null && v.numeric_value < v.ref_low) return true
  if (v.ref_high !== null && v.numeric_value > v.ref_high) return true
  return false
}

export function PanelsList({ panels }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  return (
    <section className="labs-card">
      <h2 className="labs-section-title">
        <Beaker size={16} /> Panels ({panels.length})
      </h2>
      {panels.length === 0 ? (
        <div className="labs-empty">No lab panels yet. Upload a report above to start.</div>
      ) : (
        <ul className="labs-panels">
          {panels.map((p) => {
            const isOpen = expanded[p.id] ?? false
            const outOfRangeCount = p.values.filter(isOutOfRange).length
            return (
              <li key={p.id} className="labs-panel-item">
                <button
                  type="button"
                  className="labs-panel-head"
                  onClick={() => setExpanded((s) => ({ ...s, [p.id]: !isOpen }))}
                >
                  {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="labs-panel-date">{fmtDate(p.drawn_at)}</span>
                  {p.lab_name && <span className="labs-panel-lab">{p.lab_name}</span>}
                  <span className="labs-panel-count">{p.values.length} markers</span>
                  {outOfRangeCount > 0 && (
                    <span className="labs-panel-oor">
                      {outOfRangeCount} out of range
                    </span>
                  )}
                </button>
                {isOpen && (
                  <div className="labs-panel-body">
                    {p.ordering_physician && (
                      <div className="labs-panel-meta">Ordered by {p.ordering_physician}</div>
                    )}
                    {p.notes && <div className="labs-panel-meta">{p.notes}</div>}
                    <table className="labs-values-table">
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
                          const result = v.numeric_value !== null
                            ? `${v.numeric_value}${v.unit ? ' ' + v.unit : ''}`
                            : v.text_value ?? '—'
                          const refNumeric = v.ref_low !== null && v.ref_high !== null
                            ? `${v.ref_low}–${v.ref_high}${v.ref_unit ? ' ' + v.ref_unit : ''}`
                            : v.ref_low !== null
                              ? `≥ ${v.ref_low}${v.ref_unit ? ' ' + v.ref_unit : ''}`
                              : v.ref_high !== null
                                ? `≤ ${v.ref_high}${v.ref_unit ? ' ' + v.ref_unit : ''}`
                                : '—'
                          return (
                            <tr key={i} className={oor ? 'oor' : ''}>
                              <td>
                                <div className="labs-marker-name">{display}</div>
                                {def && def.display !== v.raw_marker_name && (
                                  <div className="labs-marker-raw">{v.raw_marker_name}</div>
                                )}
                              </td>
                              <td className="labs-marker-result">{result}</td>
                              <td className="labs-marker-ref">
                                {refNumeric}
                                {v.ref_source === 'standard' && (
                                  <span className="labs-prov labs-prov-standard" style={{ marginLeft: 6 }}>standard</span>
                                )}
                              </td>
                              <td>
                                {v.flag && (
                                  <span
                                    className="labs-flag-badge"
                                    style={{ color: flagBadgeColor(v.flag), borderColor: flagBadgeColor(v.flag) }}
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
    </section>
  )
}
