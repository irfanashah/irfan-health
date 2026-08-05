'use client'

import { useCallback, useId, useState } from 'react'
import { useMeasure } from './useMeasure'
import { clampN, fmtTime, smoothPath } from './chart-utils'
import { Tooltip } from './Tooltip'
import type { Spo2CurvePoint, Spo2DesatEvent } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  data: Spo2CurvePoint[]
  /** Detected 3% desaturation events — markers plotted at true (t, nadir). */
  events?: Spo2DesatEvent[]
  /** SpO2 floor for the reference line (display only). Default 90. */
  referenceLine?: number
  /** Shaded "normal" band lo/hi (display only). Default 95–100. */
  bandLo?: number
  bandHi?: number
  height?: number
}

/**
 * Overnight SpO2 trace. Adapted from CGMChart — same time-x-axis + shaded-band
 * pattern, but null-aware (sensor-off gaps break the line cleanly, gotcha #34)
 * and tuned for SpO2 (fixed y-domain, teal palette, 90% reference line). One
 * row per night drives this; no pagination, no 1000-row cap.
 */
export function Spo2OvernightChart({
  data,
  events = [],
  referenceLine = 90,
  bandLo = 95,
  bandHi = 100,
  height = 216,
}: Props) {
  const [ref, w] = useMeasure()
  const [hover, setHover] = useState<number | null>(null)
  const [hoverEv, setHoverEv] = useState<number | null>(null)
  const gid = 'spo2' + useId().replace(/:/g, '')

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
        <div className="empty-note">No overnight oxygen data</div>
      </div>
    )
  }

  const ih = height - m.top - m.bottom

  // Fixed y-domain that always shows the desaturation floor + the normal band.
  // SpO2 ≥ 100 is impossible by definition; 80 is a generous lower floor that
  // still puts severe nadirs visibly on-chart without compressing the band.
  const dLo = 80
  const dHi = 100

  const xOf = (i: number) => m.left + (i / Math.max(1, n - 1)) * iw
  const yOf = (v: number) => m.top + ih - ((v - dLo) / (dHi - dLo)) * ih

  // Build contiguous runs of non-null points — each run renders as its own
  // path, so a sensor-off gap breaks the line cleanly (no fake zero traversal).
  const runs: { x: number; y: number }[][] = []
  let current: { x: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const v = data[i].value
    if (v === null) {
      if (current.length > 0) {
        runs.push(current)
        current = []
      }
      continue
    }
    current.push({ x: xOf(i), y: yOf(v) })
  }
  if (current.length > 0) runs.push(current)

  // x-axis ticks — even-hour boundaries inside the session.
  const xticks: number[] = []
  for (let i = 0; i < n; i++) {
    const t = data[i].time
    if (t.getMinutes() === 0 && t.getHours() % 1 === 0 && i % Math.max(1, Math.floor(n / 6)) === 0) {
      xticks.push(i)
    }
  }
  // Fallback: if the modulo dropped everything (very short session), at least
  // bookend with first + last.
  if (xticks.length === 0) {
    xticks.push(0, n - 1)
  }

  const yticks = [80, 85, 90, 95, 100]

  // ─── Desaturation event markers ──────────────────────────────────────
  // Position each marker at the event's TRUE timestamp (interpolated
  // linearly between curve sample times) and TRUE nadir SpO2 (the actual
  // depth at full ~4 s resolution). The display curve's 20 s downsampling
  // never compromises the marker — markers come straight from the parser's
  // event detection, not from the rendered line.
  const t0 = data[0].time.getTime()
  const tN = data[n - 1].time.getTime()
  const span = Math.max(1, tN - t0)
  const eventMarks = events
    .map((ev) => {
      const tt = ev.time.getTime()
      if (tt < t0 || tt > tN) return null
      const frac = clampN((tt - t0) / span, 0, 1)
      const x = m.left + frac * iw
      // Clamp nadir into the visible y-domain so a sub-80 reading still
      // lands on-chart (depth still shown in the tooltip).
      const ny = clampN(ev.nadirSpo2, dLo, dHi)
      const y = yOf(ny)
      return { ev, x, y }
    })
    .filter((m): m is { ev: Spo2DesatEvent; x: number; y: number } => m !== null)

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
            <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--teal)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* normal band (≥95) */}
        <rect
          x={m.left}
          y={yOf(bandHi)}
          width={iw}
          height={Math.max(0, yOf(bandLo) - yOf(bandHi))}
          fill="var(--teal)"
          opacity={0.1}
        />
        <line
          x1={m.left} y1={yOf(bandLo)} x2={m.left + iw} y2={yOf(bandLo)}
          stroke="var(--teal)" strokeWidth={1} strokeDasharray="4 4" opacity={0.45}
        />
        {/* 90% reference line — the desaturation floor */}
        <line
          x1={m.left} y1={yOf(referenceLine)} x2={m.left + iw} y2={yOf(referenceLine)}
          stroke="var(--amber)" strokeWidth={1.3} strokeDasharray="5 3" opacity={0.55}
        />
        <text
          x={m.left + iw - 4} y={yOf(referenceLine) - 4} textAnchor="end"
          fontSize="10" fill="var(--amber)" opacity={0.75}
        >
          90%
        </text>
        {/* y grid + labels */}
        {yticks.map((t) => (
          <g key={'y' + t}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth={1} />
            <text x={m.left - 8} y={yOf(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--text-dim)">
              {t}
            </text>
          </g>
        ))}
        {/* x labels */}
        {xticks.map((i) => (
          <text key={'x' + i} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-dim)">
            {data[i].time.toLocaleTimeString([], { hour: 'numeric', timeZone: 'Asia/Dubai' })}
          </text>
        ))}
        {/* area + line — per contiguous run, so gaps don't connect across */}
        {runs.map((run, ri) => (
          <g key={'run' + ri}>
            {run.length > 1 && (
              <path
                d={`${smoothPath(run)} L${run[run.length - 1].x} ${m.top + ih} L${run[0].x} ${m.top + ih} Z`}
                fill={`url(#${gid})`}
                stroke="none"
              />
            )}
            <path
              d={smoothPath(run)} fill="none" stroke="var(--teal)" strokeWidth={2.2}
              strokeLinecap="round" strokeLinejoin="round"
            />
          </g>
        ))}
        {/* desaturation event markers at TRUE (t, nadir). 4% events get a
            slightly bigger dot; small enough to stay calm on a heavy-event
            night. */}
        {eventMarks.map((mk, i) => {
          const active = hoverEv === i
          const r = mk.ev.also4Pct ? 4 : 3
          return (
            <g
              key={'ev' + i}
              onMouseEnter={() => setHoverEv(i)}
              onMouseLeave={() => setHoverEv(null)}
              style={{ cursor: 'default' }}
            >
              {/* invisible larger hit target so a 3 px dot is still hoverable */}
              <circle cx={mk.x} cy={mk.y} r={8} fill="transparent" />
              <circle
                cx={mk.x} cy={mk.y}
                r={active ? r + 2 : r}
                fill="var(--red)"
                stroke="var(--surface)"
                strokeWidth={1.2}
                opacity={active ? 1 : 0.75}
              />
            </g>
          )
        })}
        {/* hover guide — only when hovering a non-null sample */}
        {hover !== null && data[hover].value !== null && (
          <g>
            <line
              x1={xOf(hover)} y1={m.top} x2={xOf(hover)} y2={m.top + ih}
              stroke="var(--text-dim)" strokeWidth={1} strokeDasharray="3 3" opacity={0.6}
            />
            <circle
              cx={xOf(hover)} cy={yOf(data[hover].value as number)} r={4}
              fill="var(--surface)" stroke="var(--teal)" strokeWidth={2.4}
            />
          </g>
        )}
      </svg>
      {hover !== null && data[hover].value !== null && (
        <Tooltip
          x={xOf(hover)}
          width={width}
          title={fmtTime(data[hover].time)}
          rows={[{ color: 'var(--teal)', label: 'SpO2', value: `${data[hover].value}%` }]}
        />
      )}
      {hoverEv !== null && eventMarks[hoverEv] && (() => {
        const mk = eventMarks[hoverEv]
        return (
          <Tooltip
            x={mk.x}
            width={width}
            title={`Desaturation · ${fmtTime(mk.ev.time)}`}
            rows={[
              { color: 'var(--red)', label: 'Nadir', value: `${mk.ev.nadirSpo2}%` },
              { color: 'var(--text-muted)', label: 'Drop', value: `${mk.ev.dropPct.toFixed(1)} pp${mk.ev.also4Pct ? ' · ≥4%' : ''}` },
            ]}
          />
        )
      })()}
    </div>
  )
}
