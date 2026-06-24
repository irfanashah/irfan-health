'use client'

import { Droplet, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { CGMChart, type CgmMarker } from '../charts/CGMChart'
import { Donut } from '../charts/Donut'
import { GLUCOSE_HI, GLUCOSE_LO, MMOL_TO_MGDL, STATUS_COLOR, st } from '../thresholds'
import type { CgmPoint, LatestKpis, FingerstickPoint } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  cgm24h: CgmPoint[]
  latest: LatestKpis
  unit: 'mmol/L' | 'mg/dL'
  onUnitChange: (u: 'mmol/L' | 'mg/dL') => void
  fingersticks?: FingerstickPoint[]
}

const SOURCE_LABEL: Record<string, string> = {
  contour: 'Contour',
  manual: 'Manual log',
}

function fmtUpdated(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function GlucosePanel({ cgm24h, latest, unit, onUnitChange, fingersticks = [] }: Props) {
  // Map fingerstick readings (Contour + Slice 3 manual — both write
  // metric_type='glucose_fingerstick') into value-anchored CgmMarkers.
  // The CGMChart plots each at yOf(value), NOT snapped to the CGM curve,
  // so meter-vs-sensor agreement is visible at the moment the reading was taken.
  const fingerstickMarkers: CgmMarker[] = fingersticks.map((fs, i) => {
    const sourceLabel = SOURCE_LABEL[fs.source] ?? fs.source
    const detail = fs.mealMarker
      ? `${fs.mealMarker} · ${sourceLabel}`
      : sourceLabel
    return {
      id: `fs-${i}-${fs.time.getTime()}`,
      time: fs.time,
      kind: 'fingerstick',
      label: 'Fingerstick',
      detail,
      value: fs.mmol,
    }
  })
  const toG = (mmol: number) => (unit === 'mmol/L' ? +mmol.toFixed(1) : Math.round(mmol * MMOL_TO_MGDL))

  // Compute TIR from the same 24h window we're charting (consistent with what the user sees).
  const counts = { below: 0, inRange: 0, above: 0 }
  for (const p of cgm24h) {
    if (p.mmol < GLUCOSE_LO) counts.below++
    else if (p.mmol > GLUCOSE_HI) counts.above++
    else counts.inRange++
  }
  const total = counts.below + counts.inRange + counts.above
  const tir = {
    below: total > 0 ? Math.round((counts.below / total) * 100) : 0,
    inRange: total > 0 ? Math.round((counts.inRange / total) * 100) : 0,
    above: total > 0 ? Math.round((counts.above / total) * 100) : 0,
  }

  const arrow = latest.cgm
    ? latest.cgm.trendDir === 'rising'
      ? <ArrowUp size={22} />
      : latest.cgm.trendDir === 'falling'
      ? <ArrowDown size={22} />
      : <ArrowRight size={22} />
    : null

  return (
    <Card className="col-7">
      <PanelHeader
        icon={<Droplet size={18} />}
        title="Glucose"
        source="nightscout"
        accent="var(--purple)"
        right={
          <div className="seg unit-seg">
            <button className={`seg-btn ${unit === 'mmol/L' ? 'active' : ''}`} onClick={() => onUnitChange('mmol/L')}>mmol/L</button>
            <button className={`seg-btn ${unit === 'mg/dL' ? 'active' : ''}`} onClick={() => onUnitChange('mg/dL')}>mg/dL</button>
          </div>
        }
      />
      <div className="glucose-top">
        <div className="glucose-now">
          {latest.cgm ? (
            <>
              <div className="g-now-val" style={{ color: STATUS_COLOR[st.glucose(latest.cgm.value)] }}>
                {toG(latest.cgm.value)}
                <span className="g-now-arrow">{arrow}</span>
              </div>
              <div className="g-now-unit">{unit} · {latest.cgm.trendDir}</div>
              <div className="g-now-meta">Updated {fmtUpdated(latest.cgm.at)}</div>
            </>
          ) : (
            <>
              <div className="g-now-val" style={{ color: 'var(--text-dim)' }}>—</div>
              <div className="g-now-unit">{unit}</div>
              <div className="g-now-meta">No recent CGM readings</div>
            </>
          )}
        </div>
        <div className="glucose-tir">
          <Donut
            size={132}
            thickness={18}
            segments={[
              { value: tir.inRange, color: 'var(--teal)' },
              { value: tir.above, color: 'var(--amber)' },
              { value: tir.below, color: 'var(--red)' },
            ]}
            centerLabel={`${tir.inRange}%`}
            centerSub={total > 0 ? 'in range (24h)' : 'no data'}
          />
          <div className="tir-legend">
            <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--amber)' }} />Above {toG(GLUCOSE_HI)}<b>{tir.above}%</b></div>
            <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--teal)' }} />In range<b>{tir.inRange}%</b></div>
            <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--red)' }} />Below {toG(GLUCOSE_LO)}<b>{tir.below}%</b></div>
          </div>
        </div>
      </div>
      <div className="chart-caption">
        <span>Last 24 hours</span>
        <span className="muted-note">target band {toG(GLUCOSE_LO)}–{toG(GLUCOSE_HI)} {unit}</span>
      </div>
      <CGMChart
        data={cgm24h.map((p) => ({ time: new Date(p.time), value: p.mmol }))}
        lo={GLUCOSE_LO}
        hi={GLUCOSE_HI}
        unit={unit}
        toDisplay={toG}
        height={216}
        markers={fingerstickMarkers}
      />
    </Card>
  )
}
