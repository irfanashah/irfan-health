// Symptom controlled vocabulary. Stored as extras.symptom_code on the
// health_observations row. Grouped for the dropdown. red_flag = true marks
// symptoms matching Irfan's cardiologist emergency guidance.
//
// Extending the list: add an entry here. No migration required — metric_type
// vocabulary is application-validated text (data-model spec §2).

export type SymptomGroup =
  | 'cardiac'
  | 'respiratory'
  | 'general'
  | 'gi'
  | 'neuro'
  | 'other'

export interface SymptomDef {
  code: string
  label: string
  group: SymptomGroup
  red_flag?: boolean
}

export const SYMPTOMS: readonly SymptomDef[] = [
  // Cardiac / circulatory
  { code: 'chest_pain', label: 'Chest pain', group: 'cardiac', red_flag: true },
  { code: 'chest_tightness', label: 'Chest tightness', group: 'cardiac', red_flag: true },
  { code: 'palpitations', label: 'Palpitations / racing heart', group: 'cardiac' },
  { code: 'dizziness_standing', label: 'Dizziness on standing/walking', group: 'cardiac', red_flag: true },
  { code: 'lightheadedness', label: 'Lightheadedness (general)', group: 'cardiac' },
  { code: 'syncope', label: 'Fainting / blackout', group: 'cardiac' },
  { code: 'ankle_swelling', label: 'Ankle or leg swelling (oedema)', group: 'cardiac' },

  // Respiratory
  { code: 'shortness_of_breath', label: 'Shortness of breath / breathlessness', group: 'respiratory', red_flag: true },
  { code: 'breathlessness_exertion', label: 'Breathlessness on exertion', group: 'respiratory' },
  { code: 'cough', label: 'Cough', group: 'respiratory' },
  { code: 'wheezing', label: 'Wheezing', group: 'respiratory' },

  // General
  { code: 'fatigue', label: 'Fatigue / unusual tiredness', group: 'general' },
  { code: 'weakness', label: 'Generalised weakness', group: 'general' },
  { code: 'sweating', label: 'Cold sweat / sweating (diaphoresis)', group: 'general' },
  { code: 'fever', label: 'Fever', group: 'general' },
  { code: 'chills', label: 'Chills', group: 'general' },

  // Gastrointestinal
  { code: 'nausea', label: 'Nausea', group: 'gi' },
  { code: 'vomiting', label: 'Vomiting', group: 'gi' },
  { code: 'indigestion', label: 'Indigestion / heartburn', group: 'gi' },
  { code: 'appetite_loss', label: 'Loss of appetite', group: 'gi' },

  // Neurological
  { code: 'headache', label: 'Headache', group: 'neuro' },
  { code: 'blurred_vision', label: 'Blurred vision', group: 'neuro' },
  { code: 'numbness_tingling', label: 'Numbness or tingling', group: 'neuro' },

  // Other
  { code: 'poor_sleep', label: 'Poor sleep', group: 'other' },
  { code: 'anxiety', label: 'Anxiety / unease', group: 'other' },
  { code: 'other', label: 'Other (requires note)', group: 'other' },
]

export const GROUP_LABELS: Record<SymptomGroup, string> = {
  cardiac: 'Cardiac / circulatory',
  respiratory: 'Respiratory',
  general: 'General',
  gi: 'Gastrointestinal',
  neuro: 'Neurological',
  other: 'Other',
}

// Calm, factual reminder shown when a red_flag symptom is selected. Does not
// block submission, does not diagnose, does not trigger anything external.
// Mirrors handover §2 (early-warning routes to hospital; data system is for
// drift, not acute alarms).
export const RED_FLAG_REMINDER =
  "Your cardiologist's guidance: chest pain, shortness of breath, chest tightness, or dizziness while standing or walking means go to hospital immediately. This log is for tracking, not for emergencies."

export function getSymptom(code: string): SymptomDef | undefined {
  return SYMPTOMS.find((s) => s.code === code)
}

export function isValidSymptomCode(code: string): boolean {
  return SYMPTOMS.some((s) => s.code === code)
}
