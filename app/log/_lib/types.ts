// Shared types for the /log slice. EntryKind is the discriminator for
// updateEntry's payload union and the union table for the recent list.

export type EntryKind = 'weight' | 'glucose' | 'symptom' | 'note' | 'bp'

export type GlucoseUnit = 'mg/dL' | 'mmol/L'
export type BpPosition = 'sitting' | 'lying' | null

export interface WeightPayload {
  recorded_at: string  // ISO timestamp
  weight_kg: number
}

export interface GlucosePayload {
  recorded_at: string
  value: number        // as entered
  unit: GlucoseUnit
}

export interface SymptomPayload {
  recorded_at: string
  symptom_code: string
  severity: number | null  // 1–5, nullable
  note: string | null
}

export interface NotePayload {
  recorded_at: string
  text: string
}

export interface BpPayload {
  measured_at: string
  systolic_mmhg: number
  diastolic_mmhg: number
  pulse_bpm: number | null
  position: BpPosition
  arm: string | null
}

export type UpdatePayload =
  | { kind: 'weight'; id: string; payload: WeightPayload }
  | { kind: 'glucose'; id: string; payload: GlucosePayload }
  | { kind: 'symptom'; id: string; payload: SymptomPayload }
  | { kind: 'note'; id: string; payload: NotePayload }
  | { kind: 'bp'; id: string; payload: BpPayload }

export interface ActionResult {
  ok: boolean
  error?: string
}

// Shape of a row in the recent-entries list. Unified across health_observations
// and bp_readings so the UI can render a single sorted feed.
export interface RecentEntry {
  id: string
  kind: EntryKind
  occurred_at: string  // recorded_at or measured_at, whichever applies
  summary: string      // short human-readable description, e.g. "82.4 kg" or "126/78, pulse 64"
  // Raw payload echoed back so Edit can pre-fill the form without a second roundtrip.
  raw: WeightPayload | GlucosePayload | SymptomPayload | NotePayload | BpPayload
}
