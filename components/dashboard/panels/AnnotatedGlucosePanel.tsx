'use client'

import { useMemo } from 'react'
import { AlertTriangle, Droplet } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { CGMChart, type CgmMarker } from '../charts/CGMChart'
import { fmtTime } from '../charts/chart-utils'
import { GLUCOSE_HI, GLUCOSE_LO, MMOL_TO_MGDL } from '../thresholds'
import { RED_FLAG_REMINDER, getSymptom } from '@/app/log/_lib/symptoms'
import type { CgmPoint } from '@/app/lib/dashboard/daily-metrics'
import type { RecentEntry } from '@/app/log/_lib/types'

interface Props {
  cgm24h: CgmPoint[]
  recent: RecentEntry[]
  glucoseUnit: 'mmol/L' | 'mg/dL'
}

const RED_FLAG_CODES = new Set([
  'chest_pain',
  'chest_tightness',
  'dizziness_standing',
  'shortness_of_breath',
])

/**
 * Project a recent manual entry onto a CGM-window marker. Returns null when
 * the entry isn't a symptom/note, falls outside the window, or has no
 * timestamp we can plot.
 */
function toMarker(e: RecentEntry, t0: number, tN: number): CgmMarker | null {
  if (e.kind !== 'symptom' && e.kind !== 'note') return null
  const t = new Date(e.occurred_at).getTime()
  if (!Number.isFinite(t) || t < t0 || t > tN) return null

  if (e.kind === 'note') {
    const text = (e.raw as { text: string }).text
    return {
      id: `note_${e.id}`,
      time: new Date(t),
      label: 'Note',
      detail: text,
      kind: 'note',
    }
  }
  // symptom
  const payload = e.raw as { symptom_code: string; note: string | null }
  const def = getSymptom(payload.symptom_code)
  const label = def?.label ?? payload.symptom_code
  return {
    id: `symptom_${e.id}`,
    time: new Date(t),
    label,
    detail: payload.note ?? undefined,
    kind: 'symptom',
    redFlag: RED_FLAG_CODES.has(payload.symptom_code),
  }
}

export function AnnotatedGlucosePanel({ cgm24h, recent, glucoseUnit }: Props) {
  const markers = useMemo<CgmMarker[]>(() => {
    if (cgm24h.length === 0) return []
    const t0 = new Date(cgm24h[0].time).getTime()
    const tN = new Date(cgm24h[cgm24h.length - 1].time).getTime()
    return recent
      .map((e) => toMarker(e, t0, tN))
      .filter((m): m is CgmMarker => m !== null)
      .sort((a, b) => a.time.getTime() - b.time.getTime())
  }, [cgm24h, recent])

  const hasRedFlag = markers.some((m) => m.redFlag)
  const toG = (mmol: number) =>
    glucoseUnit === 'mmol/L' ? +mmol.toFixed(1) : Math.round(mmol * MMOL_TO_MGDL)

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Droplet size={18} />}
        title="Event-annotated glucose"
        accent="var(--purple)"
        right={
          <span className="muted-note">
            CGM · last 24h · manual symptoms + notes pinned on the curve
            <span style={{ opacity: 0.7 }}> (no meal logging yet)</span>
          </span>
        }
      />
      <CGMChart
        data={cgm24h.map((p) => ({ time: new Date(p.time), value: p.mmol }))}
        lo={GLUCOSE_LO}
        hi={GLUCOSE_HI}
        unit={glucoseUnit}
        toDisplay={toG}
        height={236}
        markers={markers}
      />
      {markers.length > 0 ? (
        <div className="event-legend">
          {markers.map((mm) => {
            const col =
              mm.redFlag ? 'var(--red)' :
              mm.kind === 'symptom' ? 'var(--amber)' :
              'var(--text-muted)'
            return (
              <span
                className={`event-chip ${mm.redFlag ? 'redflag' : ''}`}
                key={mm.id}
              >
                <span className="event-dot" style={{ background: col }} />
                {mm.redFlag && <AlertTriangle size={12} />}
                <b>{mm.label}</b>
                <span className="event-time">{fmtTime(mm.time)}</span>
              </span>
            )
          })}
        </div>
      ) : cgm24h.length === 0 ? null : (
        <div className="muted-note" style={{ marginTop: 12 }}>
          No symptoms or notes logged in the last 24 hours.
        </div>
      )}
      {hasRedFlag && (
        <div className="redflag-banner inline" style={{ marginTop: 12 }}>
          <AlertTriangle size={14} />
          <span>{RED_FLAG_REMINDER}</span>
        </div>
      )}
    </Card>
  )
}
