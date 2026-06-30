'use server'

// Medications — small editable list.
//
// Never hard-delete; the platform's history-preserving rule applies
// to clinical regimen changes too. Deactivate via `active=false` so the
// "stopped a med on X date" signal stays in the table for future
// reference. The doctor report reads `active=true` only.

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { revalidatePath } from 'next/cache'

async function requireSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorised')
  return user
}

export interface MedicationRow {
  id: string
  name: string
  dose: string | null
  frequency: string | null
  notes: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface MedActionResult {
  ok: boolean
  error?: string
}

export async function fetchMedications(): Promise<MedicationRow[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('medications')
    .select('id, name, dose, frequency, notes, active, created_at, updated_at')
    .order('active', { ascending: false })
    .order('name', { ascending: true })
  if (error) throw new Error(`medications fetch failed: ${error.message}`)
  return (data ?? []) as MedicationRow[]
}

export async function fetchActiveMedications(): Promise<MedicationRow[]> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('medications')
    .select('id, name, dose, frequency, notes, active, created_at, updated_at')
    .eq('active', true)
    .order('name', { ascending: true })
  if (error) throw new Error(`medications fetch failed: ${error.message}`)
  return (data ?? []) as MedicationRow[]
}

interface MedPayload {
  name: string
  dose: string | null
  frequency: string | null
  notes: string | null
}

function clean(p: Partial<MedPayload>): MedPayload | { error: string } {
  const name = (p.name ?? '').trim()
  if (!name) return { error: 'Medication name is required.' }
  return {
    name,
    dose: p.dose?.trim() || null,
    frequency: p.frequency?.trim() || null,
    notes: p.notes?.trim() || null,
  }
}

