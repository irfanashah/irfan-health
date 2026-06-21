'use client'

import { useMemo, useState } from 'react'
import { Info } from 'lucide-react'
import { Header } from './Header'
import { TodayAtAGlance } from './panels/TodayAtAGlance'
import { CardiacPanel } from './panels/CardiacPanel'
import { GlucosePanel } from './panels/GlucosePanel'
import { RecoverySleepPanel } from './panels/RecoverySleepPanel'
import { WeightPanel } from './panels/WeightPanel'
import type { RangeId } from './thresholds'
import type {
  DailyMetricRow,
  CgmPoint,
  LatestKpis,
} from '@/app/lib/dashboard/daily-metrics'
import { carryForwardWeightForTrend } from './utils'

interface Props {
  series: DailyMetricRow[]      // up to 90 days, oldest first; weight column raw (not yet carry-forwarded)
  cgm24h: CgmPoint[]
  latest: LatestKpis
}

export function DashboardClient({ series, cgm24h, latest }: Props) {
  const [range, setRange] = useState<RangeId>(30)
  const [unit, setUnit] = useState<'mmol/L' | 'mg/dL'>('mmol/L')
  const [tab, setTab] = useState<'dashboard' | 'correlations'>('dashboard')

  // Range-slice + carry-forward weight ONLY for the trend (KPI weight stays raw).
  const sliced = useMemo(() => series.slice(-range), [series, range])
  const slicedForTrend = useMemo(() => carryForwardWeightForTrend(sliced), [sliced])

  return (
    <div className="app">
      <Header range={range} onRangeChange={setRange} tab={tab} onTabChange={setTab} />
      <main className="grid">
        <TodayAtAGlance series={sliced} latest={latest} glucoseUnit={unit} rangeDays={range} />
        <CardiacPanel series={sliced} latest={latest} />
        <GlucosePanel cgm24h={cgm24h} latest={latest} unit={unit} onUnitChange={setUnit} />
        <RecoverySleepPanel series={sliced} latest={latest} rangeDays={range} />
        <WeightPanel series={slicedForTrend} latest={latest} rangeDays={range} />
        {/* QuickLog + Timeline land in the next commit */}
      </main>
      <footer className="foot">
        <Info size={13} />
        <span>Personal health dashboard — for trends, not alarms. Not medical advice.</span>
      </footer>
    </div>
  )
}
