// Daily med-adherence nudge.
//
// Runs once daily at 13:00 GST (09:00 UTC). Early-afternoon timing
// catches a missed-morning tap without nagging at dawn; only sends an
// email if today's row is still absent (or cleared) by then.
//
// Silent when today is already logged taken/skipped. No PHI in the
// body — one nudge line + a dashboard CTA. No streak detail.

import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { gstTodayISO } from '@/lib/gst'
import { sendAlertEmail } from '@/lib/email'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization')
  const expected = `Bearer ${process.env.CRON_SECRET}`
  if (!authHeader || authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const today = gstTodayISO()
  const supabase = createServiceClient()

  // Fetch today's row (if any). `cleared` rows count as "no record" —
  // they're rule-compliant undos, not a state to alert against.
  const { data, error } = await supabase
    .from('med_adherence')
    .select('day, status')
    .eq('day', today)
    .neq('status', 'cleared')
    .limit(1)
  if (error) {
    console.warn(`[adherence-reminder] query failed: ${error.message}`)
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const logged = (data?.length ?? 0) > 0
  if (logged) {
    return NextResponse.json({ ok: true, today, logged: true, emailed: false })
  }

  const result = await sendAlertEmail({
    subject: 'Tap to log today\'s meds',
    lines: ['Haven\'t logged your meds yet today — one tap on the dashboard.'],
    cta: { label: 'Open dashboard', url: 'https://irfan-health.vercel.app/' },
  })

  return NextResponse.json({
    ok: true,
    today,
    logged: false,
    emailed: result.ok,
    emailError: result.error,
  })
}
