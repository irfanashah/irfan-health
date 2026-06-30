import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import {
  fetchDailyMetrics,
  fetchCgm24h,
  fetchLatestKpis,
  fetchLatestSpo2Night,
  fetchFingersticks,
} from '@/app/lib/dashboard/daily-metrics'
import { fetchBaselinesPayload } from '@/app/lib/dashboard/baselines'
import { fetchAllPanels, fetchAllMarkerTrends } from '@/app/labs/actions'
import { fetchAdherence } from '@/app/medications/actions'
import { fetchRecentManual } from '@/app/log/_lib/fetch-recent'
import { fetchEngineExclusions } from '@/app/lib/dashboard/exclusions'
import './dashboard.css'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Pull the wide 365-day series once. The Dashboard tab slices to 7/30/90
  // client-side; the Connections engine reads the full 365 so its lagged
  // discovery has enough overlap to clear the FDR gate (spec §1.1). CGM
  // 24h is its own raw pull (~288 rows). Latest KPIs are the most recent
  // of each metric. Baselines payload is its own bounded pull.
  const ENGINE_WINDOW_DAYS = 365
  const windowEnd = new Date().toISOString().slice(0, 10)
  const windowStart = new Date(Date.now() - (ENGINE_WINDOW_DAYS - 1) * 86400000)
    .toISOString().slice(0, 10)

  const [series, cgm24h, recent, baselines, spo2Night, fingersticks, labPanels, labTrends, adherence, engineExclusions] =
    await Promise.all([
      fetchDailyMetrics(ENGINE_WINDOW_DAYS),
      fetchCgm24h(),
      fetchRecentManual(20),
      fetchBaselinesPayload(),
      fetchLatestSpo2Night(),
      fetchFingersticks(14),
      fetchAllPanels(),
      fetchAllMarkerTrends(),
      fetchAdherence(30),
      fetchEngineExclusions(windowStart, windowEnd),
    ])
  const latest = await fetchLatestKpis(cgm24h)
  const llmConfoundersAvailable = !!process.env.ANTHROPIC_API_KEY

  return (
    <DashboardClient
      series={series}
      cgm24h={cgm24h}
      latest={latest}
      recent={recent}
      baselines={baselines}
      spo2Night={spo2Night}
      fingersticks={fingersticks}
      labPanels={labPanels}
      labTrends={labTrends}
      adherence={adherence}
      engineExclusions={engineExclusions}
      llmConfoundersAvailable={llmConfoundersAvailable}
    />
  )
}
