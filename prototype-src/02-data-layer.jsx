// ============================================================
// Mock data layer — synthetic, post-cardiac-event recovery.
// Deterministic (seeded). Cross-source RELATIONSHIPS are baked in
// (not independent noise) so Connections views show real signal:
//   • short sleep  -> next-morning: higher BP, lower recovery,
//                     lower HRV, higher fasting glucose + variability
//   • higher strain -> next day: lower recovery, higher resting HR
//   • weight down over weeks -> BP gently down over same span
// Targets r ~ 0.4–0.7 (realistic, noisy — never perfect).
// Sources: Whoop · Withings · Nightscout (CGM) · Manual log
// ============================================================

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOW = new Date(2026, 5, 19, 14, 32, 0); // June 19, 2026, 14:32

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function atTime(base, h, min = 0) { const x = new Date(base); x.setHours(h, min, 0, 0); return x; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function round(v, p = 0) { const f = Math.pow(10, p); return Math.round(v * f) / f; }

function buildDailySeries() {
  const rng = mulberry32(70741);
  const N = 90;
  const days = [];
  const today0 = startOfDay(NOW);

  for (let i = N - 1; i >= 0; i--) {
    const date = addDays(today0, -i);
    const t = (N - 1 - i) / (N - 1);          // 0 (oldest) -> 1 (today)
    const prev = days[days.length - 1] || null;

    // ---------- Sleep (independent driver) ----------
    const total = round(clamp(6.0 + rng() * 2.3 + (rng() - 0.5) * 0.5, 4.9, 8.7), 1);
    const deep = total * (0.16 + rng() * 0.05);
    const rem = total * (0.20 + rng() * 0.05);
    const awake = total * (0.04 + rng() * 0.04);
    const light = total - deep - rem - awake;
    // sleep deficit signal: 0 (rested >=7.3h) .. 1 (short <=5.5h)
    const deficit = clamp((7.3 - total) / 1.8, 0, 1);
    const perf = round(clamp(95 - deficit * 32 + (rng() - 0.5) * 8, 50, 99));

    // ---------- Strain (independent), walking-only range ----------
    const strain = round(clamp(5 + rng() * 6 + (date.getDay() === 0 ? -1.5 : 0), 3.5, 12.8), 1);
    const prevStrain = prev ? prev.strain : 7.3;
    const strainLoad = clamp((prevStrain - 6.2) / 6, -0.4, 1);              // asymmetric (BP/RHR feel hard days)
    const strainLoad2 = clamp((prevStrain - 7.3) / 4.5, -1, 1);            // symmetric (recovery rewards easy days)

    // ---------- Weight: slow downward; drives BP baseline ----------
    const weight = round(91.6 - 3.3 * t + (rng() - 0.5) * 0.45, 1);
    const weightExcess = (weight - 88.2) / 4;  // ~0.85 early -> ~0 late

    // ---------- Blood pressure: weight baseline + sleep deficit ----------
    let sys = 118.5 + weightExcess * 10 + deficit * 8.5 + (rng() - 0.5) * 4.5;
    let dia = 75.5 + weightExcess * 5.5 + deficit * 4.6 + (rng() - 0.5) * 3.6;
    if (rng() < 0.06) { sys += 8 + rng() * 6; dia += 4 + rng() * 4; } // occasional spike
    sys = round(clamp(sys, 108, 152));
    dia = round(clamp(dia, 67, 96));
    const pulse = round(clamp(60 + Math.max(0, strainLoad) * 4 + (rng() - 0.5) * 6, 54, 74));

    // ---------- Recovery: hurt by sleep deficit + yesterday's strain ----------
    let recovery = 71 - deficit * 25 - strainLoad2 * 15 + t * 5 + (rng() - 0.5) * 10;
    recovery = round(clamp(recovery, 30, 86));

    // ---------- HRV: hurt by deficit + strain, improves over weeks ----------
    let hrv = 50 - deficit * 14 - Math.max(0, strainLoad2) * 6 + t * 8 + (rng() - 0.5) * 7.5;
    hrv = round(clamp(hrv, 26, 66));

    // ---------- Resting HR: raised by yesterday's strain + deficit ----------
    let rhr = 60 + Math.max(0, strainLoad) * 4.5 + deficit * 3 - t * 2 + (rng() - 0.5) * 2.6;
    rhr = round(clamp(rhr, 54, 70));

    // ---------- Glucose summaries: worse with sleep deficit ----------
    const fasting = round(clamp(5.2 + deficit * 0.82 + weightExcess * 0.3 + (rng() - 0.5) * 0.62, 4.2, 7.4), 1);
    const glucoseVar = round(clamp(1.05 + deficit * 1.0 + (rng() - 0.35) * 0.5, 0.55, 3.2), 2);
    const tir = round(clamp(93 - deficit * 26 - Math.max(0, glucoseVar - 1.4) * 9 + (rng() - 0.5) * 7, 48, 99));

    days.push({
      date,
      sys, dia, pulse, weight,
      rhr, hrv, recovery, strain,
      fasting, glucoseVar, tir,
      sleep: {
        total, performance: perf,
        stages: { light: round(light, 1), deep: round(deep, 1), rem: round(rem, 1), awake: round(awake, 1) },
      },
    });
  }
  return days;
}

// ---------- Cardiac Readiness composite (0–100) ----------
const READINESS_WEIGHTS = [
  { key: 'recovery', label: 'Recovery', weight: 0.28 },
  { key: 'hrv', label: 'HRV', weight: 0.20 },
  { key: 'bp', label: 'Morning BP', weight: 0.20 },
  { key: 'rhr', label: 'Resting HR', weight: 0.17 },
  { key: 'sleep', label: 'Sleep', weight: 0.15 },
];
function subScores(d) {
  return {
    recovery: clamp(((d.recovery - 30) / (86 - 30)) * 100, 0, 100),
    hrv: clamp(((d.hrv - 26) / (66 - 26)) * 100, 0, 100),
    rhr: clamp(((70 - d.rhr) / (70 - 54)) * 100, 0, 100),
    bp: clamp(((((140 - d.sys) / (140 - 110)) + ((90 - d.dia) / (90 - 68))) / 2) * 100, 0, 100),
    sleep: clamp(((d.sleep.total - 5) / (8.5 - 5)) * 100, 0, 100),
  };
}
function computeReadiness(d) {
  const s = subScores(d);
  let score = 0;
  for (const w of READINESS_WEIGHTS) score += s[w.key] * w.weight;
  score = round(score);
  const inputs = READINESS_WEIGHTS.map((w) => ({
    key: w.key, label: w.label, weight: w.weight,
    score: round(s[w.key]),
    delta: round(s[w.key] - score), // above/below today's blended score
  })).sort((a, b) => b.delta - a.delta);
  return { score, inputs };
}

// ---------- Nightscout CGM: 24h @ 5-min, mmol/L canonical ----------
function buildCGM() {
  const rng = mulberry32(24601);
  const pts = [];
  const stepMin = 5;
  const count = (24 * 60) / stepMin;
  const start = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
  const meals = [
    { h: 19.5, amp: 3.4, dur: 2.2 },
    { h: 8.0, amp: 3.0, dur: 2.0 },
    { h: 13.0, amp: 2.8, dur: 2.0 },
  ];
  let glucose = 5.6;
  for (let i = 0; i <= count; i++) {
    const time = new Date(start.getTime() + i * stepMin * 60000);
    const h = time.getHours() + time.getMinutes() / 60;
    let base = 5.4;
    if (h >= 0 && h < 6) base = 4.4 + (h / 6) * 0.4;
    let meal = 0;
    for (const m of meals) {
      const dt = h - m.h;
      if (dt >= -0.3 && dt < m.dur) { const x = dt / m.dur; meal += m.amp * Math.exp(-Math.pow((x - 0.32) * 2.6, 2)); }
    }
    glucose += (base + meal - glucose) * 0.28 + (rng() - 0.5) * 0.22;
    glucose = clamp(glucose, 3.3, 12.6);
    pts.push({ time, value: round(glucose, 1) });
  }
  for (const p of pts) {
    const h = p.time.getHours() + p.time.getMinutes() / 60;
    if (h > 3.4 && h < 4.1) p.value = round(clamp(p.value - 1.1, 3.5, 12), 1);
    if (h > 8.6 && h < 9.3) p.value = round(clamp(p.value + 1.3, 3.5, 12.2), 1);
  }
  return pts;
}
function cgmTrend(cgm) {
  const n = cgm.length;
  const last = cgm[n - 1].value;
  const prev = cgm[n - 4] ? cgm[n - 4].value : cgm[n - 2].value;
  const slope = (last - prev) / 3;
  let dir = 'flat';
  if (slope > 0.18) dir = 'rising'; else if (slope < -0.18) dir = 'falling';
  return { value: last, dir, slope };
}
function timeInRange(cgm, lo = 3.9, hi = 10.0) {
  let below = 0, inr = 0, above = 0;
  for (const p of cgm) { if (p.value < lo) below++; else if (p.value > hi) above++; else inr++; }
  const n = cgm.length;
  return { below: round((below / n) * 100), inRange: round((inr / n) * 100), above: round((above / n) * 100) };
}

// ---------- Meal markers (within CGM 24h window) ----------
function buildMeals() {
  const t0 = startOfDay(NOW);
  const y = addDays(t0, -1);
  return [
    { id: 'meal-dinner', kind: 'meal', label: 'Dinner', detail: 'Grilled salmon, greens', time: atTime(y, 19, 30) },
    { id: 'meal-bfast', kind: 'meal', label: 'Breakfast', detail: 'Oats & berries', time: atTime(t0, 8, 0) },
    { id: 'meal-walk', kind: 'activity', label: 'Morning walk', detail: '30 min, flat', time: atTime(t0, 10, 15) },
    { id: 'meal-lunch', kind: 'meal', label: 'Lunch', detail: 'Chicken & rice bowl', time: atTime(t0, 13, 0) },
  ];
}

// ---------- Medication regimen ----------
const MEDS = [
  { id: 'aspirin', name: 'Aspirin', dose: '100mg', schedule: 'Morning', taken: true },
  { id: 'brilinta-am', name: 'Brilinta', dose: '90mg', schedule: 'Morning', taken: true },
  { id: 'brilinta-pm', name: 'Brilinta', dose: '90mg', schedule: 'Evening', taken: false },
  { id: 'crestor', name: 'Crestor', dose: '40mg', schedule: 'Morning', taken: true },
  { id: 'ezetrol', name: 'Ezetrol', dose: '10mg', schedule: 'Morning', taken: true },
  { id: 'concor', name: 'Concor', dose: '5mg', schedule: 'Morning', taken: true },
  { id: 'tritace', name: 'Tritace', dose: '10mg', schedule: 'Morning', taken: false },
  { id: 'pantozol', name: 'Pantozol', dose: '40mg', schedule: 'Before food', taken: true },
];
const MED_WEEK_ADHERENCE = 94;
const MED_STREAK_DAYS = 11;

// ---------- Manual log entries ----------
function buildManualEntries() {
  const t0 = startOfDay(NOW);
  return [
    { id: 'm0', type: 'symptom', time: atTime(t0, 6, 50), label: 'Chest tightness', severity: 1, redFlag: true,
      note: 'Brief tightness on waking, faded within a minute. Resting HR normal.' },
    { id: 'm1', type: 'symptom', time: atTime(t0, 11, 5), label: 'Mild fatigue', severity: 2, redFlag: false,
      note: 'A little tired after morning walk, settled after resting.' },
    { id: 'm2', type: 'bp', time: atTime(t0, 7, 42), label: 'Blood pressure', value: '122/79 mmHg', note: 'Seated, left arm.' },
    { id: 'm3', type: 'glucose', time: atTime(addDays(t0, -1), 20, 12), label: 'Fingerstick glucose', value: '6.1 mmol/L', note: 'Before bed.' },
    { id: 'm4', type: 'weight', time: atTime(addDays(t0, -1), 7, 18), label: 'Weight', value: '88.6 kg', note: '' },
    { id: 'm5', type: 'note', time: atTime(addDays(t0, -2), 18, 0), label: 'Note', note: '30-minute flat walk, felt strong. No chest discomfort.' },
    { id: 'm6', type: 'symptom', time: atTime(addDays(t0, -3), 16, 30), label: 'Shortness of breath', severity: 2, redFlag: true,
      note: 'Slightly short of breath climbing two flights — eased within a minute.' },
    { id: 'm7', type: 'bp', time: atTime(addDays(t0, -4), 8, 6), label: 'Blood pressure', value: '127/82 mmHg', note: '' },
  ];
}

const HEALTH_DATA = (function () {
  const daily = buildDailySeries();
  const cgm = buildCGM();
  return {
    now: NOW,
    daily, cgm,
    cgmTrend: cgmTrend(cgm),
    tir: timeInRange(cgm),
    meds: MEDS,
    medWeekAdherence: MED_WEEK_ADHERENCE,
    medStreak: MED_STREAK_DAYS,
    manualEntries: buildManualEntries(),
    meals: buildMeals(),
    readinessToday: computeReadiness(daily[daily.length - 1]),
  };
})();

const RED_FLAG_SYMPTOMS = [
  'Chest pain', 'Chest tightness', 'Shortness of breath',
  'Dizziness standing', 'Dizziness walking', 'Palpitations',
];

const HEALTH_HELPERS = { clamp, round, addDays, startOfDay, atTime, computeReadiness, subScores, READINESS_WEIGHTS };

Object.assign(window, { HEALTH_DATA, RED_FLAG_SYMPTOMS, HEALTH_HELPERS });
