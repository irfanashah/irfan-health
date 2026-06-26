import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  fetchDailyMetrics,
  fetchCgm24h,
  fetchLatestKpis,
  fetchLatestSpo2Night,
  fetchFingersticks,
} from '@/app/lib/dashboard/daily-metrics'
import { fetchBaselinesPayload } from '@/app/lib/dashboard/baselines'
import { fetchAllPanels, fetchAllMarkerTrends } from '@/app/labs/actions'
import { fetchActiveMedications } from '@/app/medications/actions'
import { evaluateMetric } from '@/components/dashboard/drift/evaluate'
import { buildDriftPanelData } from '@/components/dashboard/drift/present'
import { DRIFT_METRICS } from '@/components/dashboard/drift-config'
import { Report } from './Report'
import '../dashboard.css'
import './report.css'

// Server actions invoked from this segment inherit. The data assembly
// is read-only but fetches everything; 800s matches the other heavy
// routes (refill/diagnose/labs) and the Pro maxDuration ceiling.
export const maxDuration = 800

/**
 * /report — print-optimised doctor record.
 *
 * Reads existing data only (daily_metrics, BP, sleep, CGM, labs, drift)
 * + the medications list. No new health data, no API calls outside
 * Supabase. Browser print → Save as PDF; no server-side PDF library.
 *
 * Window: vitals/glucose/sleep last 90 days; labs all draws.
 */
export default async function ReportPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const VITALS_DAYS = 90

  const [
    series,
    cgm24h,
    spo2Night,
    fingersticks,
    baselines,
    labPanels,
    labTrends,
    medications,
  ] = await Promise.all([
    fetchDailyMetrics(VITALS_DAYS),
    fetchCgm24h(),
    fetchLatestSpo2Night(),
    fetchFingersticks(VITALS_DAYS),
    fetchBaselinesPayload(),
    fetchAllPanels(),
    fetchAllMarkerTrends(),
    fetchActiveMedications(),
  ])
  const latest = await fetchLatestKpis(cgm24h)

  // Drift verdicts — feed the page-1 "Notable drift" callout + the
  // detail-page drift summary. Same buildDriftPanelData the Baselines
  // & drift tab uses, so the report agrees with what the user sees on
  // the dashboard.
  const driftVerdicts = DRIFT_METRICS.map((m) =>
    evaluateMetric(m, baselines.drift[m] ?? [], {
      anchor: baselines.anchor,
      contextToday: baselines.context,
      medChanges: baselines.medChanges,
    })
  )
  const driftPanel = buildDriftPanelData(driftVerdicts, baselines.drift, 30)

  return (
    <div className="report-doc">
      <Report
        windowDays={VITALS_DAYS}
        generatedAt={new Date().toISOString()}
        series={series}
        cgm24h={cgm24h}
        latest={latest}
        spo2Night={spo2Night}
        fingersticks={fingersticks}
        labPanels={labPanels}
        labTrends={labTrends}
        medications={medications}
        driftPanel={driftPanel}
      />
    </div>
  )
}
