'use server'

// Food diary — server actions.
//
//   estimateMealAction(description, eatenAt) — LLM macro estimate (lazy
//                                              wrapper around the pure
//                                              estimateMeal function).
//   commitMeal(payload)         — INSERT one row into `meals`. Macros +
//                                  items JSONB persisted. revalidates
//                                  /food, /, /report.
//   updateMeal(id, payload)     — UPDATE — sets edited=true if any
//                                  numeric field changed. Mirrors Slice 3
//                                  edit pattern (gotcha #27).
//   deleteMeal(id)              — DELETE (meals are correctable user data;
//                                  Slice 3 manual-entry parity. Does NOT
//                                  follow the never-delete contract that
//                                  applies to meds/adherence — gotcha
//                                  #103 family — meals are user-typed
//                                  estimates, not clinical history).
//   fetchMeals(daysBack)        — read window for /food's diary list.
//                                  Returns newest first.

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'
import { gstTodayISO } from '@/lib/gst'
import { estimateMeal } from './_lib/estimate'
import type { MealDraft, MealEstimateResult, MealItem, MealRow } from './_lib/types'

/** GST calendar-day key for a UTC ISO timestamp. Same `+4h, slice(0,10)`
 *  trick as `gstTodayISO`, applied to an arbitrary instant. */
function gstDateOf(iso: string): string {
  return new Date(Date.parse(iso) + 4 * 3600_000).toISOString().slice(0, 10)
}

async function requireSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorised')
  return user
}

