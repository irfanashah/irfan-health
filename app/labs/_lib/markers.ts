// Canonical lab marker registry — cardiac-first.
//
// Each entry:
//   slug          stable code-side identifier; what we store in lab_values.marker_slug
//   display       human name shown in the dashboard
//   canonicalUnit unit we store in lab_values.canonical_unit (when a standard
//                 conversion exists for this marker — null if we always pass
//                 reported through as-is)
//   keyMarker     surfaced as a curated trend chart on /labs
//   convert       optional: (value, reportedUnit) → canonical_value | null.
//                 Returns null when the reported unit is unknown / unhandled —
//                 we never guess (gotcha: don't fake conversions; flag in UI).
//
// Markers OUTSIDE this registry are still stored (raw_marker_name + value);
// they just don't get a canonical slug until added here. The registry is
// extensible — append new entries and re-deploy.
//
// Source for the conversion factors (clinical standards):
//   cholesterol (total / LDL / HDL / non-HDL): mg/dL × 0.0259 = mmol/L
//   triglycerides: mg/dL × 0.01129 = mmol/L
//   glucose: mg/dL ÷ 18.0 = mmol/L (= × 0.0555)
//   lipoprotein(a): mg/dL × 2.5 ≈ nmol/L (CONVERSION VARIES BY ASSAY — kept null;
//                                          surface the reported unit + value as-is)
//   hs-CRP: mg/L is already canonical; mg/dL × 10 = mg/L
//   HbA1c: % is canonical; mmol/mol via the NGSP-IFCC formula (kept null v1)

export interface MarkerDef {
  slug: string
  display: string
  canonicalUnit: string | null
  keyMarker: boolean
  /**
   * Marker family — controls how the Labs tab GROUPS the trend cards.
   * 'blood' = standard blood-panel markers (default when omitted).
   * 'echo'  = echocardiogram / TTE measurements (own section, cm units).
   */
  category?: 'blood' | 'echo'
  /** Convert (value, reportedUnit) → canonical_value. Return null if unit unknown. */
  convert?: (value: number, reportedUnit: string) => number | null
}

const norm = (u: string): string => u.toLowerCase().replace(/\s+/g, '').replace('μ', 'u')

const cholesterolConvert = (v: number, u: string): number | null => {
  const n = norm(u)
  if (n === 'mmol/l') return round2(v)
  if (n === 'mg/dl') return round2(v * 0.0259)
  return null
}
const triglyceridesConvert = (v: number, u: string): number | null => {
  const n = norm(u)
  if (n === 'mmol/l') return round2(v)
  if (n === 'mg/dl') return round2(v * 0.01129)
  return null
}
const glucoseConvert = (v: number, u: string): number | null => {
  const n = norm(u)
  if (n === 'mmol/l') return round2(v)
  if (n === 'mg/dl') return round2(v / 18.0)
  return null
}
const hsCrpConvert = (v: number, u: string): number | null => {
  const n = norm(u)
  if (n === 'mg/l') return round3(v)
  if (n === 'mg/dl') return round3(v * 10)
  return null
}
const identity = (canonical: string) => (v: number, u: string): number | null => {
  if (norm(u) === norm(canonical)) return v
  return null
}

// ─── Echo (TTE) unit converts ───────────────────────────────────────────────
// Chamber/wall dimensions come in cm (Fakeeh) OR mm (AFIC) depending on the
// lab. Canonical is cm; mm ÷ 10. cm passes through unchanged (gotcha #167).
const dimensionConvert = (v: number, u: string): number | null => {
  const n = norm(u)
  if (n === 'cm') return round2(v)
  if (n === 'mm') return round2(v / 10)
  return null
}
// Doppler velocities: canonical m/s; some labs print cm/s (÷100).
const velocityConvert = (v: number, u: string): number | null => {
  const n = norm(u)
  if (n === 'm/s') return round2(v)
  if (n === 'cm/s') return round2(v / 100)
  return null
}

/**
 * Midpoint of a reported numeric range string like "55-60" / "55–60%" /
 * "55 to 60" → 57.5. Returns null for a single number or non-numeric text,
 * so it only ever fires on a genuine range (gotcha #167). Used by the
 * extractor to store a headline value (e.g. an EF reported as "55–60%") as
 * its midpoint while keeping the original text for review.
 */