export async function createMedication(payload: MedPayload): Promise<MedActionResult> {
  try {
    await requireSession()
    const c = clean(payload)
    if ('error' in c) return { ok: false, error: c.error }
    const service = createServiceClient()
    const { error } = await service.from('medications').insert({ ...c, active: true })
    if (error) return { ok: false, error: error.message }
    revalidatePath('/medications')
    revalidatePath('/report')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function updateMedication(id: string, payload: Partial<MedPayload>): Promise<MedActionResult> {
  try {
    await requireSession()
    const c = clean(payload)
    if ('error' in c) return { ok: false, error: c.error }
    const service = createServiceClient()
    const { error } = await service
      .from('medications')
      .update({ ...c, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/medications')
    revalidatePath('/report')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/**
 * Deactivate — NEVER hard-delete. Past meds are kept for clinical
 * history (e.g. "switched off bisoprolol on 2026-08-04" is a meaningful
 * signal in itself). Toggle back to active=true via reactivateMedication.
 */
export async function deactivateMedication(id: string): Promise<MedActionResult> {
  try {
    await requireSession()
    const service = createServiceClient()
    const { error } = await service
      .from('medications')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/medications')
    revalidatePath('/report')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function reactivateMedication(id: string): Promise<MedActionResult> {
  try {
    await requireSession()
    const service = createServiceClient()
    const { error } = await service
      .from('medications')
      .update({ active: true, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return { ok: false, error: error.message }
    revalidatePath('/medications')
    revalidatePath('/report')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

// ─────────────────────────────────────────────────────────────
// Medication adherence — one-tap daily confirm
// ─────────────────────────────────────────────────────────────
//
// Tri-state per GST calendar day: 'taken' | 'skipped' | 'cleared'.
// 'cleared' is the undo state — never delete (gotcha #103 family).
// All reads / math filter out 'cleared' → it's "no record" by design.
//
// Honesty rule: unknown ≠ missed. The two surfaced numbers stay
// separate (adherence-of-logged + coverage); we never collapse them
// into one alarming "low adherence" %.

/**
 * Today's calendar date in Asia/Dubai (UTC+4, no DST — fixed offset).
 * Returns 'YYYY-MM-DD'. Don't trust the server's UTC date — a late-night
 * tap from Irfan near UTC midnight would land on the wrong GST day.
 * (Gotcha #31 — all day-bucketing across the platform uses GST.)
 */
function gstTodayISO(): string {
  const now = Date.now()
  const dubaiMs = now + 4 * 60 * 60 * 1000
  return new Date(dubaiMs).toISOString().slice(0, 10)
}

/** Walk back N GST days from today; index 0 = today, N-1 = oldest. */
function gstDaysBack(n: number): string[] {
  const today = gstTodayISO()
  const todayMs = Date.parse(today + 'T00:00:00Z')
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(new Date(todayMs - i * 86400000).toISOString().slice(0, 10))
  }
  return out
}

export type AdherenceStatus = 'taken' | 'skipped' | 'cleared'
export type AdherenceDayStatus = 'taken' | 'skipped' | 'unknown'

export interface AdherenceDay {
  /** GST calendar day, YYYY-MM-DD. */
  day: string
  /** 'cleared' never surfaces — it's filtered upstream. */
  status: AdherenceDayStatus
  note: string | null
}

export interface AdherenceSummary {
  /** GST today. */
  today: string
  todayStatus: AdherenceDayStatus
  /** Consecutive 'taken' ending today; if today is unknown, ends yesterday. */
  streak: number
  /** Window length in days (typically 90 for /report, 30 for /medications, 7 for dashboard panel). */
  windowDays: number
  takenCount: number
  skippedCount: number
  /** taken + skipped (cleared excluded). */
  loggedCount: number
  /** Calendar days from max(firstEverLoggedDay, windowStart) to today, inclusive. Null when there's no record at all. */
  expectedDays: number | null
  /** taken / (taken + skipped) × 100. Null when nothing logged. */
  adherencePctOfLogged: number | null
  /** loggedCount / expectedDays × 100. Null when there's no record at all. */
  coveragePct: number | null
  /**
   * Day-by-day from oldest → newest, length = windowDays. Days with no row
   * (or a cleared row) surface as 'unknown'. Used to render the heat-strip.
   */
  days: AdherenceDay[]
  /** Has any non-cleared record EVER been written. Drives the zero-state copy. */
  hasAnyRecord: boolean
}

interface AdherenceRow {
  day: string
  status: AdherenceStatus
  note: string | null
}

async function upsertAdherence(status: AdherenceStatus, note?: string | null): Promise<MedActionResult> {
  try {
    await requireSession()
    const service = createServiceClient()
    const day = gstTodayISO()
    const { error } = await service
      .from('med_adherence')
      .upsert(
        {
          day,
          status,
          note: note ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'day' }
      )
    if (error) return { ok: false, error: error.message }
    revalidatePath('/')
    revalidatePath('/medications')
    revalidatePath('/report')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function confirmTodayMeds(): Promise<MedActionResult> {
  return upsertAdherence('taken')
}

export async function markTodaySkipped(note?: string): Promise<MedActionResult> {
  return upsertAdherence('skipped', note?.trim() || null)
}

/**
 * Undo for the day. Sets status='cleared' rather than deleting — the row
 * stays for audit but every reader filters cleared out, so the day reads
 * as "no record". (Gotcha #103 family — never delete clinical history.)
 */
export async function clearToday(): Promise<MedActionResult> {
  return upsertAdherence('cleared')
}

/**
 * Read adherence over the last `windowDays` GST days. Returns the two
 * honest numbers (adherence-of-logged + coverage) so the surface can
 * present both without conflating them. `cleared` rows are filtered out
 * everywhere — they read as 'unknown'.
 */
export async function fetchAdherence(windowDays: number = 90): Promise<AdherenceSummary> {
  const service = createServiceClient()
  const today = gstTodayISO()
  const days = gstDaysBack(windowDays).reverse() // oldest → newest
  const windowStart = days[0]

  // Pull in-window rows + the earliest non-cleared row ever (for honest
  // coverage when the window is wider than recorded history).
  const [inWindow, firstEver] = await Promise.all([
    service
      .from('med_adherence')
      .select('day, status, note')
      .gte('day', windowStart)
      .lte('day', today)
      .order('day', { ascending: true }),
    service
      .from('med_adherence')
      .select('day')
      .neq('status', 'cleared')
      .order('day', { ascending: true })
      .limit(1),
  ])

  if (inWindow.error) throw new Error(`adherence fetch failed: ${inWindow.error.message}`)

  const byDay = new Map<string, AdherenceRow>()
  for (const raw of (inWindow.data ?? []) as AdherenceRow[]) {
    byDay.set(raw.day, raw)
  }

  // Build the day list — every calendar day in the window, with cleared
  // → unknown so the heat-strip never shows the undo state.
  const dayList: AdherenceDay[] = days.map((d) => {
    const row = byDay.get(d)
    if (!row || row.status === 'cleared') return { day: d, status: 'unknown', note: null }
    return { day: d, status: row.status as AdherenceDayStatus, note: row.note }
  })

  let takenCount = 0
  let skippedCount = 0
  for (const d of dayList) {
    if (d.status === 'taken') takenCount++
    else if (d.status === 'skipped') skippedCount++
  }
  const loggedCount = takenCount + skippedCount

  const firstEverDay = (firstEver.data?.[0] as { day: string } | undefined)?.day ?? null
  const hasAnyRecord = firstEverDay !== null

  // Expected days = from max(firstEverLoggedDay, windowStart) → today.
  // Avoids "0/90" coverage when you've only been tracking for 5 days —
  // we don't punish you for days that pre-dated the feature.
  let expectedDays: number | null = null
  if (firstEverDay) {
    const start = firstEverDay > windowStart ? firstEverDay : windowStart
    const startMs = Date.parse(start + 'T00:00:00Z')
    const todayMs = Date.parse(today + 'T00:00:00Z')
    expectedDays = Math.max(1, Math.round((todayMs - startMs) / 86400000) + 1)
  }

  const adherencePctOfLogged = loggedCount > 0 ? (takenCount / loggedCount) * 100 : null
  const coveragePct = expectedDays && expectedDays > 0 ? (loggedCount / expectedDays) * 100 : null

  // Streak — consecutive 'taken' ending today, or ending yesterday if
  // today isn't logged yet (don't break a 14-day streak just because it's
  // 9am and Irfan hasn't tapped). A 'skipped' OR 'unknown' day breaks it.
  let streak = 0
  const newest = dayList[dayList.length - 1]
  let startIdx = dayList.length - 1
  if (newest && newest.status === 'unknown') {
    // skip today, start at yesterday
    startIdx = dayList.length - 2
  }
  for (let i = startIdx; i >= 0; i--) {
    if (dayList[i].status === 'taken') streak++
    else break
  }

  const todayRow = byDay.get(today)
  const todayStatus: AdherenceDayStatus =
    !todayRow || todayRow.status === 'cleared' ? 'unknown' : (todayRow.status as AdherenceDayStatus)

  return {
    today,
    todayStatus,
    streak,
    windowDays,
    takenCount,
    skippedCount,
    loggedCount,
    expectedDays,
    adherencePctOfLogged,
    coveragePct,
    days: dayList,
    hasAnyRecord,
  }
}
