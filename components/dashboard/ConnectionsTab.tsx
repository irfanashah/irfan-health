'use client'

import { CorrelationExplorerPanel } from './panels/CorrelationExplorer'
import { ReadinessPanel } from './panels/ReadinessPanel'
import { SleepCascadePanel } from './panels/SleepCascadePanel'
import { ActivityPacingPanel } from './panels/ActivityPacingPanel'
import { AnnotatedGlucosePanel } from './panels/AnnotatedGlucosePanel'
import type { DailyMetricRow, CgmPoint } from '@/app/lib/dashboard/daily-metrics'
import type { RecentEntry } from '@/app/log/_lib/types'

interface Props {
  series: DailyMetricRow[]      // range-sliced
  cgm24h: CgmPoint[]
  recent: RecentEntry[]
  glucoseUnit: 'mmol/L' | 'mg/dL'
}

export function ConnectionsTab({ series, cgm24h, recent, glucoseUnit }: Props) {
  return (
    <>
      <div className="section-divider tabhead">
        <div className="section-head">
          <span className="section-kicker" style={{ color: 'var(--teal)' }}>
            Correlations
          </span>
          <h2 className="section-title">Cross-source relationships</h2>
          <p className="section-sub">
            Combining your devices into single views — where one signal lines up with another.
            Associational reads on your own data, never causal claims.
          </p>
        </div>
      </div>
      <main className="grid">
        <CorrelationExplorerPanel series={series} />
        <ReadinessPanel series={series} />
        <SleepCascadePanel series={series} />
        <ActivityPacingPanel series={series} />
        <AnnotatedGlucosePanel cgm24h={cgm24h} recent={recent} glucoseUnit={glucoseUnit} />
      </main>
    </>
  )
}