export function reportedRangeMidpoint(text: string): number | null {
  const m = text.match(/^\s*(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)\s*%?\s*$/i)
  if (!m) return null
  const lo = Number(m[1])
  const hi = Number(m[2])
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null
  return round2((lo + hi) / 2)
}

function round2(v: number): number { return Math.round(v * 100) / 100 }
function round3(v: number): number { return Math.round(v * 1000) / 1000 }

export const MARKER_REGISTRY: MarkerDef[] = [
  // ─── Cardiac lipids (curated key markers) ──────────────────────────
  { slug: 'total_cholesterol', display: 'Total cholesterol',  canonicalUnit: 'mmol/L', keyMarker: false, convert: cholesterolConvert },
  { slug: 'ldl',               display: 'LDL cholesterol',    canonicalUnit: 'mmol/L', keyMarker: true,  convert: cholesterolConvert },
  { slug: 'hdl',               display: 'HDL cholesterol',    canonicalUnit: 'mmol/L', keyMarker: true,  convert: cholesterolConvert },
  { slug: 'non_hdl',           display: 'Non-HDL cholesterol', canonicalUnit: 'mmol/L', keyMarker: true, convert: cholesterolConvert },
  { slug: 'triglycerides',     display: 'Triglycerides',      canonicalUnit: 'mmol/L', keyMarker: true,  convert: triglyceridesConvert },
  // Lp(a) — conversion is assay-dependent (mg/dL ↔ nmol/L not a fixed
  // factor); store as-reported, no canonical conversion in v1.
  { slug: 'lipoprotein_a',     display: 'Lipoprotein(a)',     canonicalUnit: null,     keyMarker: true },
  { slug: 'apob',              display: 'Apolipoprotein B',   canonicalUnit: 'g/L',    keyMarker: true,  convert: identity('g/L') },
  { slug: 'hs_crp',            display: 'hs-CRP',             canonicalUnit: 'mg/L',   keyMarker: true,  convert: hsCrpConvert },
  // ─── Diabetes / glucose ────────────────────────────────────────────
  { slug: 'hba1c',             display: 'HbA1c',              canonicalUnit: '%',      keyMarker: true,  convert: identity('%') },
  { slug: 'fasting_glucose',   display: 'Fasting glucose',    canonicalUnit: 'mmol/L', keyMarker: true,  convert: glucoseConvert },
  // ─── Kidney / liver / electrolytes / thyroid / iron — not key by default
  { slug: 'creatinine',        display: 'Creatinine',         canonicalUnit: 'umol/L', keyMarker: false, convert: identity('umol/L') },
  { slug: 'egfr',              display: 'eGFR',               canonicalUnit: 'mL/min/1.73m2', keyMarker: false },
  { slug: 'urea',              display: 'Urea',               canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },
  { slug: 'uric_acid',         display: 'Uric acid',          canonicalUnit: 'umol/L', keyMarker: false, convert: identity('umol/L') },
  { slug: 'alt',               display: 'ALT',                canonicalUnit: 'U/L',    keyMarker: false, convert: identity('U/L') },
  { slug: 'ast',               display: 'AST',                canonicalUnit: 'U/L',    keyMarker: false, convert: identity('U/L') },
  { slug: 'ggt',               display: 'GGT',                canonicalUnit: 'U/L',    keyMarker: false, convert: identity('U/L') },
  { slug: 'alkaline_phosphatase', display: 'Alkaline phosphatase', canonicalUnit: 'U/L', keyMarker: false, convert: identity('U/L') },
  { slug: 'bilirubin_total',   display: 'Bilirubin (total)',  canonicalUnit: 'umol/L', keyMarker: false, convert: identity('umol/L') },
  { slug: 'albumin',           display: 'Albumin',            canonicalUnit: 'g/L',    keyMarker: false, convert: identity('g/L') },
  { slug: 'tsh',               display: 'TSH',                canonicalUnit: 'mIU/L',  keyMarker: false, convert: identity('mIU/L') },
  { slug: 'free_t4',           display: 'Free T4',            canonicalUnit: 'pmol/L', keyMarker: false, convert: identity('pmol/L') },
  { slug: 'free_t3',           display: 'Free T3',            canonicalUnit: 'pmol/L', keyMarker: false, convert: identity('pmol/L') },
  { slug: 'vitamin_d',         display: 'Vitamin D (25-OH)',  canonicalUnit: 'nmol/L', keyMarker: false, convert: identity('nmol/L') },
  { slug: 'vitamin_b12',       display: 'Vitamin B12',        canonicalUnit: 'pmol/L', keyMarker: false, convert: identity('pmol/L') },
  { slug: 'ferritin',          display: 'Ferritin',           canonicalUnit: 'ug/L',   keyMarker: false, convert: identity('ug/L') },
  { slug: 'iron',              display: 'Iron',               canonicalUnit: 'umol/L', keyMarker: false, convert: identity('umol/L') },
  { slug: 'hemoglobin',        display: 'Hemoglobin',         canonicalUnit: 'g/dL',   keyMarker: false, convert: identity('g/dL') },
  { slug: 'hematocrit',        display: 'Hematocrit',         canonicalUnit: '%',      keyMarker: false, convert: identity('%') },
  { slug: 'wbc',               display: 'White blood cells',  canonicalUnit: '10^9/L', keyMarker: false },
  { slug: 'platelets',         display: 'Platelets',          canonicalUnit: '10^9/L', keyMarker: false },
  { slug: 'sodium',            display: 'Sodium',             canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },
  { slug: 'potassium',         display: 'Potassium',          canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },
  { slug: 'chloride',          display: 'Chloride',           canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },
  { slug: 'bicarbonate',       display: 'Bicarbonate',        canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },
  { slug: 'calcium',           display: 'Calcium',            canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },
  { slug: 'magnesium',         display: 'Magnesium',          canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },
  { slug: 'phosphate',         display: 'Phosphate',          canonicalUnit: 'mmol/L', keyMarker: false, convert: identity('mmol/L') },

  // ─── Echocardiogram / TTE (category:'echo' — own Labs-tab section) ─────
  // Dimensions canonical in cm (mm ÷ 10). EF is the headline (%). Velocities
  // m/s, ratios unitless, times ms, gradients/pressures mmHg. keyMarker =
  // the clinically-important both-report ones (per spec).
  { slug: 'ef',                display: 'Ejection fraction',  canonicalUnit: '%',   keyMarker: true,  category: 'echo', convert: identity('%') },
  { slug: 'ivsd',              display: 'IVSd (septal wall)', canonicalUnit: 'cm',  keyMarker: true,  category: 'echo', convert: dimensionConvert },
  { slug: 'lvpwd',             display: 'LVPWd (posterior wall)', canonicalUnit: 'cm', keyMarker: true, category: 'echo', convert: dimensionConvert },
  { slug: 'lvidd',             display: 'LVIDd (LV diastolic)', canonicalUnit: 'cm', keyMarker: true, category: 'echo', convert: dimensionConvert },
  { slug: 'lvids',             display: 'LVIDs (LV systolic)', canonicalUnit: 'cm', keyMarker: true,  category: 'echo', convert: dimensionConvert },
  { slug: 'la_diameter',       display: 'LA diameter',        canonicalUnit: 'cm',  keyMarker: true,  category: 'echo', convert: dimensionConvert },
  { slug: 'aortic_root',       display: 'Aortic root',        canonicalUnit: 'cm',  keyMarker: false, category: 'echo', convert: dimensionConvert },
  { slug: 'lvot',              display: 'LVOT diameter',      canonicalUnit: 'cm',  keyMarker: false, category: 'echo', convert: dimensionConvert },
  { slug: 'tapse',             display: 'TAPSE',              canonicalUnit: 'cm',  keyMarker: false, category: 'echo', convert: dimensionConvert },
  { slug: 'mv_e_vel',          display: 'Mitral E velocity',  canonicalUnit: 'm/s', keyMarker: false, category: 'echo', convert: velocityConvert },
  { slug: 'mv_a_vel',          display: 'Mitral A velocity',  canonicalUnit: 'm/s', keyMarker: false, category: 'echo', convert: velocityConvert },
  { slug: 'aortic_vel',        display: 'Aortic valve velocity', canonicalUnit: 'm/s', keyMarker: false, category: 'echo', convert: velocityConvert },
  // Ratios are unitless → canonicalUnit null so the trend reader uses the
  // reported numeric value directly (no unit to match). e_e_prime is the
  // diastolic-function headline → key.
  { slug: 'e_a_ratio',         display: 'E/A ratio',          canonicalUnit: null,  keyMarker: false, category: 'echo' },
  { slug: 'e_e_prime',         display: 'E/e′ ratio',         canonicalUnit: null,  keyMarker: true,  category: 'echo' },
  { slug: 'deceleration_time', display: 'Deceleration time',  canonicalUnit: 'ms',  keyMarker: false, category: 'echo', convert: identity('ms') },
  { slug: 'ivrt',              display: 'IVRT',               canonicalUnit: 'ms',  keyMarker: false, category: 'echo', convert: identity('ms') },
  { slug: 'tr_pg',             display: 'TR peak gradient',   canonicalUnit: 'mmHg', keyMarker: false, category: 'echo', convert: identity('mmHg') },
  { slug: 'rvsp',              display: 'RV systolic pressure (RVSP)', canonicalUnit: 'mmHg', keyMarker: false, category: 'echo', convert: identity('mmHg') },
  { slug: 'fractional_shortening', display: 'Fractional shortening', canonicalUnit: '%', keyMarker: false, category: 'echo', convert: identity('%') },
]

