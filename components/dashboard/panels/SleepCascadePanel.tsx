'use client'

import { ArrowRight, Activity, Droplet, HeartPulse, Info, Moon } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import { SourceBadge } from '../ui/SourceBadge'
import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

interface Props {
  series: DailyMetricRow[]      // already range-sliced
}

interface CascadeRow {
  icon: React.ReactNode
  label: string
  value: string
  unit?: string
  color: string
  head?: boolean
  rel?: string
}

const SHORT_SLEEP_THRESHOLD_HOURS = 6.5

export function SleepCascadePanel({ series }: Props) {
  // "Today" = the most recent day with a sleep total recorded (Whoop's
  // period_end attribution means today's row has last night's sleep once
  // Whoop scored it, even if today's cycle isn't done yet).
  const today = [...series].reverse().find((d) => d.sleep_total !== null) ?? null

  if (!today) {
    return (
      <Card className="col-5">
        <PanelHeader
          icon={<Moon size={18} />}
          title="Sleep → next day"
          accent="var(--purple)"
          right={<SourceBadge source="whoop" />}
        />
        <div className="empty-note">No sleep recorded in this window yet</div>
      </Card>
    )
  }

  const sleepShort = today.sleep_total !== null && today.sleep_total < SHORT_SLEEP_THRESHOLD_HOURS

  // Associational phrasing: "on shorter-sleep days, X tended to run higher",
  // not "short sleep caused X". When a metric isn't recorded we say so plainly.
  const items: CascadeRow[] = [
    {
      icon: <HeartPulse size={16} />,
      label: 'Morning BP',
      value: today.sys !== null && today.dia !== null ? `${today.sys}/${today.dia}` : '—',
      unit: today.sys !== null ? 'mmHg' : undefined,
      color: 'var(--red)',
      head: true,
      rel: today.sys === null
        ? 'No morning BP logged today'
        : sleepShort
          ? 'On shorter-sleep days, morning BP tends to run higher'
          : 'On well-rested days, morning BP tends to sit closer to baseline',
    },
    {
      icon: <Droplet size={16} />,
      label: 'Fasting glucose',
      value: today.fasting !== null ? today.fasting.toFixed(1) : '—',
      unit: today.fasting !== null ? 'mmol/L' : undefined,
      color: 'var(--purple)',
      head: true,
      rel: today.fasting === null
        ? 'No fasting reading today (no early-morning CGM)'
        : sleepShort
          ? 'Linked with higher fasting glucose on shorter-sleep days'
          : 'Tends to stay steady on good-sleep days',
    },
    {
      icon: <Activity size={16} />,
      label: 'Today’s recovery',
      value: today.recovery !== null ? String(Math.round(today.recovery)) : '—',
      unit: today.recovery !== null ? '%' : undefined,
      color: 'var(--purple)',
      head: false,
      rel: today.recovery === null ? 'Not scored yet — Whoop usually finalises by mid-morning' : '',
    },
  ]

  return (
    <Card className="col-5">
      <PanelHeader
        icon={<Moon size={18} />}
        title="Sleep → next day"
        accent="var(--purple)"
        right={<SourceBadge source="whoop" />}
      />
      <div className="cascade-source">
        <div className="cascade-sleep">
          <div className="cascade-sleep-val">
            {today.sleep_total!.toFixed(1)}<span>h</span>
          </div>
          <div className="cascade-sleep-sub">
            {today.sleep_performance !== null
              ? `${Math.round(today.sleep_performance)}% quality · last night`
              : 'last night'}
          </div>
        </div>
        <div className="cascade-arrow"><ArrowRight size={20} /></div>
        <div
          className="cascade-flag"
          style={{ color: sleepShort ? 'var(--amber)' : 'var(--teal)' }}
        >
          {sleepShort ? 'Short night' : 'Well rested'}
        </div>
      </div>
      <div className="cascade-list">
        {items.map((it, i) => (
          <div className={`cascade-item ${it.head ? 'head' : ''}`} key={i}>
            <span className="cascade-ic" style={{ color: it.color }}>{it.icon}</span>
            <span className="cascade-name">{it.label}</span>
            <span className="cascade-val">
              {it.value}
              {it.unit && <span className="cascade-unit"> {it.unit}</span>}
            </span>
            {it.rel && <span className="cascade-rel">{it.rel}</span>}
          </div>
        ))}
      </div>
      <div className="headline-note">
        <Info size={13} />
        <span>
          Sleep’s most visible day-to-day links here are with{' '}
          <b>fasting glucose</b> and <b>morning blood pressure</b> — observed pattern, not a guarantee.
        </span>
      </div>
    </Card>
  )
}
