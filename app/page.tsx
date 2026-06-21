import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DashboardClient } from '@/components/dashboard/DashboardClient'
import {
  fetchDailyMetrics,
  fetchCgm24h,
  fetchLatestKpis,
} from '@/app/lib/dashboard/daily-metrics'
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
  const [series, cgm24h] = await Promise.all([
    fetchDailyMetrics(90),
    fetchCgm24h(),
  ])
  const latest = await fetchLatestKpis(cgm24h)

  return <DashboardClient series={series} cgm24h={cgm24h} latest={latest} />
}