const BY_SLUG = new Map(MARKER_REGISTRY.map((m) => [m.slug, m]))

export function getMarker(slug: string): MarkerDef | undefined {
  return BY_SLUG.get(slug)
}

export const KEY_MARKER_SLUGS = MARKER_REGISTRY.filter((m) => m.keyMarker).map((m) => m.slug)

/** A marker's family; defaults to 'blood' for entries without an explicit category. */
export function markerCategory(slug: string): 'blood' | 'echo' {
  return BY_SLUG.get(slug)?.category ?? 'blood'
}

/** Echo slugs in registry order (EF first — it's declared first in the echo block). */
export const ECHO_SLUGS: readonly string[] = MARKER_REGISTRY
  .filter((m) => m.category === 'echo')
  .map((m) => m.slug)

/** Blood key-marker slugs — the existing "Key-marker trends" section (echo is grouped separately). */
export const KEY_BLOOD_SLUGS: readonly string[] = MARKER_REGISTRY
  .filter((m) => m.keyMarker && (m.category ?? 'blood') === 'blood')
  .map((m) => m.slug)

/** Echo key-marker slugs, EF first — the Echocardiogram section's hero + chamber cards. */
export const KEY_ECHO_SLUGS: readonly string[] = MARKER_REGISTRY
  .filter((m) => m.keyMarker && m.category === 'echo')
  .map((m) => m.slug)

/**
 * Apply the canonical unit + conversion (if any) to a reported value.
 * Returns null `canonical_value` when the unit is unknown / no conversion
 * available — caller stores reported as-is + flags in review (never guesses).
 */
export function toCanonical(slug: string, value: number | null, reportedUnit: string | null):
  { canonical_value: number | null; canonical_unit: string | null }
{
  if (value === null || reportedUnit === null) return { canonical_value: null, canonical_unit: null }
  const def = BY_SLUG.get(slug)
  if (!def) return { canonical_value: null, canonical_unit: null }
  if (!def.convert || !def.canonicalUnit) return { canonical_value: null, canonical_unit: def.canonicalUnit }
  const converted = def.convert(value, reportedUnit)
  if (converted === null) return { canonical_value: null, canonical_unit: def.canonicalUnit }
  return { canonical_value: converted, canonical_unit: def.canonicalUnit }
}

/** Slug list (alphabetical) the review dropdown shows. */
export const ALL_MARKER_SLUGS: readonly string[] = MARKER_REGISTRY
  .map((m) => m.slug)
  .slice()
  .sort()
