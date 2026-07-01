'use client'

// Medication adherence — one-tap daily confirm + streak + 7-day dots.
//
// Placed right after TodayAtAGlance because DAPT (Brilinta) adherence
// post-DES is a stent-thrombosis signal the cardiologist genuinely acts
// on, but the only way it'll get used is if it stays near-zero friction.
//
// Honest math (gotcha #103/#108 family): unknown ≠ missed. The two
// numbers (adherence-of-logged + coverage) are always rendered separately;
// we never collapse them into one alarming low percentage.
//
// Mutation pattern: server action → router.refresh() (gotcha #35); no
// optimistic state, the server is the truth.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Pill, RotateCcw, X, Flame } from 'lucide-react'
import { Card } from '../ui/Card'
import { PanelHeader } from '../ui/PanelHeader'
import {
  confirmTodayMeds,
  markTodaySkipped,
  clearToday,
  type AdherenceSummary,
  type AdherenceDayStatus,
} from '@/app/medications/actions'

interface Props {
  adherence: AdherenceSummary
}

function DayDot({ status, day }: { status: AdherenceDayStatus; day: string }) {
  const label =
    status === 'taken' ? 'Taken' : status === 'skipped' ? 'Skipped' : 'Not logged'
  return (
    <span
      className={`med-adh-dot med-adh-dot-${status}`}
      title={`${day} — ${label}`}
      aria-label={`${day} ${label}`}
    />
  )
}

export function MedAdherencePanel({ adherence }: Props) {
  const router = useRouter()
  const [busy, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showSkipNote, setShowSkipNote] = useState(false)
  const [skipNote, setSkipNote] = useState('')

  const last7 = adherence.days.slice(-7)
  const todayIsTaken = adherence.todayStatus === 'taken'
  const todayIsSkipped = adherence.todayStatus === 'skipped'

  function run(action: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null)
    startTransition(async () => {
      const res = await action()
      if (!res.ok) {
        setError(res.error ?? 'Unknown error')
        return
      }
      after?.()
      router.refresh()
    })
  }

  function onConfirm() { run(confirmTodayMeds) }
  function onUndo() { run(clearToday) }
  function onSkip() {
    run(() => markTodaySkipped(skipNote || undefined), () => {
      setShowSkipNote(false)
      setSkipNote('')
    })
  }

  return (
    <Card className="col-12">
      <PanelHeader
        icon={<Pill size={18} />}
        title="Medication adherence"
        accent="var(--teal)"
        right={
          <span className="med-adh-self-reported" title="Self-reported daily confirm — not verified intake.">
            self-reported
          </span>
        }
      />

      <div className="med-adh-body">
        <div className="med-adh-action">
          {todayIsTaken ? (
            <div className="med-adh-confirmed">
              <span className="med-adh-confirmed-mark"><CheckCircle2 size={20} /></span>
              <div className="med-adh-confirmed-text">
                <div className="med-adh-confirmed-line"><strong>Logged for today</strong></div>
                <div className="med-adh-confirmed-sub">Tap undo if that was a mistake — the row is kept, just cleared.</div>
              </div>
              <button
                type="button"
                className="med-adh-btn med-adh-btn-ghost"
                onClick={onUndo}
                disabled={busy}
                title="Undo — sets the day to cleared, never deletes"
              >
                <RotateCcw size={14} /> Undo
              </button>
            </div>
          ) : todayIsSkipped ? (
            <div className="med-adh-confirmed med-adh-confirmed-skipped">
              <span className="med-adh-confirmed-mark"><X size={20} /></span>
              <div className="med-adh-confirmed-text">
                <div className="med-adh-confirmed-line"><strong>Marked as skipped today</strong></div>
                <div className="med-adh-confirmed-sub">Tap below to confirm instead, or undo to clear the day.</div>
              </div>
              <div className="med-adh-row-actions">
                <button type="button" className="med-adh-btn med-adh-btn-primary" onClick={onConfirm} disabled={busy}>
                  <CheckCircle2 size={14} /> Took today&apos;s meds
                </button>
                <button type="button" className="med-adh-btn med-adh-btn-ghost" onClick={onUndo} disabled={busy}>
                  <RotateCcw size={14} /> Undo
                </button>
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="med-adh-btn med-adh-btn-big"
                onClick={onConfirm}
                disabled={busy}
              >
                <CheckCircle2 size={18} /> Took today&apos;s meds
              </button>
              {!showSkipNote ? (
                <button
                  type="button"
                  className="med-adh-btn med-adh-btn-ghost"
                  onClick={() => setShowSkipNote(true)}
                  disabled={busy}
                >
                  Skipped today
                </button>
              ) : (
                <div className="med-adh-skip-form">
                  <input
                    type="text"
                    value={skipNote}
                    onChange={(e) => setSkipNote(e.target.value)}
                    placeholder="Optional note (e.g. 'travel day')"
                    disabled={busy}
                    className="med-adh-skip-input"
                  />
                  <button
                    type="button"
                    className="med-adh-btn med-adh-btn-primary"
                    onClick={onSkip}
                    disabled={busy}
                  >
                    Mark skipped
                  </button>
                  <button
                    type="button"
                    className="med-adh-btn med-adh-btn-ghost"
                    onClick={() => { setShowSkipNote(false); setSkipNote('') }}
                    disabled={busy}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="med-adh-streak-block">
          <div className="med-adh-streak">
            <Flame size={16} style={{ color: adherence.streak > 0 ? 'var(--amber)' : 'var(--text-dim)' }} />
            <strong>{adherence.streak}</strong>
            <span className="med-adh-streak-label">
              {adherence.streak === 1 ? 'day streak' : 'day streak'}
            </span>
          </div>
          <div className="med-adh-week">
            <div className="med-adh-week-label">Last 7 days</div>
            <div className="med-adh-week-dots">
              {last7.map((d) => (
                <DayDot key={d.day} status={d.status} day={d.day} />
              ))}
            </div>
            <div className="med-adh-week-legend">
              <span className="med-adh-legend-item"><span className="med-adh-dot med-adh-dot-taken" /> taken</span>
              <span className="med-adh-legend-item"><span className="med-adh-dot med-adh-dot-skipped" /> skipped</span>
              <span className="med-adh-legend-item"><span className="med-adh-dot med-adh-dot-unknown" /> not logged</span>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="med-adh-error">{error}</div>}
    </Card>
  )
}
