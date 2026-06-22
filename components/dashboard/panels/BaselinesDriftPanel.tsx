'use client'

import Link from 'next/link'
import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  Info,
  Pause,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Watch,
  Wind,
} from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { useMeasure } from '../charts/useMeasure'
import { DRIFT_METRICS } from '../drift-config'
import { LOW_FLOOR_PROVISIONAL_NOTE } from '../thresholds'
import { evaluateMetric } from '../drift/evaluate'
import {
  buildDriftPanelData,
  type DesignSignal,
  type DesignState,
  type DriftPanelData,
} from '../drift/present'
import { excludeTodayAction } from '@/app/baselines/actions'
import type { BaselinesPayload, MetricDriftRow } from '@/app/lib/dashboard/baselines'

interface Props {
  payload: BaselinesPayload
}

// ─── State vocabulary (renamed jargon — design constant) ──────────────────

const STATE_META: Record<DesignState, { word: string; color: string }> = {
  safety:      { word: 'Below a safe line', color: 'var(--red)' },
  drift:       { word: 'Worth a look',      color: 'var(--amber)' },
  improvement: { word: 'An improvement',    color: 'var(--teal)' },
  steady:      { word: 'Steady',            color: 'var(--text-muted)' },
  settling:    { word: 'Still settling in', color: 'var(--text-dim)' },
  nodata:      { word: 'No recent data',    color: 'var(--text-dim)' },
}

function daysAgoWord(n: number | null): string {
  if (n === null) return 'a while ago'
  if (n <= 0) return 'today'
  if (n === 1) return 'yesterday'
  return `${n} days ago`
}

// ─── BandSpark — line over personal-normal band (custom SVG) ──────────────

function dSmooth(pts: { x: number; y: number }[]): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y}`
  let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1]
    const t = 0.2
    const c1x = p1.x + (p2.x - p0.x) * t
    const c1y = p1.y + (p2.y - p0.y) * t
    const c2x = p2.x - (p3.x - p1.x) * t
    const c2y = p2.y - (p3.y - p1.y) * t
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`
  }
  return d
}

function BandSpark({ sig, height = 80 }: { sig: DesignSignal; height?: number }) {
  const [ref, w] = useMeasure()
  const width = w || 520
  const m = { top: 10, right: 12, bottom: 10, left: 12 }
  const iw = Math.max(10, width - m.left - m.right)
  const ih = height - m.top - m.bottom
  const { lo, hi, concern, state, series, windowDays } = sig
  const n = series.length
  if (n === 0 || lo === null || hi === null) {
    return <div ref={ref} style={{ width: '100%', height }} />
  }
  const present = series
    .map((p, i) => ({ i, v: p.v }))
    .filter((p): p is { i: number; v: number } => p.v !== null)
  const vals = present.map((p) => p.v)
  let dLo = Math.min(lo, ...(vals.length ? vals : [lo]))
  let dHi = Math.max(hi, ...(vals.length ? vals : [hi]))
  const pad = (dHi - dLo) * 0.18 || 1
  dLo -= pad
  dHi += pad
  const xOf = (i: number) => m.left + (i / Math.max(1, n - 1)) * iw
  const yOf = (v: number) => m.top + ih - ((v - dLo) / (dHi - dLo)) * ih
  const pts = present.map((p) => ({ x: xOf(p.i), y: yOf(p.v) }))

  const concernUp = concern === 'up'
  const good = state === 'improvement'
  const beyond = (v: number): boolean =>
    good ? (concernUp ? v < lo : v > hi) : (concernUp ? v > hi : v < lo)
  const accent = STATE_META[state].color
  const recentStart = n - windowDays

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
        {/* personal-normal band */}
        <rect
          x={m.left}
          y={yOf(hi)}
          width={iw}
          height={Math.max(0, yOf(lo) - yOf(hi))}
          fill="var(--text-muted)"
          opacity="0.10"
          rx="3"
        />
        <line x1={m.left} y1={yOf(hi)} x2={m.left + iw} y2={yOf(hi)} stroke="var(--text-dim)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />
        <line x1={m.left} y1={yOf(lo)} x2={m.left + iw} y2={yOf(lo)} stroke="var(--text-dim)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5" />
        <text x={m.left + 2} y={yOf(hi) - 4} fontSize="9.5" fill="var(--text-dim)" opacity="0.85">
          your normal
        </text>
        {/* line — null gaps are dropped at filter time */}
        <path
          d={dSmooth(pts)}
          fill="none"
          stroke={state === 'steady' ? 'var(--text-muted)' : accent}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={state === 'steady' ? 0.85 : 1}
        />
        {/* recent out-of-band emphasis */}
        {present
          .filter((p) => p.i >= recentStart && beyond(p.v))
          .map((p, k) => (
            <circle key={k} cx={xOf(p.i)} cy={yOf(p.v)} r="2.6" fill={accent} />
          ))}
        {/* today endpoint */}
        {pts.length > 0 && (
          <circle
            cx={pts[pts.length - 1].x}
            cy={pts[pts.length - 1].y}
            r="3.4"
            fill={state === 'steady' ? 'var(--text-muted)' : accent}
            stroke="var(--surface)"
            strokeWidth="1.5"
          />
        )}
      </svg>
    </div>
  )
}

