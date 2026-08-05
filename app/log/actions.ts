'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import {
  WEIGHT_KG_MIN,
  WEIGHT_KG_MAX,
  GLUCOSE_MMOL_MIN,
  GLUCOSE_MMOL_MAX,
  BP_SYSTOLIC_MIN,
  BP_SYSTOLIC_MAX,
  BP_DIASTOLIC_MIN,
  BP_DIASTOLIC_MAX,
  BP_PULSE_MIN,
  BP_PULSE_MAX,
  SYMPTOM_SEVERITY_MIN,
  SYMPTOM_SEVERITY_MAX,
  inRange,
} from './_lib/ranges'
import { mgdlToMmol, roundTo1dp } from './_lib/glucose'
import { getSymptom, isValidSymptomCode } from './_lib/symptoms'
import type {
  ActionResult,
  WeightPayload,
  GlucosePayload,
  SymptomPayload,
  NotePayload,
  BpPayload,
  UpdatePayload,
  EntryKind,
} from './_lib/types'

const SOURCE_SLUG = 'manual'
const HEALTH_OBS = 'health_observations'
const BP = 'bp_readings'

async function requireSession() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    throw new Error('Unauthorised')
  }
}

function isoOrNow(input: string | undefined | null): string {
  if (!input) return new Date().toISOString()
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) {
    throw new Error('Invalid timestamp')
  }
  return d.toISOString()
}

function makeRecordId(kind: EntryKind): string {
  return `manual_${kind}_${randomUUID()}`
}

