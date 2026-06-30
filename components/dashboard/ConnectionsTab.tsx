'use client'

import { CorrelationExplorerPanel } from './panels/CorrelationExplorer'
import { ReadinessPanel } from './panels/ReadinessPanel'
import { AnnotatedGlucosePanel } from './panels/AnnotatedGlucosePanel'
import { ConnectionsFound } from './connections/panels/ConnectionsFound'
import type { DailyMetricRow, CgmPoint } from '@/app/lib/dashboard/daily-metrics'
import type { RecentEntry } from '@/app/log/_lib/types'
import type { DateRange } from './connections/engine'

interface Props {
  /**
   * 365-day series for the engine + Explorer (NOT the dashboard's 30/90-day
   * range-slice). Readiness reads `seriesSliced` so its today-snapshot
   * follows the user's selected range.
   */
  seriesEngine: DailyMetricRow[]
  /** Range-sliced series for Cardiac Readiness (matches the dashboard range toggle). */
  seriesSliced: DailyMetricRow[]
  /** Exclusions for the engine + Explorer (med-changes + context_periods). */
  exclusions: DateRange[]
  cgm24h: CgmPoint[]
  recent: RecentEntry[]
  glucoseUnit: 'mmol/L' | 'mg/dL'
  /** Whether the optional LLM "what else?" expand is wired (ANTHROPIC_API_KEY set). */
  llmAvailable: boolean
}

export function ConnectionsTab({
  seriesEngine,
  seriesSliced,
  exclusions,
  cgm24h,
  recent,
  glucoseUnit,
  llmAvailable,
}: Props) {
  return (
    <>
      <div className="section-divider tabhead">
        <div className="section-head">
          <span className="section-kicker" style={{ color: 'var(--teal)' }}>
            Correlations
          </span>
          <h2 className="section-title">Connections engine</h2>
          <p className="section-sub">
            Lagged associational scan across your tracked signals — detrended, autocorrelation-corrected,
            multiple-comparison controlled. <strong>Hypotheses to discuss with Dr. Jose</strong>, never findings,
            never causal, never diagnostic. The engine surfaces patterns; it never tells you to change a med
            or a behaviour. Unmeasured factors (diet, alcohol, stress, illness) often drive both signals at
            once — each card lists what else to consider.
          </p>
        </div>
      </div>
      <main className="grid">
        <ConnectionsFound
          series={seriesEngine}
          exclusions={exclusions}
          llmAvailable={llmAvailable}
        />
        <CorrelationExplorerPanel series={seriesEngine} exclusions={exclusions} />
        <ReadinessPanel series={seriesSliced} />
        <AnnotatedGlucosePanel cgm24h={cgm24h} recent={recent} glucoseUnit={glucoseUnit} />
      </main>
    </>
  )
}
