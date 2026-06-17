import { createServiceClient } from '@/lib/supabase/service'
import { getSymptom } from './symptoms'
import type { EntryKind, GlucoseUnit, RecentEntry, BpPosition } from './types'

const SOURCE_SLUG = 'manual'
const PER_TABLE_LIMIT = 30   // pull more than 20 from each table; merge + cap to 20 in memory

interface HoRow {
  id: string
  recorded_at: string | null
  metric_type: string
  numeric_value: number | string | null
  unit: string | null
  canonical_value: number | string | null
  canonical_unit: string | null
  extras: Record<string, unknown> | null
}

interface BpRow {
  id: string
  measured_at: string
  systolic_mmhg: number
  diastolic_mmhg: number
  pulse_bpm: number | null
  position: BpPosition | null
  extras: Record<string, unknown> | null
}

export async function fetchRecentManual(limit = 20): Promise<RecentEntry[]> {
  const supabase = createServiceClient()

  const [hoRes, bpRes] = await Promise.all([
    supabase
      .from('health_observations')
      .select('id, recorded_at, metric_type, numeric_value, unit, canonical_value, canonical_unit, extras')
      .eq('source_slug', SOURCE_SLUG)
      .order('recorded_at', { ascending: false })
      .limit(PER_TABLE_LIMIT),
    supabase
      .from('bp_readings')
      .select('id, measured_at, systolic_mmhg, diastolic_mmhg, pulse_bpm, position, extras')
      .eq('source_slug', SOURCE_SLUG)
      .order('measured_at', { ascending: false })
      .limit(PER_TABLE_LIMIT),
  ])

  if (hoRes.error) throw new Error(`recent observations fetch: ${hoRes.error.message}`)
  if (bpRes.error) throw new Error(`recent bp fetch: ${bpRes.error.message}`)

  const fromHo: RecentEntry[] = (hoRes.data ?? [])
    .map((r) => mapHoRow(r as HoRow))
    .filter((e): e is RecentEntry => e !== null)

  const fromBp: RecentEntry[] = (bpRes.data ?? [])
    .map((r) => mapBpRow(r as BpRow))
    .filter((e): e is RecentEntry => e !== null)

  return [...fromHo, ...fromBp]
    .sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1))
    .slice(0, limit)
}

function mapHoRow(r: HoRow): RecentEntry | null {
  if (!r.recorded_at) return null
  const num = r.numeric_value === null ? null : Number(r.numeric_value)  // gotcha #8 — numeric round-trips as string
  const canon = r.canonical_value === null ? null : Number(r.canonical_value)

  switch (r.metric_type) {
    case 'weight':
      if (num === null) return null
      return {
        id: r.id,
        kind: 'weight',
        occurred_at: r.recorded_at,
        summary: `${num} kg`,
        raw: { recorded_at: r.recorded_at, weight_kg: num },
      }
    case 'glucose_fingerstick':
      if (num === null) return null
      return {
        id: r.id,
        kind: 'glucose',
        occurred_at: r.recorded_at,
        summary:
          r.unit === 'mg/dL'
            ? `${num} mg/dL (≈ ${canon ?? '?'} mmol/L)`
            : `${num} mmol/L`,
        raw: {
          recorded_at: r.recorded_at,
          value: num,
          unit: (r.unit === 'mg/dL' ? 'mg/dL' : 'mmol/L') as GlucoseUnit,
        },
      }
    case 'symptom': {
      const code = (r.extras?.symptom_code as string) ?? ''
      const def = getSymptom(code)
      const label = def?.label ?? (r.extras?.symptom_label as string) ?? code
      const note = (r.extras?.note as string | null) ?? null
      const sev = num
      return {
        id: r.id,
        kind: 'symptom',
        occurred_at: r.recorded_at,
        summary: sev !== null ? `${label} · ${sev}/5` : label,
        raw: { recorded_at: r.recorded_at, symptom_code: code, severity: sev, note },
      }
    }
    case 'note': {
      const text = (r.extras?.text as string) ?? ''
      return {
        id: r.id,
        kind: 'note',
        occurred_at: r.recorded_at,
        summary: truncate(text, 80),
        raw: { recorded_at: r.recorded_at, text },
      }
    }
    default:
      return null
  }
}

function mapBpRow(r: BpRow): RecentEntry | null {
  const pulse = r.pulse_bpm !== null ? `, pulse ${r.pulse_bpm}` : ''
  const pos = r.position ? ` (${r.position})` : ''
  return {
    id: r.id,
    kind: 'bp',
    occurred_at: r.measured_at,
    summary: `${r.systolic_mmhg}/${r.diastolic_mmhg}${pulse}${pos}`,
    raw: {
      measured_at: r.measured_at,
      systolic_mmhg: r.systolic_mmhg,
      diastolic_mmhg: r.diastolic_mmhg,
      pulse_bpm: r.pulse_bpm,
      position: r.position,
      arm: (r.extras?.arm as string) ?? null,
    },
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…'
}

export function kindLabel(k: EntryKind): string {
  switch (k) {
    case 'weight': return 'Weight'
    case 'glucose': return 'Glucose'
    case 'symptom': return 'Symptom'
    case 'note': return 'Note'
    case 'bp': return 'BP'
  }
}