// ─── SignalDetail — plain-language depth-on-demand ────────────────────────

function SignalDetail({ sig }: { sig: DesignSignal }) {
  const rows: [string, string][] = []
  if (sig.lo !== null && sig.hi !== null) {
    rows.push(['Your normal', `${sig.fmt(sig.lo)}–${sig.fmt(sig.hi)} ${sig.unit}`])
  }
  if (sig.rMed !== null) {
    const last2 =
      sig.state === 'steady' || sig.state === 'settling' || sig.state === 'nodata'
        ? `around ${sig.fmt(sig.rMed)} ${sig.unit}`
        : sig.magWord && sig.dirWord
          ? `around ${sig.fmt(sig.rMed)} ${sig.unit} — ${sig.magWord} ${sig.dirWord}`
          : `around ${sig.fmt(sig.rMed)} ${sig.unit}`
    rows.push(['Last 2 weeks', last2])
  }
  if (sig.total14 > 0 || sig.state !== 'nodata') {
    const morningLike = sig.unit === 'mmHg' || sig.unit === 'bpm'
    const unitWord = morningLike ? 'mornings' : 'readings'
    const days = sig.state === 'improvement' ? sig.goodSideDays : sig.concernSideDays
    const side = sig.dirWord ?? 'higher'
    const value =
      sig.state === 'steady' || sig.state === 'settling'
        ? 'mostly within your normal'
        : sig.state === 'nodata'
          ? '—'
          : `${days} of the last ${sig.total14} ${unitWord} ${side} than usual`
    rows.push(['Pattern', value])
  }
  const confidence =
    sig.totalData >= 22
      ? `${sig.totalData} readings over 4 weeks — solid`
      : `${sig.totalData} readings — still building`
  rows.push(['Confidence', confidence])

  return (
    <div className="sig-detail">
      <div className="sig-stats">
        {rows.map(([k, v], i) => (
          <div className="sig-stat" key={i}>
            <span className="sig-stat-k">{k}</span>
            <span className="sig-stat-v">{v}</span>
          </div>
        ))}
      </div>
      <p className="sig-foot">
        Compared against your own recent history — not population averages. A pattern to notice, not a diagnosis.
      </p>
    </div>
  )
}

// ─── SignalCard — prominent card (drift / improvement / safety) ───────────

function SignalCard({ sig, tier }: { sig: DesignSignal; tier: 'hero' | 'med' }) {
  const [open, setOpen] = useState(false)
  const meta = STATE_META[sig.state]
  const ArrowI = sig.dirWord === 'lower' ? TrendingDown : TrendingUp
  return (
    <div
      className={`sig-card ${tier}`}
      style={{ ['--accent' as keyof React.CSSProperties as string]: meta.color } as React.CSSProperties}
    >
      <div className="sig-card-head">
        <div className="sig-card-id">
          <span className="sig-name">{sig.label}</span>
          <span className="sig-source">{sig.source}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, justifyContent: 'flex-end' }}>
          <span
            className="sig-pill"
            style={{
              color: meta.color,
              borderColor: `color-mix(in srgb, ${meta.color} 38%, transparent)`,
            }}
          >
            {sig.state === 'safety' ? <AlertTriangle size={13} /> : <ArrowI size={13} />}
            {meta.word}
          </span>
          {sig.early && (
            <span className="sig-pill-early">
              <Sparkles size={11} /> early — not yet confirmed
            </span>
          )}
        </div>
      </div>
      <p className="sig-lead">{sig.lead}</p>
      <div className="sig-now">
        <span className="sig-now-val" style={{ color: meta.color }}>
          {sig.fmt(sig.latest)}
          <span className="sig-now-unit">{sig.unit}</span>
        </span>
        <span className="sig-now-cap">
          latest · normal {sig.fmt(sig.lo)}–{sig.fmt(sig.hi)}
        </span>
      </div>
      <BandSpark sig={sig} height={tier === 'hero' ? 86 : 70} />
      <button className="sig-expand" onClick={() => setOpen(!open)}>
        <ChevronDown
          size={14}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}
        />
        {open ? 'Hide the numbers' : 'See the numbers'}
      </button>
      {open && <SignalDetail sig={sig} />}
    </div>
  )
}

