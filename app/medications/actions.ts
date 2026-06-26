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
