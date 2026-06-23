import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import {
  fetchDailyMetrics,
  fetchCgm24h,
  fetchLatestKpis,
  fetchLatestSpo2Night,
} from '@/app/lib/dashboard/daily-metrics'
import { fetchBaselinesPayload } from '@/app/lib/dashboard/baselines'
import { fetchRecentManual } from '@/app/log/_lib/fetch-recent'
import './dashboard.css'

export default async function DashboardPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch the full 90-day window once; range toggle slices client-side without
  // a re-fetch. CGM 24h is its own raw pull (~288 rows). Latest KPIs are the
  // most recent of each metric (BP, weight, sleep, etc.) — independent of range.
  // Recent manual entries reuse Slice 3's fetcher for the Timeline panel.
  // Baselines payload (Slice 7.3) is its own bounded pull off metric_drift +
  // context_periods + anchor_sets + med_changes (4 parallel sub-queries).
  const [series, cgm24h, recent, baselines, spo2Night] = await Promise.all([
    fetchDailyMetrics(90),
    fetchCgm24h(),
    fetchRecentManual(20),
    fetchBaselinesPayload(),
    fetchLatestSpo2Night(),
  ])
  const latest = await fetchLatestKpis(cgm24h)

  return (
    <DashboardClient
      series={series}
      cgm24h={cgm24h}
      latest={latest}
      recent={recent}
      baselines={baselines}
      spo2Night={spo2Night}
    />
  )
}
