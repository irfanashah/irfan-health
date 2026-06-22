'use server'

// Server actions for the Slice 7.3 Baselines & Drift surface.
// The "exclude today" quick action lands now (used by the panel header in
// Commit 4); the set-anchor / context-period / med-change forms land in
// Commit 5 alongside the /baselines page.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

async function requireSession(): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorised')
}

function todayISO(): string {
  // GST-anchored today (Asia/Dubai is fixed +04:00). Same convention as the
  // daily_metrics view's bucketing — keeps "today" consistent across the app.
  const now = new Date()
  const gst = new Date(now.getTime() + 4 * 60 * 60 * 1000)
  return gst.toISOString().slice(0, 10)
}

export interface ActionResult {
  ok: boolean
  error?: string
}

/**
 * "Exclude today" quick action.
 * Writes a 1-day context_periods row with:
 *   type='anomaly', exclude_from_baseline=true, suppress_alerts=false
 * EXPLICITLY (per spec — does NOT inherit the multi-day both-default-true).
 *
 * Idempotent against same-day re-clicks: if an active 'anomaly' row already
 * covers today, it's a no-op (returns ok=true).
 */
export async function excludeTodayAction(): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = createServiceClient()
    const today = todayISO()

    const { data: existing, error: e1 } = await supabase
      .from('context_periods')
      .select('id')
      .eq('active', true)
      .eq('type', 'anomaly')
      .eq('start_date', today)
      .eq('end_date', today)
      .limit(1)

    if (e1) return { ok: false, error: e1.message }
    if (existing && existing.length > 0) {
      // Already excluded — treat as success.
      revalidatePath('/')
      return { ok: true }
    }

    const { error } = await supabase.from('context_periods').insert({
      start_date: today,
      end_date: today,
      type: 'anomaly',
      exclude_from_baseline: true,
      suppress_alerts: false,
      note: 'Quick action: exclude today from baselines',
      active: true,
    })

    if (error) return { ok: false, error: error.message }
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
