'use client'

import {
  Activity,
  AlertTriangle,
  Droplet,
  HeartPulse,
  NotebookPen,
  Scale,
} from 'lucide-react'
import type { RecentEntry, EntryKind } from '@/app/log/_lib/types'
import { RED_FLAG_REMINDER } from '@/app/log/_lib/symptoms'
import { SeverityDots } from './SeverityDots'

interface Props {
  entries: RecentEntry[]
  /**
   * The client clock. `null` (or omitted) means "clock not mounted yet" —
   * render an ABSOLUTE GST timestamp instead of a relative one (L10). The
   * old fallback `new Date(0)` made every entry read "just now" (a negative
   * diff satisfies the `< 60s` branch) on the server render, first paint,
   * print, and JS-off. Absolute time is always correct without a live clock.
   */
  now?: Date | null
}

const TYPE_COLOR: Record<EntryKind, string> = {
  weight: 'var(--teal)',
  glucose: 'var(--purple)',
  bp: 'var(--teal)',
  symptom: 'var(--amber)',
  note: 'var(--text-muted)',
}

// Absolute GST timestamp — used until the client clock mounts (L10).
function absTime(d: Date): string {
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Dubai' })} · ${time}`
}

function relTime(d: Date, now: Date): string {
  const diff = (now.getTime() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const that = new Date(d)
  that.setHours(0, 0, 0, 0)
  const days = Math.round((today.getTime() - that.getTime()) / 86400000)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dubai' })
  if (days === 0) return `Today · ${time}`
  if (days === 1) return `Yesterday · ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Dubai' })} · ${time}`
}

function isRedFlag(e: RecentEntry): boolean {
  if (e.kind !== 'symptom') return false
  const payload = e.raw as { note?: string | null; symptom_code: string }
  // The Slice 3 symptom payload carries no red_flag flag on RecentEntry's raw
  // shape — derive from the stored extras via the in-app symptom lookup.
  // But fetchRecentManual already resolves the symptom def + label, and
  // RecentEntry.summary embeds severity etc. — for the flag itself we need
  // the symptom definition. Easiest: walk via the entry's symptom_code.
  // (Lazy import to keep this file purely a presentational component.)
  // We'll use a small lookup table here mirroring symptoms.ts red_flag entries.
  const RED_FLAGS = new Set([
    'chest_pain',
    'chest_tightness',
    'dizziness_standing',
    'shortness_of_breath',
  ])
  return RED_FLAGS.has(payload.symptom_code)
}

function iconFor(e: RecentEntry) {
  if (isRedFlag(e)) return <AlertTriangle size={15} />
  switch (e.kind) {
    case 'weight':  return <Scale size={15} />
    case 'glucose': return <Droplet size={15} />
    case 'bp':      return <HeartPulse size={15} />
    case 'symptom': return <Activity size={15} />
    case 'note':    return <NotebookPen size={15} />
  }
}

export function Timeline({ entries, now = null }: Props) {
  if (entries.length === 0) {
    return <div className="empty-note">No manual entries yet — log something via Quick log</div>
  }
  return (
    <div className="timeline">
      {entries.map((e) => {
        const redflag = isRedFlag(e)
        const color = redflag ? 'var(--red)' : TYPE_COLOR[e.kind]
        const occurredAt = new Date(e.occurred_at)
        const rawSym = e.kind === 'symptom' ? (e.raw as { severity: number | null; note: string | null }) : null
        const rawNote = e.kind === 'note' ? (e.raw as { text: string }) : null
        return (
          <div key={`${e.kind}_${e.id}`} className={`tl-item ${redflag ? 'redflag' : ''}`}>
            <span
              className="tl-icon"
              style={{
                color,
                background: `color-mix(in srgb, ${color} 14%, transparent)`,
              }}
            >
              {iconFor(e)}
            </span>
            <div className="tl-body">
              <div className="tl-row1">
                <span className="tl-label">{e.summary.split(' · ')[0]}</span>
                {e.kind !== 'symptom' && e.kind !== 'note' && (
                  <span className="tl-value">{e.summary}</span>
                )}
                {rawSym && rawSym.severity !== null && (
                  <SeverityDots n={rawSym.severity} />
                )}
                <span className="tl-time">{now ? relTime(occurredAt, now) : absTime(occurredAt)}</span>
              </div>
              {rawSym?.note && <div className="tl-note">{rawSym.note}</div>}
              {rawNote && <div className="tl-note">{rawNote.text}</div>}
              {redflag && (
                <div className="redflag-banner">
                  <AlertTriangle size={14} />
                  <span>{RED_FLAG_REMINDER}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