// ─── SteadyTier — chips + click-to-expand detail ──────────────────────────

function SteadyTier({ signals }: { signals: DesignSignal[] }) {
  const [sel, setSel] = useState<string | null>(null)
  const cur = signals.find((s) => s.id === sel) ?? null
  return (
    <div className="steady-tier">
      <div className="tier-label">
        <span className="tier-dot" style={{ background: 'var(--teal)' }} />
        Steady · {signals.length} holding at your normal
      </div>
      <div className="steady-chips">
        {signals.map((s) => (
          <button
            key={s.id}
            className={`steady-chip ${sel === s.id ? 'active' : ''}`}
            onClick={() => setSel(sel === s.id ? null : s.id)}
          >
            <Check size={12} strokeWidth={3} />
            <span>{s.short}</span>
            <span className="steady-chip-v">
              {s.fmt(s.latest)}
              <i>{s.unit}</i>
            </span>
            {s.paused && (
              <span className="sig-paused">
                <Pause size={11} /> paused
              </span>
            )}
          </button>
        ))}
      </div>
      {cur && (
        <div className="steady-detail">
          <div className="steady-detail-head">{cur.label}</div>
          <SignalDetail sig={cur} />
        </div>
      )}
    </div>
  )
}

// ─── MutedTier — settling + nodata, dashed chips ──────────────────────────

