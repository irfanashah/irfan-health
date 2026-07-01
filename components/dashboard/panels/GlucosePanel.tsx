'use client'

import { Droplet, ArrowUp, ArrowDown, ArrowRight } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { CGMChart, type CgmMarker } from '../charts/CGMChart'
import { Donut } from '../charts/Donut'
import { GLUCOSE_HI, GLUCOSE_LO, MMOL_TO_MGDL, STATUS_COLOR, st } from '../thresholds'
import type { CgmPoint, LatestKpis, FingerstickPoint } from '@/app/lib/dashboard/daily-metrics'
import { useIsClient } from '@/lib/hooks/useIsClient'

/** Slim meal-marker shape — what the page passes from `meals` rows. */
export interface MealMarkerInput {
  id: string
  time: Date
  description: string
  carbs?: number | null
  mealLabel?: string | null
}

interface Props {
  cgm24h: CgmPoint[]
  latest: LatestKpis
  unit: 'mmol/L' | 'mg/dL'
  onUnitChange: (u: 'mmol/L' | 'mg/dL') => void
  /** Up to ~14 days of fingersticks (Contour + manual). The panel slices: */
  /**   - last 24 h → CGM overlay markers (existing behaviour when CGM is live) */
  /**   - head + top-10 → fallback "now" + recent-readings list when CGM is stale */
  fingersticks?: FingerstickPoint[]
  /** Today's meals — render as 'meal' markers on the CGM trace. */
  meals?: MealMarkerInput[]
}

const SOURCE_LABEL: Record<string, string> = {
  contour: 'Contour',
  manual: 'Manual log',
}

