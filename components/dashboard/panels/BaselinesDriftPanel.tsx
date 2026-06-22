'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, AlertTriangle, ChevronDown, Info, Pause, Sparkles } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { DRIFT_METRICS, type DriftMetricConfig } from '../drift-config'
import { LOW_FLOORS, LOW_FLOOR_PROVISIONAL_NOTE } from '../thresholds'
import { evaluateMetric, type DriftVerdict, type DriftTier, type SufficiencyState } from '../drift/evaluate'
import { excludeTodayAction } from '@/app/baselines/actions'
import type { BaselinesPayload, MetricDriftRow } from '@/app/lib/dashboard/baselines'

interface Props {
  payload: BaselinesPayload
}

const TIER_COLOR: Record<DriftTier, string> = {
  stable: 'var(--text-muted)',
  watch:  'var(--amber)',
  drift:  'var(--red)',
  win:    'var(--teal)',
}

const STATE_PILL: Record<SufficiencyState, { label: string; color: string }> = {
  'no-recent-data': { label: 'No recent data', color: 'var(--text-dim)' },
  'establishing':   { label: 'Establishing',   color: 'var(--text-muted)' },
  'active':         { label: 'Active',         color: 'var(--text-muted)' },
}

function tierWord(tier: DriftTier, state: SufficiencyState): string {
  if (state === 'no-recent-data') return STATE_PILL[state].label
  if (state === 'establishing')   return STATE_PILL[state].label
  if (tier === 'win')    return 'Win'
  if (tier === 'drift')  return 'Drift'
  if (tier === 'watch')  return 'Watch'
  return 'Stable'
}

function fmt(v: number | null | undefined, dp: number): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return Math.abs(v) >= 100 ? Math.round(v).toString() : v.toFixed(dp)
}

function unitDp(unit: string): number {
  return unit === 'mmol/L' ? 1 : 0
}

export function BaselinesDriftPanel({ payload }: Props) {
  const verdicts = useMemo<DriftVerdict[]>(() => {
    return DRIFT_METRICS.map((m) =>
      evaluateMetric(m, payload.drift[m] ?? [], {
        anchor: payload.anchor,
        contextToday: payload.context,
        medChanges: payload.medChanges,
      })
    )
  }, [payload])

  const anyDrift = verdicts.some((v) => v.tier === 'drift')

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Activity size={18} />}
        title="Baselines & Drift"
        accent="var(--teal)"
        right={
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <ExcludeTodayButton />
            <span className="muted-note">Personal-baseline early-warning layer</span>
          </div>
        }
      />

      {payload.anchor ? (
        <div className="muted-note" style={{ marginBottom: 10 }}>
          Anchor set from {payload.anchor.source_start} → {payload.anchor.source_end} ·
          frozen {new Date(payload.anchor.set_at).toLocaleDateString()}.
        </div>
      ) : (
        <div className="muted-note" style={{ marginBottom: 10 }}>
          Anchor not set — establishing your post-rehab reference. Set one via the Baselines page when ready.
        </div>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {verdicts.map((v) => (
          <BaselineRow key={v.metric} verdict={v} />
        ))}
      </ul>

      <div className="headline-note" style={{ marginTop: 14 }}>
        <Info size={13} />
        <span>
          Interpretable signal, not a diagnosis — and not the acute path.
          Acute symptoms still go through the Quick log red-flag route.{' '}
          <b>{LOW_FLOOR_PROVISIONAL_NOTE}</b>
        </span>
      </div>
      {anyDrift && (
        <div className="muted-note" style={{ marginTop: 8 }}>
          Drift callouts are observed patterns over the windows shown — worth mentioning to Dr. Jose, never a verdict on cause.
        </div>
      )}
    </Card>
  )
}

// ─── Row ───────────────────────────────────────────────────────────────────

