import type { DailyMetricRow } from '@/app/lib/dashboard/daily-metrics'

/**
 * Carry forward the most recent non-null weight across days so the trend line
 * is continuous. For the trend CHART only — never use this output for the KPI
 * "latest weight" (which must show an actual reading).
 */
export function carryForwardWeightForTrend(rows: DailyMetricRow[]): DailyMetricRow[] {
  let last: number | null = null
  return rows.map((r) => {
    if (r.weight !== null) {
      last = r.weight
      return r
    }
    return { ...r, weight: last }
  })
}
