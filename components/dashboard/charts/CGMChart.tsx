'use client'

import { useCallback, useId, useState } from 'react'
import { useMeasure } from './useMeasure'
import { clampN, fmtTime, smoothPath } from './chart-utils'
import { Tooltip } from './Tooltip'

export interface CgmDatum {
  time: Date
  value: number
}

/**
 * Event marker pinned onto the 24h CGM curve.
 *
 * Two anchoring modes:
 *  - kind ∈ {'symptom','note'} (Slice 7.2) → marker snaps to the CGM curve's
 *    value at that timestamp; symptoms get a top-of-chart pin too.
 *  - kind === 'fingerstick' (Contour parser + manual log) → marker plots at
 *    its OWN reading (`value`) NOT snapped to the curve, so meter-vs-sensor
 *    agreement is visible. No top-of-chart pin.
 */
export interface CgmMarker {
  id: string
  time: Date
  label: string
  detail?: string
  kind: 'symptom' | 'note' | 'fingerstick' | 'meal'
  redFlag?: boolean
  /** mmol/L — required when kind==='fingerstick' so the marker plots at the meter's own value. */
  value?: number
  /** Carbs for kind='meal' — sizes the marker glyph + shows in tooltip. */
  carbs?: number
}

interface Props {
  data: CgmDatum[]
  lo?: number                      // target band lower bound (display units)
  hi?: number                      // target band upper bound
  unit?: string
  toDisplay?: (mmol: number) => number
  height?: number
  markers?: CgmMarker[]
}

/**
 * 24-hour CGM area chart with target band + hover tooltip. Ported from
 * prototype-src/06-charts.jsx::CGMChart, minus the meal/event markers
 * (not in Slice 7.1 scope).
 */