function BaselineRow({ verdict }: { verdict: DriftVerdict }) {
  const [open, setOpen] = useState(false)
  const cfg = verdict.config
  const tierColor = TIER_COLOR[verdict.tier]
  const stateColor = STATE_PILL[verdict.state].color
  const dp = unitDp(cfg.unit)

  const latestStr = verdict.latest
    ? `${fmt(verdict.latest.today_value, dp)} ${cfg.unit}`
    : '—'

  const word =
    verdict.state === 'active' ? tierWord(verdict.tier, verdict.state) : STATE_PILL[verdict.state].label
  const wordColor = verdict.state === 'active' ? tierColor : stateColor

  return (
    <li
      style={{
        borderTop: '1px solid var(--card-border)',
        padding: '11px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'var(--text)',
            fontWeight: 700,
            fontSize: 13.5,
            flex: '0 0 140px',
            minWidth: 0,
            textAlign: 'left',
          }}
        >
          <ChevronDown
            size={14}
            style={{
              transform: open ? 'rotate(180deg)' : 'none',
              transition: 'transform .15s',
              opacity: 0.6,
            }}
          />
          {cfg.label}
        </button>

        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: wordColor,
            background: `color-mix(in srgb, ${wordColor} 14%, transparent)`,
            border: `1px solid color-mix(in srgb, ${wordColor} 30%, transparent)`,
            borderRadius: 20,
            padding: '3px 10px',
          }}
        >
          {word}
        </span>

        {verdict.alertsSuppressed && verdict.suppressedBy && (
          <span
            className="muted-note"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <Pause size={12} /> suppressed — {verdict.suppressedBy.type}
          </span>
        )}

        {verdict.clinicalLow === 'breach' && (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 11.5,
              fontWeight: 700,
              color: 'var(--red)',
              background: 'color-mix(in srgb, var(--red) 12%, transparent)',
              border: '1px solid color-mix(in srgb, var(--red) 32%, transparent)',
              borderRadius: 20,
              padding: '3px 10px',
            }}
          >
            <AlertTriangle size={12} /> {LOW_FLOORS[cfg.id as 'rhr' | 'sys' | 'dia']?.label ?? 'Below clinical floor'}
          </span>
        )}
        {verdict.clinicalLow === 'caution' && (
          <span className="muted-note" style={{ color: 'var(--amber)' }}>
            approaching low floor
          </span>
        )}

        {verdict.medReset && (
          <span className="muted-note">
            <Sparkles size={12} /> reset since {verdict.medReset.label}, {verdict.medReset.change_date}
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {latestStr}
        </span>
      </div>

      {!verdict.alertsSuppressed && verdict.callout && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 6, marginLeft: 22, lineHeight: 1.45 }}>
          {verdict.callout}
        </p>
      )}

      {open && (
        <div
          style={{
            marginTop: 10,
            marginLeft: 22,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '10px 18px',
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          <DetailRow label="Latest"          value={`${fmt(verdict.latest?.today_value ?? null, dp)} ${cfg.unit}`} />
          <DetailRow label="Today vs 28d z"  value={fmtZ(verdict.latest?.today_z ?? null)} />
          <DetailRow label="Short (7d)"      value={statBlock(verdict.latest?.short_median, verdict.latest?.short_n, cfg)} />
          <DetailRow label="Prior (21d)"     value={statBlock(verdict.latest?.prior_median, verdict.latest?.prior_n, cfg, verdict.latest?.prior_mad)} />
          <DetailRow label="Rolling (28d)"   value={statBlock(verdict.latest?.rolling_median, verdict.latest?.rolling_n, cfg, verdict.latest?.rolling_mad)} />
          <DetailRow label="Baseline used"   value={verdict.baselineUsed ?? '—'} />
          <DetailRow label="Shift"           value={fmtShift(verdict.shiftDelta, verdict.shiftZ, cfg)} />
          <DetailRow label="Held data-days"  value={`${verdict.heldDays} / ${cfg.M}`} />
          <DetailRow label="Acknowledge good drift" value={cfg.acknowledgeGood ? 'yes' : 'no (RHR↓ neutral — beta-blockade)'} />
        </div>
      )}
    </li>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--text-dim)', fontWeight: 600 }}>{label}</div>
      <div style={{ fontWeight: 600, color: 'var(--text)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function statBlock(
  median: number | null | undefined,
  n: number | undefined,
  cfg: DriftMetricConfig,
  mad?: number | null
): string {
  if (median === null || median === undefined || !Number.isFinite(median)) return '—'
  const dp = unitDp(cfg.unit)
  const base = `${fmt(median, dp)} ${cfg.unit}${n !== undefined ? ` · n=${n}` : ''}`
  if (mad !== undefined && mad !== null && Number.isFinite(mad)) {
    return `${base} · MAD ${fmt(mad, dp)}`
  }
  return base
}

function fmtZ(z: number | null): string {
  if (z === null || !Number.isFinite(z)) return '—'
  return `${z >= 0 ? '+' : '−'}${Math.abs(z).toFixed(2)}`
}

function fmtShift(delta: number | null, z: number | null, cfg: DriftMetricConfig): string {
  if (delta === null || !Number.isFinite(delta)) return '—'
  const dp = unitDp(cfg.unit)
  const z_part = z === null ? '' : ` (${fmtZ(z)} MAD)`
  return `${delta >= 0 ? '+' : '−'}${fmt(Math.abs(delta), dp)} ${cfg.unit}${z_part}`
}

// ─── "Exclude today" quick action ──────────────────────────────────────────

function ExcludeTodayButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  function onClick() {
    if (!window.confirm("Exclude today's reading from baselines? You can still see it on the dashboard; it just won't shift your normal.")) {
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

// `MetricDriftRow` re-export so the panel and its callers share a type
// without forcing every consumer to reach into the data module directly.
export type { MetricDriftRow }
