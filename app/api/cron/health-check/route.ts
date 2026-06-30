// Daily pipeline-health monitor.
//
// Runs once daily at 08:00 GST (04:00 UTC). Checks the API-pull crons
// (whoop / withings / nightscout) for last-success-age vs per-source
// staleness threshold. Emails ONE digest only when ≥1 source is stale
// or has no success row ever. SILENT when all healthy — no alert
// fatigue, no "everything's fine" daily noise.
//
// Cadence inherently de-dupes: a persistently-down source emails at
// most once/day. No "already alerted" state table needed (spec §3).

import { NextRequest, NextResponse } from 'next/server'
import { fetchPipelineHealth, fmtGstTimestamp } from '@/app/lib/diagnostics/pipeline-health'
import { sendAlertEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const rows = await fetchPipelineHealth()
  const stale = rows.filter((r) => r.stale)
  const checked = rows.map((r) => r.slug)

  if (stale.length === 0) {
    return NextResponse.json({ ok: true, checked, stale: [], emailed: false, reason: 'all-healthy' })
  }

  const lines = [
    `${stale.length} of ${rows.length} ingestion source${stale.length === 1 ? '' : 's'} ${stale.length === 1 ? 'is' : 'are'} stale.`,
    '',
    ...stale.map((r) => {
      if (!r.lastSuccessAt) {
        return `${r.label} — no successful run on record (threshold ${r.staleHours}h).`
      }
      const ageH = r.ageHours ?? 0
      const ageLabel = ageH >= 24
        ? `${Math.round(ageH / 24 * 10) / 10}d`
        : `${Math.round(ageH)}h`
      return `${r.label} — last success ${ageLabel} ago (${fmtGstTimestamp(r.lastSuccessAt)} GST, threshold ${r.staleHours}h).`
    }),
  ]

  const result = await sendAlertEmail({
    subject: `⚠️ Health platform: ${stale.length} source${stale.length === 1 ? '' : 's'} stale`,
    lines,
    cta: { label: 'Open diagnostics', url: 'https://irfan-health.vercel.app/diagnostics' },
  })

  return NextResponse.json({
    ok: true,
    checked,
    stale: stale.map((r) => ({ slug: r.slug, ageHours: r.ageHours, lastSuccessAt: r.lastSuccessAt })),
    emailed: result.ok,
    emailError: result.error,
  })
}
