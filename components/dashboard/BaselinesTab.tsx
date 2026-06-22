'use client'

import { BaselinesDriftPanel } from './panels/BaselinesDriftPanel'
import type { BaselinesPayload } from '@/app/lib/dashboard/baselines'

interface Props {
  baselines: BaselinesPayload
}

export function BaselinesTab({ baselines }: Props) {
  return (
    <>
      <div className="section-divider tabhead">
        <div className="section-head">
          <span className="section-kicker" style={{ color: 'var(--teal)' }}>
            Baselines & drift
          </span>
          <h2 className="section-title">Your personal-normal radar</h2>
          <p className="section-sub">
            Quietly watches each signal against your own recent history — surfaces what&rsquo;s drifted,
            what&rsquo;s holding, and what&rsquo;s still settling in. Never against population averages.
          </p>
        </div>
      </div>
      <main className="grid">
        <BaselinesDriftPanel payload={baselines} />
      </main>
    </>
  )
}