export function CGMChart({
  data,
  lo = 3.9,
  hi = 10.0,
  unit = 'mmol/L',
  toDisplay = (v) => v,
  height = 240,
  markers,
}: Props) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const [hoverMk, setHoverMk] = useState<number | null>(null)
  const gid = 'cgm' + useId().replace(/:/g, '')

  // Hoisted above the empty-data guard below — every hook (incl. useCallback)
  // must run unconditionally on every render, in the same order, regardless
  // of `data.length`. `width`/`m`/`iw`/`n` are plain derived values (not
  // hooks) needed by `onMove`'s dependency array, so they move up with it;
  // everything else that only the non-empty render path needs stays below.
  const width = w || 700
  const m = { top: 14, right: 14, bottom: 26, left: 40 }
  const iw = Math.max(10, width - m.left - m.right)
  const n = data.length

  const onMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = e.clientX - rect.left - m.left
      const idx = Math.round(clampN((x / iw) * (n - 1), 0, n - 1))
      setHover(idx)
    },
    [iw, n, m.left]
  )

  if (data.length === 0) {
    return (
      <div ref={ref} style={{ position: 'relative', width: '100%' }}>
        <div className="empty-note">No CGM readings in the last 24 hours</div>
      </div>
    )
  }

  const ih = height - m.top - m.bottom

  const vals = data.map((d) => d.value)
  let dLo = Math.min(...vals, lo)
  let dHi = Math.max(...vals, hi)
  dLo = Math.floor(dLo - 0.6)
  dHi = Math.ceil(dHi + 0.6)

  const xOf = (i: number) => m.left + (i / Math.max(1, n - 1)) * iw
  const yOf = (v: number) => m.top + ih - ((v - dLo) / (dHi - dLo)) * ih
  const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.value) }))

  const xticks: number[] = []
  for (let i = 0; i < n; i++) {
    const t = data[i].time
    if (t.getMinutes() === 0 && t.getHours() % 4 === 0) xticks.push(i)
  }

  const yticks: number[] = []
  const yStep = dHi - dLo <= 8 ? 2 : 3
  for (let v = dLo; v <= dHi; v += yStep) yticks.push(v)

  // Map markers (by timestamp) to an x position + the CGM value at that time.
  // Out-of-window markers drop out — the panel filters before passing, but we
  // double-check here. Fingerstick markers carry their OWN reading; the CGM
  // value is still captured (in `val`) so the tooltip can show both side by side.
  const t0 = data[0].time.getTime()
  const tN = data[n - 1].time.getTime()
  const mks = (markers ?? [])
    .map((mm) => {
      const tt = mm.time.getTime()
      if (tt < t0 || tt > tN) return null
      const frac = clampN((tt - t0) / (tN - t0), 0, 1)
      const di = Math.round(frac * (n - 1))
      return { ...mm, x: xOf(di), gy: yOf(data[di].value), val: data[di].value }
    })
    .filter((mm): mm is NonNullable<typeof mm> => mm !== null)

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--purple)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--purple)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* target band */}
        <rect
          x={m.left}
          y={yOf(hi)}
          width={iw}
          height={Math.max(0, yOf(lo) - yOf(hi))}
          fill="var(--teal)"
          opacity={0.1}
        />
        <line x1={m.left} y1={yOf(hi)} x2={m.left + iw} y2={yOf(hi)}
          stroke="var(--teal)" strokeWidth={1} strokeDasharray="4 4" opacity={0.45} />
        <line x1={m.left} y1={yOf(lo)} x2={m.left + iw} y2={yOf(lo)}
          stroke="var(--teal)" strokeWidth={1} strokeDasharray="4 4" opacity={0.45} />
        {/* y grid + labels */}
        {yticks.map((t, i) => (
          <g key={'y' + i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={m.left - 8} y={yOf(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--text-dim)">
              {toDisplay(t)}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xticks.map((i) => (
          <text key={'x' + i} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-dim)">
            {data[i].time.toLocaleTimeString([], { hour: 'numeric', timeZone: 'Asia/Dubai' })}
          </text>
        ))}
        {/* area + line */}
        <path
          d={`${smoothPath(pts)} L${pts[n - 1].x} ${m.top + ih} L${pts[0].x} ${m.top + ih} Z`}
          fill={`url(#${gid})`}
          stroke="none"
        />
        <path d={smoothPath(pts)} fill="none" stroke="var(--purple)" strokeWidth={2.2}
          strokeLinecap="round" strokeLinejoin="round" />
        {/* event markers — branch on kind:
            - symptom / note  → top-of-chart pin + dot snapped to the CGM curve
            - fingerstick     → value-anchored diamond at the meter's OWN reading
                                (NOT snapped to the curve, so meter-vs-sensor
                                agreement is visible at a glance) */}
        {mks.map((mm, i) => {
          const active = hoverMk === i
          if (mm.kind === 'fingerstick' && mm.value !== undefined) {
            // Diamond glyph at yOf(meter value). Distinct teal — separates it
            // visually from the purple CGM line + amber/grey symptom pins.
            const my = yOf(mm.value)
            const r = active ? 6 : 5
            return (
              <g
                key={mm.id}
                onMouseEnter={() => setHoverMk(i)}
                onMouseLeave={() => setHoverMk(null)}
                style={{ cursor: 'default' }}
              >
                {/* invisible larger hit target */}
                <circle cx={mm.x} cy={my} r={9} fill="transparent" />
                {/* diamond — rotate a square 45° */}
                <rect
                  x={mm.x - r} y={my - r} width={r * 2} height={r * 2}
                  transform={`rotate(45 ${mm.x} ${my})`}
                  fill="var(--surface)"
                  stroke="var(--teal)"
                  strokeWidth={2}
                  opacity={active ? 1 : 0.9}
                />
              </g>
            )
          }
          if (mm.kind === 'meal') {
            // Meal markers: amber circle at the TOP of the chart (time-
            // anchored, like symptoms/notes — meals are events). Radius
            // scales with carb load (~ sqrt(carbs/40)) so a heavy meal
            // visibly stands out; a 'C' label sits inside. Snap-dot on
            // the CGM curve at the meal time so the post-meal trajectory
            // is easy to track.
            const carbs = mm.carbs ?? 0
            const baseR = active ? 11 : 9
            const scale = Math.max(0.7, Math.min(1.6, Math.sqrt(Math.max(carbs, 0) / 40)))
            const r = baseR * scale
            return (
              <g
                key={mm.id}
                onMouseEnter={() => setHoverMk(i)}
                onMouseLeave={() => setHoverMk(null)}
                style={{ cursor: 'default' }}
              >
                <line
                  x1={mm.x} y1={m.top} x2={mm.x} y2={m.top + ih}
                  stroke="var(--amber)" strokeWidth={1} strokeDasharray="3 3"
                  opacity={active ? 0.7 : 0.3}
                />
                <circle cx={mm.x} cy={m.top} r={r + 2} fill="var(--surface)" stroke="var(--amber)" strokeWidth={1.5} />
                <circle cx={mm.x} cy={m.top} r={r * 0.6} fill="var(--amber)" />
                <text
                  x={mm.x} y={m.top + 3} fontSize="9.5" fontWeight={700}
                  fill="var(--surface)" textAnchor="middle"
                >C</text>
                <circle cx={mm.x} cy={mm.gy} r={3} fill="var(--amber)" stroke="var(--surface)" strokeWidth={1.5} />
              </g>
            )
          }
          // symptom / note — existing time-anchored pin + curve-snapped dot.
          const col = mm.redFlag ? 'var(--red)' : mm.kind === 'symptom' ? 'var(--amber)' : 'var(--text-muted)'
          return (
            <g
              key={mm.id}
              onMouseEnter={() => setHoverMk(i)}
              onMouseLeave={() => setHoverMk(null)}
              style={{ cursor: 'default' }}
            >
              <line
                x1={mm.x} y1={m.top} x2={mm.x} y2={m.top + ih}
                stroke={col}
                strokeWidth={mm.redFlag ? 1.4 : 1}
                strokeDasharray="3 3"
                opacity={active ? 0.85 : 0.4}
              />
              <circle cx={mm.x} cy={m.top} r={active ? 11 : 9} fill="var(--surface)" stroke={col} strokeWidth={1.5} />
              {mm.redFlag ? (
                <path d="M0 4 L5 -5 L-5 -5 Z" transform={`translate(${mm.x} ${m.top + 1})`} fill={col} />
              ) : (
                <circle cx={mm.x} cy={m.top} r={3.2} fill={col} />
              )}
              <circle cx={mm.x} cy={mm.gy} r={3} fill={col} stroke="var(--surface)" strokeWidth={1.5} />
            </g>
          )
        })}
        {/* hover guide */}
        {hover !== null && (
          <g>
            <line x1={xOf(hover)} y1={m.top} x2={xOf(hover)} y2={m.top + ih}
              stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6} />
            <circle cx={xOf(hover)} cy={yOf(data[hover].value)} r={4}
              fill="var(--surface)" stroke="var(--purple)" strokeWidth={2.4} />
          </g>
        )}
      </svg>
      {hover !== null && (
        <Tooltip
          x={xOf(hover)}
          width={width}
          title={fmtTime(data[hover].time)}
          rows={[
            { color: 'var(--purple)', label: 'Glucose', value: `${toDisplay(data[hover].value)} ${unit}` },
          ]}
        />
      )}
      {hoverMk !== null && mks[hoverMk] && (() => {
        const mm = mks[hoverMk]
        if (mm.kind === 'meal') {
          const rows: { color: string; label: string; value: string }[] = [
            { color: 'var(--amber)', label: mm.label, value: mm.carbs !== undefined ? `${Math.round(mm.carbs)} g carbs` : '' },
            { color: 'var(--purple)', label: 'CGM at time', value: `${toDisplay(mm.val)} ${unit}` },
          ]
          if (mm.detail) rows.push({ color: 'transparent', label: mm.detail, value: '' })
          return <Tooltip x={mm.x} width={width} title={fmtTime(mm.time)} rows={rows} />
        }
        if (mm.kind === 'fingerstick' && mm.value !== undefined) {
          // Meter value first; CGM value at that time second so agreement is
          // glanceable; meal marker / source as the trailing detail line.
          const rows = [
            { color: 'var(--teal)',       label: 'Meter',     value: `${toDisplay(mm.value)} ${unit}` },
            { color: 'var(--purple)',     label: 'CGM',       value: `${toDisplay(mm.val)} ${unit}` },
          ]
          if (mm.detail) rows.push({ color: 'transparent', label: mm.detail, value: '' })
          return <Tooltip x={mm.x} width={width} title={fmtTime(mm.time)} rows={rows} />
        }
        const col = mm.redFlag ? 'var(--red)' : mm.kind === 'symptom' ? 'var(--amber)' : 'var(--text-muted)'
        const rows = [
          { color: col, label: mm.label, value: `${toDisplay(mm.val)} ${unit}` },
        ]
        if (mm.detail) rows.push({ color: 'transparent', label: mm.detail, value: '' })
        return <Tooltip x={mm.x} width={width} title={fmtTime(mm.time)} rows={rows} />
      })()}
    </div>
  )
}