export async function estimateMealAction(
  description: string,
  eatenAt: string,
): Promise<MealEstimateResult> {
  await requireSession()
  return estimateMeal(description, eatenAt)
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function rowFromRaw(raw: Record<string, unknown>): MealRow {
  return {
    id: raw.id as string,
    eaten_at: raw.eaten_at as string,
    meal_label: (raw.meal_label as MealRow['meal_label']) ?? null,
    description: (raw.description as string) ?? '',
    items: Array.isArray(raw.items) ? (raw.items as MealItem[]) : null,
    carbs_g: num(raw.carbs_g),
    protein_g: num(raw.protein_g),
    fat_g: num(raw.fat_g),
    fiber_g: num(raw.fiber_g),
    sugar_g: num(raw.sugar_g),
    sodium_mg: num(raw.sodium_mg),
    calories: num(raw.calories),
    estimated: (raw.estimated as boolean) ?? true,
    edited: (raw.edited as boolean) ?? false,
    source: (raw.source as string) ?? 'llm_estimate',
    created_at: raw.created_at as string,
    updated_at: raw.updated_at as string,
  }
}

const MEAL_SELECT =
  'id, eaten_at, meal_label, description, items, carbs_g, protein_g, fat_g, fiber_g, sugar_g, sodium_mg, calories, estimated, edited, source, created_at, updated_at'

function bumpRevalidations() {
  // /food owns the diary; / surfaces today's markers + macros via the
  // dashboard's data fetch; /report's adherence + dashboard-mirror calls
  // don't read meals yet but the user-facing pages that DO must refresh.
  revalidatePath('/food')
  revalidatePath('/')
}

// ─── Commit ────────────────────────────────────────────────────────────────

export interface CommitMealPayload {
  draft: MealDraft
  /** When true, the user changed at least one numeric field after the LLM estimate. */
  edited: boolean
}

export interface CommitMealResult {
  ok: boolean
  id?: string
  error?: string
}

export async function commitMeal(p: CommitMealPayload): Promise<CommitMealResult> {
  try {
    await requireSession()
    const d = p.draft
    if (!d.description.trim()) return { ok: false, error: 'Description is required.' }
    if (!d.eatenAt) return { ok: false, error: 'eaten_at is required.' }
    const service = createServiceClient()
    const { data, error } = await service
      .from('meals')
      .insert({
        eaten_at: d.eatenAt,
        meal_label: d.mealLabel,
        description: d.description.trim(),
        items: d.items ?? [],
        carbs_g: d.totals.carbs_g,
        protein_g: d.totals.protein_g,
        fat_g: d.totals.fat_g,
        fiber_g: d.totals.fiber_g,
        sugar_g: d.totals.sugar_g,
        sodium_mg: d.totals.sodium_mg,
        calories: d.totals.calories,
        estimated: true,
        edited: p.edited,
        source: 'llm_estimate',
      })
      .select('id')
      .single()
    if (error) return { ok: false, error: error.message }
    bumpRevalidations()
    return { ok: true, id: (data as { id: string }).id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Update ────────────────────────────────────────────────────────────────

export interface UpdateMealPayload {
  eatenAt?: string
  description?: string
  mealLabel?: MealRow['meal_label']
  items?: MealItem[]
  carbs_g?: number | null
  protein_g?: number | null
  fat_g?: number | null
  fiber_g?: number | null
  sugar_g?: number | null
  sodium_mg?: number | null
  calories?: number | null
}

export async function updateMeal(
  id: string,
  payload: UpdateMealPayload,
): Promise<CommitMealResult> {
  try {
    await requireSession()
    const service = createServiceClient()
    // Any field change marks the row `edited=true`. Conservatively flip on
    // every update — the original LLM blob lives in `items` JSONB if anyone
    // ever needs to compare.
    const { error } = await service
      .from('meals')
      .update({
        ...(payload.eatenAt !== undefined ? { eaten_at: payload.eatenAt } : {}),
        ...(payload.description !== undefined ? { description: payload.description.trim() } : {}),
        ...(payload.mealLabel !== undefined ? { meal_label: payload.mealLabel } : {}),
        ...(payload.items !== undefined ? { items: payload.items } : {}),
        ...(payload.carbs_g !== undefined ? { carbs_g: payload.carbs_g } : {}),
        ...(payload.protein_g !== undefined ? { protein_g: payload.protein_g } : {}),
        ...(payload.fat_g !== undefined ? { fat_g: payload.fat_g } : {}),
        ...(payload.fiber_g !== undefined ? { fiber_g: payload.fiber_g } : {}),
        ...(payload.sugar_g !== undefined ? { sugar_g: payload.sugar_g } : {}),
        ...(payload.sodium_mg !== undefined ? { sodium_mg: payload.sodium_mg } : {}),
        ...(payload.calories !== undefined ? { calories: payload.calories } : {}),
        edited: true,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    bumpRevalidations()
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Delete ────────────────────────────────────────────────────────────────

export async function deleteMeal(id: string): Promise<CommitMealResult> {
  try {
    await requireSession()
    const service = createServiceClient()
    const { error } = await service.from('meals').delete().eq('id', id)
    if (error) return { ok: false, error: error.message }
    bumpRevalidations()
    return { ok: true, id }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─── Reads ─────────────────────────────────────────────────────────────────

/** Diary list — newest first. */
export async function fetchMeals(daysBack: number = 7): Promise<MealRow[]> {
  await requireSession()
  const service = createServiceClient()
  const cutoff = new Date(Date.now() - daysBack * 86400000).toISOString()
  const { data, error } = await service
    .from('meals')
    .select(MEAL_SELECT)
    .gte('eaten_at', cutoff)
    .order('eaten_at', { ascending: false })
  if (error) throw new Error(`meals fetch failed: ${error.message}`)
  return (data ?? []).map((r) => rowFromRaw(r as Record<string, unknown>))
}

/** Today's meals (GST), for the glucose-trace markers. */
export async function fetchTodayMeals(): Promise<MealRow[]> {
  await requireSession()
  const service = createServiceClient()
  // Pull yesterday-onwards UTC so the GST calendar day is fully covered
  // regardless of when the user opens the dashboard.
  const cutoff = new Date(Date.now() - 36 * 3600_000).toISOString()
  const { data, error } = await service
    .from('meals')
    .select(MEAL_SELECT)
    .gte('eaten_at', cutoff)
    .order('eaten_at', { ascending: true })
  if (error) throw new Error(`meals fetch failed: ${error.message}`)
  const all = (data ?? []).map((r) => rowFromRaw(r as Record<string, unknown>))
  // GST day filter — keep only meals whose GST calendar date matches today's.
  // gstTodayISO lives in lib/gst.ts so cron + actions share one definition
  // (gotcha #121).
  const today = gstTodayISO()
  return all.filter((m) => gstDateOf(m.eaten_at) === today)
}
