'use client'

import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { Header, type TabId } from './Header'
import { TodayAtAGlance } from './panels/TodayAtAGlance'
import { MedAdherencePanel } from './panels/MedAdherencePanel'
import { CardiacPanel } from './panels/CardiacPanel'
import { GlucosePanel } from './panels/GlucosePanel'
import { RecoverySleepPanel } from './panels/RecoverySleepPanel'
import { OvernightOxygenPanel } from './panels/OvernightOxygenPanel'
import { WeightPanel } from './panels/WeightPanel'
import { QuickLogPanel } from './panels/QuickLogPanel'
import { TimelinePanel } from './panels/TimelinePanel'
import { ConnectionsTab } from './ConnectionsTab'
import { BaselinesTab } from './BaselinesTab'
import { LabsTab } from './LabsTab'
import type { RangeId } from './thresholds'
import type {
  DailyMetricRow,
  CgmPoint,
  LatestKpis,
  Spo2NightPayload,
  FingerstickPoint,
} from '@/app/lib/dashboard/daily-metrics'
import type { LabPanelRow, MarkerTrend } from '@/app/labs/actions'
import type { BaselinesPayload } from '@/app/lib/dashboard/baselines'
import type { AdherenceSummary } from '@/app/medications/actions'
import type { RecentEntry } from '@/app/log/_lib/types'
import type { DateRange } from './connections/engine'
import type { MealRow } from '@/app/food/_lib/types'
import { carryForwardWeightForTrend } from './utils'

interface Props {
  series: DailyMetricRow[]      // 365 days, oldest first; weight column raw
  cgm24h: CgmPoint[]
  latest: LatestKpis
  recent: RecentEntry[]
  baselines: BaselinesPayload
  spo2Night: Spo2NightPayload | null
  fingersticks: FingerstickPoint[]
  labPanels: LabPanelRow[]
  labTrends: MarkerTrend[]
  adherence: AdherenceSummary
  /** Med-change + context_periods exclusions for the Connections engine. */
  engineExclusions: DateRange[]
  /** Whether the optional LLM confounder expand is wired. */
  llmConfoundersAvailable: boolean
  /** Today's meals (GST) — rendered as carbs markers on the CGM trace. */
  todayMeals: MealRow[]
}

export function DashboardClient({
  series, cgm24h, latest, recent, baselines, spo2Night, fingersticks,
  labPanels, labTrends, adherence, engineExclusions, llmConfoundersAvailable, todayMeals,
}: Props) {
  // Shape today's meals as the slim MealMarkerInput the panel expects.
  const mealMarkers = useMemo(
    () => todayMeals.map((m) => ({
      id: m.id,
      time: new Date(m.eaten_at),
      description: m.description,
      carbs: m.carbs_g,
      mealLabel: m.meal_label,
    })),
    [todayMeals],
  )
  const [range, setRange] = useState<RangeId>(30)
  const [unit, setUnit] = useState<'mmol/L' | 'mg/dL'>('mmol/L')
  const [tab, setTab] = useState<TabId>('dashboard')

  // Range-slice + carry-forward weight ONLY for the trend (KPI weight stays raw).
  const sliced = useMemo(() => series.slice(-range), [series, range])
  const slicedForTrend = useMemo(() => carryForwardWeightForTrend(sliced), [sliced])

  return (
    <div className="app">
      <Header range={range} onRangeChange={setRange} tab={tab} onTabChange={setTab} />
      {tab === 'dashboard' && (
        <main className="grid">
          <TodayAtAGlance series={sliced} latest={latest} glucoseUnit={unit} rangeDays={range} fingersticks={fingersticks} />
          <MedAdherencePanel adherence={adherence} />
          <CardiacPanel series={sliced} latest={latest} />
          <GlucosePanel cgm24h={cgm24h} latest={latest} unit={unit} onUnitChange={setUnit} fingersticks={fingersticks} meals={mealMarkers} />
          <RecoverySleepPanel series={sliced} latest={latest} rangeDays={range} />
          <OvernightOxygenPanel series={sliced} latest={latest} night={spo2Night} rangeDays={range} />
          <WeightPanel series={slicedForTrend} latest={latest} rangeDays={range} />
          <QuickLogPanel glucoseUnit={unit} />
          <TimelinePanel entries={recent} />
        </main>
      )}
      {tab === 'correlations' && (
        <ConnectionsTab
          seriesEngine={series}
          seriesSliced={sliced}
          exclusions={engineExclusions}
          cgm24h={cgm24h}
          recent={recent}
          glucoseUnit={unit}
          llmAvailable={llmConfoundersAvailable}
        />
      )}
      {tab === 'baselines' && <BaselinesTab baselines={baselines} />}
      {tab === 'labs' && <LabsTab panels={labPanels} trends={labTrends} />}
      <footer className="foot">
        <Info size={13} />
        <span>Personal health dashboard — for trends, not alarms. Not medical advice.</span>
      </footer>
    </div>
  )
}