const FALLBACK_LIST_LIMIT = 10
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function fmtUpdated(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtAgo(time: Date): string {
  const dt = Date.now() - time.getTime()
  if (dt < HOUR_MS) {
    const m = Math.max(1, Math.round(dt / 60000))
    return `${m}m ago`
  }
  if (dt < DAY_MS) {
    const h = Math.round(dt / HOUR_MS)
    return `${h}h ago`
  }
  const days = Math.round(dt / DAY_MS)
  return `${days}d ago`
}

function fmtListTime(time: Date): string {
  const dt = Date.now() - time.getTime()
  if (dt < DAY_MS) {
    return time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return time.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
    ' · ' +
    time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function GlucosePanel({ cgm24h, latest, unit, onUnitChange, fingersticks = [], meals = [] }: Props) {
  const toG = (mmol: number) => (unit === 'mmol/L' ? +mmol.toFixed(1) : Math.round(mmol * MMOL_TO_MGDL))

  // ─── Fingerstick slices ────────────────────────────────────────────────
  // Ascending order from the reader; slice for the two distinct uses.
  // `since24h` is gated behind `useIsClient()` (null during SSR/first paint)
  // so the server-rendered markup and the client's hydration render agree —
  // same "start empty, fill in right after mount" idiom already used by
  // Header/ThemeToggle for other client-only, time-derived values. Recomputed
  // fresh on every render once mounted (not memoized), so a long-lived tab
  // stays correct as fresh props arrive via router.refresh() — unlike a
  // frozen-at-mount value, which would let the 24h window silently go stale.
  const isClient = useIsClient()
  const since24h = isClient ? new Date().getTime() - DAY_MS : null
  const fingersticks24h = since24h === null ? [] : fingersticks.filter((fs) => fs.time.getTime() >= since24h)
  const fingersticksNewestFirst = [...fingersticks].reverse()
  const latestFingerstick = fingersticksNewestFirst[0] ?? null
  const recentFingerstickList = fingersticksNewestFirst.slice(0, FALLBACK_LIST_LIMIT)

  // ─── Overlay markers (used when CGM is live) ──────────────────────────
  // Value-anchored — each fingerstick plots at yOf(value), NOT snapped to
  // the CGM curve, so meter-vs-sensor agreement is visible.
  const fingerstickMarkers: CgmMarker[] = fingersticks24h.map((fs, i) => {
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

  // Meal markers — only meals within the 24h CGM window. Carbs sizes
  // the glyph; the description is the tooltip detail. Honesty: macros
  // are LLM estimates (gotcha — labelled in the tooltip via "≈").
  const mealMarkers: CgmMarker[] = (since24h === null ? [] : meals.filter((m) => m.time.getTime() >= since24h))
    .map((m) => ({
      id: `meal-${m.id}`,
      time: m.time,
      kind: 'meal',
      label: m.mealLabel ? m.mealLabel.charAt(0).toUpperCase() + m.mealLabel.slice(1) : 'Meal',
      detail: m.description.length > 60 ? m.description.slice(0, 57) + '…' : m.description,
      carbs: m.carbs ?? 0,
    }))

  // ─── TIR (CGM-only, computed from the same 24h the chart shows) ────────
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

  const cgmLive = latest.cgm !== null
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
        source={cgmLive ? 'nightscout' : latestFingerstick ? 'manual' : 'nightscout'}
        accent="var(--purple)"
        right={
          <div className="seg unit-seg">
            <button className={`seg-btn ${unit === 'mmol/L' ? 'active' : ''}`} onClick={() => onUnitChange('mmol/L')}>mmol/L</button>
            <button className={`seg-btn ${unit === 'mg/dL' ? 'active' : ''}`} onClick={() => onUnitChange('mg/dL')}>mg/dL</button>
          </div>
        }
      />

      {/* ─── Headline + TIR/placeholder row ───────────────────────────── */}
      <div className="glucose-top">
        <div className="glucose-now">
          {cgmLive && latest.cgm ? (
            <>
              <div className="g-now-val" style={{ color: STATUS_COLOR[st.glucose(latest.cgm.value)] }}>
                {toG(latest.cgm.value)}
                <span className="g-now-arrow">{arrow}</span>
              </div>
              <div className="g-now-unit">{unit} · {latest.cgm.trendDir}</div>
              <div className="g-now-meta">Updated {fmtUpdated(latest.cgm.at)}</div>
            </>
          ) : latestFingerstick ? (
            // Fallback "now" — latest fingerstick. Coloured by st.glucose.
            // Source-agnostic so manual + Contour both surface here.
            <>
              <div className="g-now-val" style={{ color: STATUS_COLOR[st.glucose(latestFingerstick.mmol)] }}>
                {toG(latestFingerstick.mmol)}
              </div>
              <div className="g-now-unit">
                {unit} ·{' '}
                {latestFingerstick.mealMarker ?? 'fingerstick'}
              </div>
              <div className="g-now-meta">
                {fmtAgo(latestFingerstick.time)} ·{' '}
                {SOURCE_LABEL[latestFingerstick.source] ?? latestFingerstick.source} · no CGM
              </div>
            </>
          ) : (
            <>
              <div className="g-now-val" style={{ color: 'var(--text-dim)' }}>—</div>
              <div className="g-now-unit">{unit}</div>
              <div className="g-now-meta">No recent glucose readings</div>
            </>
          )}
        </div>

        {cgmLive && total > 0 ? (
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
              centerSub="in range (24h)"
            />
            <div className="tir-legend">
              <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--amber)' }} />Above {toG(GLUCOSE_HI)}<b>{tir.above}%</b></div>
              <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--teal)' }} />In range<b>{tir.inRange}%</b></div>
              <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--red)' }} />Below {toG(GLUCOSE_LO)}<b>{tir.below}%</b></div>
            </div>
          </div>
        ) : (
          // CGM-absent placeholder — replaces the 0/0/0 donut. Honest
          // "no CGM data" state; TIR needs a sensor.
          <div className="glucose-tir-empty">
            <div className="glucose-tir-empty-label">Time in range</div>
            <div className="glucose-tir-empty-note">Needs CGM data</div>
          </div>
        )}
      </div>

      {/* ─── Chart area: CGM trace (with fingerstick overlay) OR fallback list ── */}
      {cgmLive ? (
        <>
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
            markers={[...fingerstickMarkers, ...mealMarkers]}
          />
        </>
      ) : recentFingerstickList.length > 0 ? (
        <>
          <div className="chart-caption">
            <span>Recent fingersticks</span>
            <span className="muted-note">target {toG(GLUCOSE_LO)}–{toG(GLUCOSE_HI)} {unit} · no CGM in last 24h</span>
          </div>
          <ul className="glucose-fs-list">
            {recentFingerstickList.map((fs, i) => {
              const status = st.glucose(fs.mmol)
              const sourceLabel = SOURCE_LABEL[fs.source] ?? fs.source
              return (
                <li key={`${fs.time.getTime()}-${i}`} className="glucose-fs-row">
                  <span className="glucose-fs-dot" style={{ background: STATUS_COLOR[status] }} />
                  <span className="glucose-fs-time">{fmtListTime(fs.time)}</span>
                  <span className="glucose-fs-val" style={{ color: STATUS_COLOR[status] }}>
                    {toG(fs.mmol)}
                    <span className="glucose-fs-unit">{unit}</span>
                  </span>
                  <span className="glucose-fs-tag">
                    {fs.mealMarker ?? '—'} · {sourceLabel}
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <div className="empty-note">No glucose readings in this window</div>
      )}
    </Card>
  )
}
