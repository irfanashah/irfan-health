'use server'

// Server actions for the Slice 7.3 Baselines & Drift surface.
// excludeTodayAction is used by the dashboard panel; the rest power the
// /baselines page (set anchor + context periods + med changes).

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import type { DriftMetricId } from '@/components/dashboard/drift-config'

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

// ─── Anchor preview + set ──────────────────────────────────────────────────

export interface AnchorPreviewRow {
  metric: string
  median: number
  mad: number
  n: number
}

export interface AnchorPreviewResult extends ActionResult {
  stats?: AnchorPreviewRow[]
}

/**
 * Preview anchor stats for a window WITHOUT writing anything. Calls the
 * `compute_anchor_stats` SQL function — same CTE shape as `set_anchor`,
 * so preview numbers are identical to what will be frozen.
 */
export async function previewAnchorAction(
  startISO: string,
  endISO: string
): Promise<AnchorPreviewResult> {
  try {
    await requireSession()
    if (!startISO || !endISO) return { ok: false, error: 'Window dates required.' }
    if (endISO < startISO) return { ok: false, error: 'End must be on/after start.' }

    const supabase = createServiceClient()
    const { data, error } = await supabase.rpc('compute_anchor_stats', {
      p_start: startISO,
      p_end: endISO,
    })
    if (error) return { ok: false, error: error.message }

    const stats: AnchorPreviewRow[] = (data ?? []).map((r: { metric: string; median: number | string; mad: number | string; n: number | string }) => ({
      metric: r.metric,
      median: Number(r.median),
      mad: Number(r.mad),
      n: Number(r.n),
    }))
    return { ok: true, stats }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Freeze a new anchor (supersede prior). Calls the atomic `set_anchor` SQL
 * function: flips prior active → false, inserts a new active header,
 * inserts per-metric stat lines for metrics meeting minN.
 */
export async function setAnchorAction(
  startISO: string,
  endISO: string,
  note: string | null,
  minN = 5
): Promise<ActionResult> {
  try {
    await requireSession()
    if (!startISO || !endISO) return { ok: false, error: 'Window dates required.' }
    if (endISO < startISO) return { ok: false, error: 'End must be on/after start.' }

    const supabase = createServiceClient()
    const { error } = await supabase.rpc('set_anchor', {
      p_start: startISO,
      p_end: endISO,
      p_note: note,
      p_min_n: minN,
    })
    if (error) return { ok: false, error: error.message }

    revalidatePath('/')
    revalidatePath('/baselines')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Context periods ───────────────────────────────────────────────────────

type ContextType = 'ramadan' | 'travel' | 'illness' | 'other' | 'anomaly'

export interface ContextPeriodInput {
  start_date: string
  end_date: string
  type: ContextType
  suppress_alerts: boolean
  exclude_from_baseline: boolean
  note: string | null
}

export async function addContextPeriodAction(input: ContextPeriodInput): Promise<ActionResult> {
  try {
    await requireSession()
    if (!input.start_date || !input.end_date) {
      return { ok: false, error: 'Start and end dates required.' }
    }
    if (input.end_date < input.start_date) {
      return { ok: false, error: 'End must be on/after start.' }
    }

    const supabase = createServiceClient()
    const { error } = await supabase.from('context_periods').insert({
      start_date: input.start_date,
      end_date: input.end_date,
      type: input.type,
      suppress_alerts: input.suppress_alerts,
      exclude_from_baseline: input.exclude_from_baseline,
      note: input.note,
      active: true,
    })
    if (error) return { ok: false, error: error.message }

    revalidatePath('/')
    revalidatePath('/baselines')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deactivateContextPeriodAction(id: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('context_periods')
      .update({ active: false })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/')
    revalidatePath('/baselines')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Med changes ───────────────────────────────────────────────────────────

export interface MedChangeInput {
  change_date: string
  label: string
  affected_metrics: DriftMetricId[]
  note: string | null
}

export async function addMedChangeAction(input: MedChangeInput): Promise<ActionResult> {
  try {
    await requireSession()
    if (!input.change_date) return { ok: false, error: 'Change date required.' }
    if (!input.label.trim()) return { ok: false, error: 'Label required.' }
    if (input.affected_metrics.length === 0) {
      return { ok: false, error: 'Select at least one affected metric.' }
    }

    const supabase = createServiceClient()
    const { error } = await supabase.from('med_changes').insert({
      change_date: input.change_date,
      label: input.label.trim(),
      affected_metrics: input.affected_metrics,
      note: input.note,
      active: true,
    })
    if (error) return { ok: false, error: error.message }

    revalidatePath('/')
    revalidatePath('/baselines')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function deactivateMedChangeAction(id: string): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = createServiceClient()
    const { error } = await supabase
      .from('med_changes')
      .update({ active: false })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/')
    revalidatePath('/baselines')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