function MutedTier({
  settling,
  nodata,
}: {
  settling: DesignSignal[]
  nodata: DesignSignal[]
}) {
  return (
    <div className="muted-tier">
      <div className="tier-label">
        <span className="tier-dot" style={{ background: 'var(--text-dim)' }} />
        Not reading yet
      </div>
      <div className="muted-chips">
        {settling.map((s) => (
          <div key={s.id} className="muted-chip">
            <Watch size={14} />
            <div>
              <span className="muted-chip-name">{s.short}</span>
              <span className="muted-chip-note">
                Still settling in — only {s.dataNights} {s.dataNights === 1 ? 'reading' : 'readings'} so far, learning your normal.
              </span>
            </div>
          </div>
        ))}
        {nodata.map((s) => (
          <div key={s.id} className="muted-chip">
            <Wind size={14} />
            <div>
              <span className="muted-chip-name">{s.short}</span>
              <span className="muted-chip-note">
                No recent data — last reading {daysAgoWord(s.lastSeen)}. Sensor may be off.
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── DriftPanel (exported as BaselinesDriftPanel for back-compat) ─────────

function DriftPanel({ data, anchor }: { data: DriftPanelData; anchor: BaselinesPayload['anchor'] }) {
  const toneColor =
    data.tone === 'safety' ? 'var(--red)' : data.tone === 'attention' ? 'var(--amber)' : 'var(--teal)'

  return (
    <Card className="col-12 drift-panel">
      <PanelHeader
        icon={<Activity size={18} />}
        title="Baselines & drift"
        accent="var(--teal)"
        right={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <ExcludeTodayButton />
            <span className="drift-mode">
              <Sparkles size={13} /> Learning your normal · 4-week window
            </span>
          </div>
        }
      />

      {/* overall read */}
      <div className={`overall-read tone-${data.tone}`}>
        <div
          className="overall-mark"
          style={{
            color: toneColor,
            borderColor: `color-mix(in srgb, ${toneColor} 40%, transparent)`,
          }}
        >
          {data.tone === 'calm' ? (
            <Check size={22} strokeWidth={2.6} />
          ) : data.tone === 'safety' ? (
            <AlertTriangle size={20} />
          ) : (
            <Activity size={20} />
          )}
        </div>
        <div className="overall-txt">
          <h3 className="overall-title">{data.title}</h3>
          <p className="overall-body">{data.body}</p>
        </div>
      </div>

      {/* tiers — strict precedence */}
      {data.safety.length > 0 && (
        <div className="tier">
          <div className="tier-label">
            <span className="tier-dot" style={{ background: 'var(--red)' }} />
            Below a safe line
          </div>
          <div className="card-row">
            {data.safety.map((s) => (
              <SignalCard key={s.id} sig={s} tier="hero" />
            ))}
          </div>
        </div>
      )}

      {data.drift.length > 0 && (
        <div className="tier">
          <div className="tier-label">
            <span className="tier-dot" style={{ background: 'var(--amber)' }} />
            Worth a look
          </div>
          <div className="card-row">
            {data.drift.map((s) => (
              <SignalCard key={s.id} sig={s} tier="hero" />
            ))}
          </div>
        </div>
      )}

      {data.improvement.length > 0 && (
        <div className="tier">
          <div className="tier-label">
            <span className="tier-dot" style={{ background: 'var(--teal)' }} />
            Going the right way
          </div>
          <div className="card-row improvements">
            {data.improvement.map((s) => (
              <SignalCard key={s.id} sig={s} tier="med" />
            ))}
          </div>
        </div>
      )}

      {data.steady.length > 0 && (
        <div className="tier">
          <SteadyTier signals={data.steady} />
        </div>
      )}

      {(data.settling.length > 0 || data.nodata.length > 0) && (
        <div className="tier">
          <MutedTier settling={data.settling} nodata={data.nodata} />
        </div>
      )}

      {/* footnote — anchor note (if not set) + provisional-floors + acute-path */}
      <div className="drift-footnote">
        <Info size={13} />
        <span>
          {anchor ? (
            <>
              Comparing against your anchor baseline (set from {anchor.source_start} → {anchor.source_end}) and your last 4 weeks.{' '}
            </>
          ) : (
            <>
              You haven&rsquo;t locked in a healthy baseline yet. Once you&rsquo;re through cardiac rehab and your medications have settled, you can <Link href="/baselines">set a fixed &ldquo;this is my good normal&rdquo;</Link> to compare against. For now this learns from your last few weeks.{' '}
            </>
          )}
          <b>Not medical advice</b> — bring anything notable to Dr. Jose. Acute symptoms still go through the Quick log red-flag route. {LOW_FLOOR_PROVISIONAL_NOTE}
        </span>
      </div>
    </Card>
  )
}

// ─── Outer panel — converts BaselinesPayload → DriftPanelData ─────────────

export function BaselinesDriftPanel({ payload }: Props) {
  const data = useMemo<DriftPanelData>(() => {
    const verdicts = DRIFT_METRICS.map((m) =>
      evaluateMetric(m, payload.drift[m] ?? [], {
        anchor: payload.anchor,
        contextToday: payload.context,
        medChanges: payload.medChanges,
      })
    )
    return buildDriftPanelData(verdicts, payload.drift)
  }, [payload])

  return <DriftPanel data={data} anchor={payload.anchor} />
}

// ─── "Exclude today" quick action ──────────────────────────────────────────

function ExcludeTodayButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function onClick() {
    if (
      !window.confirm(
        "Exclude today's reading from baselines? You can still see it on the dashboard; it just won't shift your normal."
      )
    ) {
      return
    }
    startTransition(async () => {
      const res = await excludeTodayAction()
      if (res.ok) {
        setDone(true)
        setTimeout(() => setDone(false), 1800)
        router.refresh()
      } else {
        window.alert(res.error ?? 'Failed to exclude today.')
      }
    })
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="chip"
      style={{ cursor: pending ? 'wait' : 'pointer' }}
    >
      {done ? '✓ Excluded today' : pending ? 'Saving…' : 'Exclude today'}
    </button>
  )
}

// `MetricDriftRow` re-export kept for any caller that imports it from the
// panel module (preserved from the previous panel's surface).
export type { MetricDriftRow }