// Inserts a one-row ingestion_log marker for a manual write. Returns the id
// to stamp on the data row. Opens as status='pending' (L4): the data row's
// FK requires the log to exist first, so we can't just "insert data then
// log". Instead open pending → insert data → finalizeManualLog() writes the
// REAL outcome. Previously this wrote status='success', records_written=1
// up front, so a failed data insert left a phantom "success" audit row that
// over-counted written records and hid the failure.
async function insertManualLog(
  supabase: ReturnType<typeof createServiceClient>,
  rawPayload: unknown
): Promise<string> {
  const { data, error } = await supabase
    .from('ingestion_log')
    .insert({
      source_slug: SOURCE_SLUG,
      status: 'pending',
      records_found: 1,
      records_written: 0,
      records_skipped: 0,
      raw_payload: rawPayload,
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(`ingestion_log insert failed: ${error?.message}`)
  }
  return data.id as string
}

// Close the pending log row with the real outcome of the data insert (L4).
// Best-effort: a finalize failure is logged but never masks the actual
// create result the caller returns.
async function finalizeManualLog(
  supabase: ReturnType<typeof createServiceClient>,
  logId: string,
  errorMessage: string | null
): Promise<void> {
  const { error } = await supabase
    .from('ingestion_log')
    .update(
      errorMessage
        ? { status: 'error', records_written: 0, error_detail: errorMessage, completed_at: new Date().toISOString() }
        : { status: 'success', records_written: 1, completed_at: new Date().toISOString() }
    )
    .eq('id', logId)
  if (error) console.error(`[manual-log] finalize ${logId} failed: ${error.message}`)
}

function done(): ActionResult {
  revalidatePath('/log')
  return { ok: true }
}

function failed(error: string): ActionResult {
  return { ok: false, error }
}

// ─── Creates ───────────────────────────────────────────────────────────────

export async function createWeight(payload: WeightPayload): Promise<ActionResult> {
  try {
    await requireSession()

    const kg = Number(payload.weight_kg)
    if (!inRange(kg, WEIGHT_KG_MIN, WEIGHT_KG_MAX)) {
      return failed(`Weight must be between ${WEIGHT_KG_MIN} and ${WEIGHT_KG_MAX} kg.`)
    }
    const recordedAt = isoOrNow(payload.recorded_at)

    const supabase = createServiceClient()
    const logId = await insertManualLog(supabase, payload)

    const { error } = await supabase.from(HEALTH_OBS).insert({
      source_slug: SOURCE_SLUG,
      source_record_id: makeRecordId('weight'),
      data_shape: 'discrete',
      metric_type: 'weight',
      recorded_at: recordedAt,
      numeric_value: kg,
      unit: 'kg',
      canonical_value: kg,
      canonical_unit: 'kg',
      ingestion_log_id: logId,
    })

    await finalizeManualLog(supabase, logId, error?.message ?? null)
    if (error) return failed(error.message)
    return done()
  } catch (e) {
    return failed((e as Error).message)
  }
}

export async function createGlucose(payload: GlucosePayload): Promise<ActionResult> {
  try {
    await requireSession()

    const value = Number(payload.value)
    if (!Number.isFinite(value)) return failed('Glucose value required.')

    const mmol = payload.unit === 'mg/dL' ? mgdlToMmol(value) : roundTo1dp(value)
    if (!inRange(mmol, GLUCOSE_MMOL_MIN, GLUCOSE_MMOL_MAX)) {
      return failed(`Glucose must be between ${GLUCOSE_MMOL_MIN} and ${GLUCOSE_MMOL_MAX} mmol/L (≈36–540 mg/dL).`)
    }
    const recordedAt = isoOrNow(payload.recorded_at)

    const supabase = createServiceClient()
    const logId = await insertManualLog(supabase, payload)

    const { error } = await supabase.from(HEALTH_OBS).insert({
      source_slug: SOURCE_SLUG,
      source_record_id: makeRecordId('glucose'),
      data_shape: 'discrete',
      metric_type: 'glucose_fingerstick',
      recorded_at: recordedAt,
      numeric_value: value,
      unit: payload.unit,
      canonical_value: mmol,
      canonical_unit: 'mmol/L',
      ingestion_log_id: logId,
    })

    await finalizeManualLog(supabase, logId, error?.message ?? null)
    if (error) return failed(error.message)
    return done()
  } catch (e) {
    return failed((e as Error).message)
  }
}

export async function createSymptom(payload: SymptomPayload): Promise<ActionResult> {
  try {
    await requireSession()

    if (!isValidSymptomCode(payload.symptom_code)) {
      return failed('Unknown symptom code.')
    }
    const def = getSymptom(payload.symptom_code)!

    const note = payload.note?.trim() || null
    if (payload.symptom_code === 'other' && !note) {
      return failed('A note is required for "Other".')
    }

    let severity: number | null = null
    if (payload.severity !== null && payload.severity !== undefined) {
      const s = Number(payload.severity)
      if (!Number.isInteger(s) || !inRange(s, SYMPTOM_SEVERITY_MIN, SYMPTOM_SEVERITY_MAX)) {
        return failed(`Severity must be an integer ${SYMPTOM_SEVERITY_MIN}–${SYMPTOM_SEVERITY_MAX}.`)
      }
      severity = s
    }

    const recordedAt = isoOrNow(payload.recorded_at)

    const supabase = createServiceClient()
    const logId = await insertManualLog(supabase, payload)

    const { error } = await supabase.from(HEALTH_OBS).insert({
      source_slug: SOURCE_SLUG,
      source_record_id: makeRecordId('symptom'),
      data_shape: 'discrete',
      metric_type: 'symptom',
      recorded_at: recordedAt,
      numeric_value: severity,
      unit: null,
      canonical_value: severity,
      canonical_unit: null,
      extras: {
        symptom_code: def.code,
        symptom_label: def.label,
        group: def.group,
        red_flag: def.red_flag === true,
        note,
      },
      ingestion_log_id: logId,
    })

    await finalizeManualLog(supabase, logId, error?.message ?? null)
    if (error) return failed(error.message)
    return done()
  } catch (e) {
    return failed((e as Error).message)
  }
}

export async function createNote(payload: NotePayload): Promise<ActionResult> {
  try {
    await requireSession()

    const text = payload.text?.trim()
    if (!text) return failed('Note text required.')
    const recordedAt = isoOrNow(payload.recorded_at)

    const supabase = createServiceClient()
    const logId = await insertManualLog(supabase, payload)

    const { error } = await supabase.from(HEALTH_OBS).insert({
      source_slug: SOURCE_SLUG,
      source_record_id: makeRecordId('note'),
      data_shape: 'discrete',
      metric_type: 'note',
      recorded_at: recordedAt,
      numeric_value: null,
      unit: null,
      canonical_value: null,
      canonical_unit: null,
      extras: { text },
      ingestion_log_id: logId,
    })

    await finalizeManualLog(supabase, logId, error?.message ?? null)
    if (error) return failed(error.message)
    return done()
  } catch (e) {
    return failed((e as Error).message)
  }
}

export async function createBp(payload: BpPayload): Promise<ActionResult> {
  try {
    await requireSession()

    const sys = Number(payload.systolic_mmhg)
    const dia = Number(payload.diastolic_mmhg)
    if (!inRange(sys, BP_SYSTOLIC_MIN, BP_SYSTOLIC_MAX)) {
      return failed(`Systolic must be between ${BP_SYSTOLIC_MIN} and ${BP_SYSTOLIC_MAX} mmHg.`)
    }
    if (!inRange(dia, BP_DIASTOLIC_MIN, BP_DIASTOLIC_MAX)) {
      return failed(`Diastolic must be between ${BP_DIASTOLIC_MIN} and ${BP_DIASTOLIC_MAX} mmHg.`)
    }
    if (dia >= sys) {
      return failed('Diastolic must be lower than systolic.')
    }

    let pulse: number | null = null
    if (payload.pulse_bpm !== null && payload.pulse_bpm !== undefined) {
      const p = Number(payload.pulse_bpm)
      if (!Number.isFinite(p)) {
        pulse = null
      } else if (!inRange(p, BP_PULSE_MIN, BP_PULSE_MAX)) {
        return failed(`Pulse must be between ${BP_PULSE_MIN} and ${BP_PULSE_MAX} bpm.`)
      } else {
        pulse = Math.round(p)
      }
    }

    const position = payload.position === 'sitting' || payload.position === 'lying' ? payload.position : null
    const arm = payload.arm?.trim() || null
    const measuredAt = isoOrNow(payload.measured_at)

    const supabase = createServiceClient()
    const logId = await insertManualLog(supabase, payload)

    const { error } = await supabase.from(BP).insert({
      source_slug: SOURCE_SLUG,
      source_record_id: makeRecordId('bp'),
      measured_at: measuredAt,
      systolic_mmhg: Math.round(sys),
      diastolic_mmhg: Math.round(dia),
      pulse_bpm: pulse,
      position,
      extras: arm ? { arm } : null,
      ingestion_log_id: logId,
    })

    await finalizeManualLog(supabase, logId, error?.message ?? null)
    if (error) return failed(error.message)
    return done()
  } catch (e) {
    return failed((e as Error).message)
  }
}

// ─── Update (polymorphic) ──────────────────────────────────────────────────

// Guards: every update path verifies the target row exists AND has
// source_slug='manual'. API-sourced rows (Whoop, Withings) are immutable.
export async function updateEntry(input: UpdatePayload): Promise<ActionResult> {
  try {
    await requireSession()
    const supabase = createServiceClient()

    switch (input.kind) {
      case 'weight': {
        const kg = Number(input.payload.weight_kg)
        if (!inRange(kg, WEIGHT_KG_MIN, WEIGHT_KG_MAX)) {
          return failed(`Weight must be between ${WEIGHT_KG_MIN} and ${WEIGHT_KG_MAX} kg.`)
        }
        const recordedAt = isoOrNow(input.payload.recorded_at)
        const { error, count } = await supabase
          .from(HEALTH_OBS)
          .update({
            recorded_at: recordedAt,
            numeric_value: kg,
            unit: 'kg',
            canonical_value: kg,
            canonical_unit: 'kg',
          }, { count: 'exact' })
          .eq('id', input.id)
          .eq('source_slug', SOURCE_SLUG)
          .eq('metric_type', 'weight')
        if (error) return failed(error.message)
        if (!count) return failed('Entry not found or not editable.')
        return done()
      }

      case 'glucose': {
        const value = Number(input.payload.value)
        if (!Number.isFinite(value)) return failed('Glucose value required.')
        const mmol = input.payload.unit === 'mg/dL' ? mgdlToMmol(value) : roundTo1dp(value)
        if (!inRange(mmol, GLUCOSE_MMOL_MIN, GLUCOSE_MMOL_MAX)) {
          return failed(`Glucose must be between ${GLUCOSE_MMOL_MIN} and ${GLUCOSE_MMOL_MAX} mmol/L.`)
        }
        const recordedAt = isoOrNow(input.payload.recorded_at)
        const { error, count } = await supabase
          .from(HEALTH_OBS)
          .update({
            recorded_at: recordedAt,
            numeric_value: value,
            unit: input.payload.unit,
            canonical_value: mmol,
            canonical_unit: 'mmol/L',
          }, { count: 'exact' })
          .eq('id', input.id)
          .eq('source_slug', SOURCE_SLUG)
          .eq('metric_type', 'glucose_fingerstick')
        if (error) return failed(error.message)
        if (!count) return failed('Entry not found or not editable.')
        return done()
      }

      case 'symptom': {
        if (!isValidSymptomCode(input.payload.symptom_code)) return failed('Unknown symptom code.')
        const def = getSymptom(input.payload.symptom_code)!
        const note = input.payload.note?.trim() || null
        if (input.payload.symptom_code === 'other' && !note) {
          return failed('A note is required for "Other".')
        }
        let severity: number | null = null
        if (input.payload.severity !== null && input.payload.severity !== undefined) {
          const s = Number(input.payload.severity)
          if (!Number.isInteger(s) || !inRange(s, SYMPTOM_SEVERITY_MIN, SYMPTOM_SEVERITY_MAX)) {
            return failed(`Severity must be an integer ${SYMPTOM_SEVERITY_MIN}–${SYMPTOM_SEVERITY_MAX}.`)
          }
          severity = s
        }
        const recordedAt = isoOrNow(input.payload.recorded_at)
        const { error, count } = await supabase
          .from(HEALTH_OBS)
          .update({
            recorded_at: recordedAt,
            numeric_value: severity,
            canonical_value: severity,
            extras: {
              symptom_code: def.code,
              symptom_label: def.label,
              group: def.group,
              red_flag: def.red_flag === true,
              note,
            },
          }, { count: 'exact' })
          .eq('id', input.id)
          .eq('source_slug', SOURCE_SLUG)
          .eq('metric_type', 'symptom')
        if (error) return failed(error.message)
        if (!count) return failed('Entry not found or not editable.')
        return done()
      }

      case 'note': {
        const text = input.payload.text?.trim()
        if (!text) return failed('Note text required.')
        const recordedAt = isoOrNow(input.payload.recorded_at)
        const { error, count } = await supabase
          .from(HEALTH_OBS)
          .update({
            recorded_at: recordedAt,
            extras: { text },
          }, { count: 'exact' })
          .eq('id', input.id)
          .eq('source_slug', SOURCE_SLUG)
          .eq('metric_type', 'note')
        if (error) return failed(error.message)
        if (!count) return failed('Entry not found or not editable.')
        return done()
      }

      case 'bp': {
        const sys = Number(input.payload.systolic_mmhg)
        const dia = Number(input.payload.diastolic_mmhg)
        if (!inRange(sys, BP_SYSTOLIC_MIN, BP_SYSTOLIC_MAX)) {
          return failed(`Systolic must be between ${BP_SYSTOLIC_MIN} and ${BP_SYSTOLIC_MAX} mmHg.`)
        }
        if (!inRange(dia, BP_DIASTOLIC_MIN, BP_DIASTOLIC_MAX)) {
          return failed(`Diastolic must be between ${BP_DIASTOLIC_MIN} and ${BP_DIASTOLIC_MAX} mmHg.`)
        }
        if (dia >= sys) return failed('Diastolic must be lower than systolic.')

        let pulse: number | null = null
        if (input.payload.pulse_bpm !== null && input.payload.pulse_bpm !== undefined) {
          const p = Number(input.payload.pulse_bpm)
          if (!inRange(p, BP_PULSE_MIN, BP_PULSE_MAX)) {
            return failed(`Pulse must be between ${BP_PULSE_MIN} and ${BP_PULSE_MAX} bpm.`)
          }
          pulse = Math.round(p)
        }
        const position = input.payload.position === 'sitting' || input.payload.position === 'lying' ? input.payload.position : null
        const arm = input.payload.arm?.trim() || null
        const measuredAt = isoOrNow(input.payload.measured_at)

        const { error, count } = await supabase
          .from(BP)
          .update({
            measured_at: measuredAt,
            systolic_mmhg: Math.round(sys),
            diastolic_mmhg: Math.round(dia),
            pulse_bpm: pulse,
            position,
            extras: arm ? { arm } : null,
          }, { count: 'exact' })
          .eq('id', input.id)
          .eq('source_slug', SOURCE_SLUG)
        if (error) return failed(error.message)
        if (!count) return failed('Entry not found or not editable.')
        return done()
      }
    }
  } catch (e) {
    return failed((e as Error).message)
  }
}

// ─── Delete ────────────────────────────────────────────────────────────────

// Hard delete of a single manual row. Guard: source_slug must equal 'manual'.
// kind determines which table the id lives in (health_observations vs bp_readings).
export async function deleteEntry(id: string, kind: EntryKind): Promise<ActionResult> {
  try {
    await requireSession()
    if (!id) return failed('Missing id.')

    const supabase = createServiceClient()
    const table = kind === 'bp' ? BP : HEALTH_OBS

    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .eq('id', id)
      .eq('source_slug', SOURCE_SLUG)

    if (error) return failed(error.message)
    if (!count) return failed('Entry not found or not deletable.')
    return done()
  } catch (e) {
    return failed((e as Error).message)
  }
}
