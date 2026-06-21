// ============================================================
// Connections — cross-source views that combine data layers
// into single pictures to reveal relationships.
// ============================================================
const { useState: cS, useMemo: cM } = React;
const CI = window.Icons;
const CD = window.HEALTH_DATA;
const CH = window.HEALTH_HELPERS;
const { Card: CCard, PanelHeader: CPanelHeader, SourceBadge: CSourceBadge } = window;
const { ScatterChart: Scatter, DualAxisChart: DualAxis, CGMChart: CGMc, TrendChart: TCc, pearson: corr } = window;

// ---------- Metric catalog (any source selectable) ----------
const METRICS = [
  { id: 'sleepHours', label: 'Sleep hours', short: 'Sleep', unit: 'h', source: 'whoop', color: 'var(--purple)', acc: (d) => d.sleep.total, fmt: (v) => v.toFixed(1), better: 'high' },
  { id: 'sleepQuality', label: 'Sleep quality', short: 'Sleep quality', unit: '%', source: 'whoop', color: 'var(--purple)', acc: (d) => d.sleep.performance, fmt: (v) => Math.round(v), better: 'high' },
  { id: 'recovery', label: 'Recovery', short: 'Recovery', unit: '%', source: 'whoop', color: 'var(--purple)', acc: (d) => d.recovery, fmt: (v) => Math.round(v), better: 'high' },
  { id: 'hrv', label: 'HRV', short: 'HRV', unit: 'ms', source: 'whoop', color: 'var(--teal)', acc: (d) => d.hrv, fmt: (v) => Math.round(v), better: 'high' },
  { id: 'rhr', label: 'Resting HR', short: 'Resting HR', unit: 'bpm', source: 'whoop', color: 'var(--purple)', acc: (d) => d.rhr, fmt: (v) => Math.round(v), better: 'low' },
  { id: 'strain', label: 'Strain', short: 'Strain', unit: '', source: 'whoop', color: 'var(--amber)', acc: (d) => d.strain, fmt: (v) => v.toFixed(1), better: 'low' },
  { id: 'sys', label: 'Systolic BP', short: 'Systolic', unit: 'mmHg', source: 'withings', color: 'var(--red)', acc: (d) => d.sys, fmt: (v) => Math.round(v), better: 'low' },
  { id: 'dia', label: 'Diastolic BP', short: 'Diastolic', unit: 'mmHg', source: 'withings', color: 'var(--teal)', acc: (d) => d.dia, fmt: (v) => Math.round(v), better: 'low' },
  { id: 'pulse', label: 'Pulse', short: 'Pulse', unit: 'bpm', source: 'withings', color: 'var(--teal)', acc: (d) => d.pulse, fmt: (v) => Math.round(v), better: 'low' },
  { id: 'fasting', label: 'Fasting glucose', short: 'Fasting glucose', unit: 'mmol/L', source: 'nightscout', color: 'var(--purple)', acc: (d) => d.fasting, fmt: (v) => v.toFixed(1), better: 'low' },
  { id: 'tir', label: 'Glucose time-in-range', short: 'Time-in-range', unit: '%', source: 'nightscout', color: 'var(--amber)', acc: (d) => d.tir, fmt: (v) => Math.round(v), better: 'high' },
  { id: 'weight', label: 'Weight', short: 'Weight', unit: 'kg', source: 'withings', color: 'var(--teal)', acc: (d) => d.weight, fmt: (v) => v.toFixed(1), better: 'low' },
];
const M = Object.fromEntries(METRICS.map((m) => [m.id, m]));

const PRESETS = [
  { a: 'sleepHours', b: 'sys', label: 'Sleep → systolic' },
  { a: 'strain', b: 'recovery', label: 'Strain → recovery' },
  { a: 'sleepHours', b: 'fasting', label: 'Sleep → glucose' },
  { a: 'weight', b: 'sys', label: 'Weight → BP' },
  { a: 'hrv', b: 'recovery', label: 'HRV → recovery' },
];

function strengthWord(r) {
  const a = Math.abs(r);
  if (a >= 0.6) return 'strong';
  if (a >= 0.4) return 'moderate';
  if (a >= 0.2) return 'mild';
  return 'weak';
}

// tertile-based, data-driven plain-language insight
function buildInsight(data, A, B) {
  const xs = data.map(A.acc), ys = data.map(B.acc);
  const r = corr(xs, ys);
  const order = xs.map((_, i) => i).sort((i, j) => xs[i] - xs[j]);
  const k = Math.max(2, Math.floor(order.length / 3));
  const low = order.slice(0, k), high = order.slice(-k);
  const meanB = (arr) => arr.reduce((s, i) => s + ys[i], 0) / arr.length;
  const meanX = (arr) => arr.reduce((s, i) => s + xs[i], 0) / arr.length;
  const lowB = meanB(low), highB = meanB(high);
  const diff = highB - lowB;
  const dispDiff = Math.abs(B.id === 'sleepHours' || B.id === 'fasting' || B.id === 'strain' || B.id === 'weight' ? diff : Math.round(diff));
  const lowXv = A.fmt(meanX(low)), highXv = A.fmt(meanX(high));

  // direction phrasing relative to "higher A"
  const dir = diff >= 0 ? 'higher' : 'lower';
  const word = strengthWord(r);
  const sentence =
    `On days when ${A.label.toLowerCase()} was lowest (~${lowXv}${A.unit ? ' ' + A.unit : ''}), ` +
    `${B.label.toLowerCase()} averaged ${B.fmt(lowB)}${B.unit ? ' ' + B.unit : ''} — versus ${B.fmt(highB)}${B.unit ? ' ' + B.unit : ''} ` +
    `on days it was highest (~${highXv}${A.unit ? ' ' + A.unit : ''}). A ${word} ${r >= 0 ? 'positive' : 'inverse'} link.`;
  return { r, sentence, lowB, highB };
}

function MetricSelect({ value, onChange, exclude }) {
  return (
    <div className="select-wrap conn-select">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {['whoop', 'withings', 'nightscout'].map((src) => (
          <optgroup key={src} label={src === 'whoop' ? 'Whoop' : src === 'withings' ? 'Withings' : 'Nightscout CGM'}>
            {METRICS.filter((m) => m.source === src).map((m) => (
              <option key={m.id} value={m.id} disabled={m.id === exclude}>{m.label}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <CI.ChevronDown size={15} />
    </div>
  );
}

function RBadge({ r }) {
  const a = Math.abs(r);
  const col = a >= 0.6 ? 'var(--teal)' : a >= 0.4 ? 'var(--amber)' : 'var(--text-muted)';
  return (
    <span className="r-badge" style={{ color: col, borderColor: 'color-mix(in srgb, ' + col + ' 40%, transparent)' }}>
      r = {r >= 0 ? '+' : '−'}{Math.abs(r).toFixed(2)}<span className="r-strength">{strengthWord(r)}</span>
    </span>
  );
}

// ============================================================
// 1) Correlation Explorer (flagship)
// ============================================================
function CorrelationExplorer({ data }) {
  const [aId, setAId] = cS('sleepHours');
  const [bId, setBId] = cS('sys');
  const A = M[aId], B = M[bId];

  const points = cM(() => data.map((d) => ({ x: A.acc(d), y: B.acc(d), label: window.fmtDay(d.date) })), [data, aId, bId]);
  const insight = cM(() => buildInsight(data, A, B), [data, aId, bId]);

  function applyPreset(p) { setAId(p.a); setBId(p.b); }

  return (
    <CCard className="col-12">
      <CPanelHeader icon={<CI.Sparkles size={18} />} title="Correlation Explorer" accent="var(--teal)"
        right={<span className="muted-note">Combines Whoop · Withings · Nightscout</span>} />
      <div className="corr-controls">
        <div className="corr-pick">
          <span className="corr-pick-lbl">Metric A</span>
          <MetricSelect value={aId} onChange={setAId} exclude={bId} />
        </div>
        <span className="corr-vs">vs</span>
        <div className="corr-pick">
          <span className="corr-pick-lbl">Metric B</span>
          <MetricSelect value={bId} onChange={setBId} exclude={aId} />
        </div>
        <div className="corr-presets">
          {PRESETS.map((p) => (
            <button key={p.label} className={`chip ${aId === p.a && bId === p.b ? 'active' : ''}`} onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>
      </div>

      <div className="corr-grid">
        <div className="corr-overlay">
          <div className="chart-caption sm">
            <span>Time overlay</span>
            <span className="legend">
              <span className="legend-item"><span className="legend-dash" style={{ background: A.color }} />{A.short}</span>
              <span className="legend-item"><span className="legend-dash" style={{ background: B.color, backgroundImage: `repeating-linear-gradient(90deg, ${B.color} 0 4px, transparent 4px 7px)` }} />{B.short}</span>
            </span>
          </div>
          <DualAxis data={data} xAccessor={(d) => d.date} height={250}
            a={{ accessor: A.acc, color: A.color, label: A.label, unit: A.unit, fmt: A.fmt }}
            b={{ accessor: B.acc, color: B.color, label: B.label, unit: B.unit, fmt: B.fmt }} />
        </div>
        <div className="corr-scatter">
          <div className="chart-caption sm"><span>A vs B</span><RBadge r={insight.r} /></div>
          <Scatter points={points} height={250} color={B.color}
            xLabel={A.short} yLabel={B.short} xUnit={A.unit} yUnit={B.unit}
            fmtX={A.fmt} fmtY={B.fmt} />
        </div>
      </div>

      <div className="insight">
        <span className="insight-icon"><CI.Sparkles size={16} /></span>
        <p>{insight.sentence}</p>
      </div>
    </CCard>
  );
}

// ============================================================
// 2) Cardiac Readiness composite
// ============================================================
function ReadinessComposite({ data }) {
  const [open, setOpen] = cS(false);
  const series = cM(() => data.map((d) => ({ date: d.date, score: CH.computeReadiness(d).score })), [data]);
  const today = CH.computeReadiness(data[data.length - 1]);
  const yest = data.length > 1 ? CH.computeReadiness(data[data.length - 2]).score : today.score;
  const delta = today.score - yest;
  const band = today.score >= 70 ? { c: 'var(--teal)', t: 'Strong' } : today.score >= 55 ? { c: 'var(--amber)', t: 'Moderate' } : { c: 'var(--red)', t: 'Take it easy' };

  return (
    <CCard className="col-7">
      <CPanelHeader icon={<CI.Stethoscope size={18} />} title="Cardiac Readiness" accent="var(--teal)"
        right={<span className="muted-note">Blends recovery · HRV · BP · resting HR · sleep</span>} />
      <div className="readiness-top">
        <div className="readiness-score">
          <div className="readiness-num" style={{ color: band.c }}>{today.score}</div>
          <div className="readiness-meta">
            <span className="readiness-band" style={{ color: band.c }}>{band.t}</span>
            <span className="readiness-delta" style={{ color: delta >= 0 ? 'var(--teal)' : 'var(--amber)' }}>
              {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs yesterday
            </span>
          </div>
        </div>
        <div className="readiness-chart">
          <TCc data={series} height={120} xAccessor={(d) => d.date} yDomain={[30, 90]} yTicks={3} maxXTicks={5} formatY={(v) => Math.round(v)}
            series={[{ accessor: (d) => d.score, color: 'var(--teal)', label: 'Readiness', fill: true }]} unit="" />
        </div>
      </div>
      <button className="expand-btn" onClick={() => setOpen(!open)}>
        <CI.ChevronDown size={15} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />
        {open ? 'Hide' : 'What’s driving today’s score'}
      </button>
      {open && (
        <div className="drivers">
          {today.inputs.map((inp) => {
            const up = inp.delta >= 0;
            return (
              <div className="driver" key={inp.key}>
                <span className="driver-lbl">{inp.label}</span>
                <div className="driver-bar">
                  <div className="driver-fill" style={{ width: `${inp.score}%`, background: up ? 'var(--teal)' : 'var(--amber)' }} />
                </div>
                <span className="driver-score">{inp.score}</span>
                <span className="driver-tag" style={{ color: up ? 'var(--teal)' : 'var(--amber)' }}>
                  {up ? <CI.ArrowUp size={12} /> : <CI.ArrowDown size={12} />}{up ? 'lifting' : 'dragging'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </CCard>
  );
}

// ============================================================
// 3) Sleep → next-day cascade
// ============================================================
function SleepCascade({ data }) {
  const last = data[data.length - 1];
  const prev = data[data.length - 2] || last;
  const sleepShort = last.sleep.total < 6.5;
  const items = [
    { icon: <CI.HeartPulse size={16} />, label: 'Morning BP', value: `${last.sys}/${last.dia}`, unit: 'mmHg', color: 'var(--red)',
      head: true, rel: sleepShort ? 'Short sleep nudged BP up' : 'Rested — BP settled' },
    { icon: <CI.Droplet size={16} />, label: 'Fasting glucose', value: last.fasting.toFixed(1), unit: 'mmol/L', color: 'var(--purple)',
      head: true, rel: sleepShort ? 'Higher with poor sleep' : 'Stable on good sleep' },
    { icon: <CI.Activity size={16} />, label: "Today's recovery", value: last.recovery, unit: '%', color: 'var(--purple)',
      head: false, rel: '' },
  ];
  return (
    <CCard className="col-5">
      <CPanelHeader icon={<CI.Moon size={18} />} title="Sleep → next day" accent="var(--purple)"
        right={<CSourceBadge source="whoop" />} />
      <div className="cascade-source">
        <div className="cascade-sleep">
          <div className="cascade-sleep-val">{last.sleep.total}<span>h</span></div>
          <div className="cascade-sleep-sub">{last.sleep.performance}% quality · last night</div>
        </div>
        <div className="cascade-arrow"><CI.ArrowRight size={20} /></div>
        <div className="cascade-flag" style={{ color: sleepShort ? 'var(--amber)' : 'var(--teal)' }}>
          {sleepShort ? 'Short night' : 'Well rested'}
        </div>
      </div>
      <div className="cascade-list">
        {items.map((it, i) => (
          <div className={`cascade-item ${it.head ? 'head' : ''}`} key={i}>
            <span className="cascade-ic" style={{ color: it.color }}>{it.icon}</span>
            <span className="cascade-name">{it.label}</span>
            <span className="cascade-val">{it.value}<span className="cascade-unit"> {it.unit}</span></span>
            {it.rel && <span className="cascade-rel">{it.rel}</span>}
          </div>
        ))}
      </div>
      <div className="headline-note">
        <CI.Info size={13} />
        <span>Sleep’s strongest downstream effects here are on <b>fasting glucose</b> and <b>morning blood pressure</b>.</span>
      </div>
    </CCard>
  );
}

// ============================================================
// 4) Activity → recovery pacing
// ============================================================
function ActivityPacing({ data }) {
  // pair strain[i] with next-day recovery[i+1] & rhr[i+1]
  const paired = cM(() => {
    const out = [];
    for (let i = 0; i < data.length - 1; i++) {
      out.push({ date: data[i].date, strain: data[i].strain, nextRecovery: data[i + 1].recovery, nextRhr: data[i + 1].rhr });
    }
    return out;
  }, [data]);
  const r = corr(paired.map((p) => p.strain), paired.map((p) => p.nextRecovery));
  const lastStrain = data[data.length - 1].strain;
  const advice = lastStrain > 9 ? { c: 'var(--amber)', t: 'Yesterday was a bigger day — keep today gentle.' }
    : lastStrain < 6 ? { c: 'var(--teal)', t: 'Light load yesterday — you have room to walk today.' }
    : { c: 'var(--teal)', t: 'Moderate load — a steady walk is well within range.' };

  return (
    <CCard className="col-7">
      <CPanelHeader icon={<CI.Footprints size={18} />} title="Activity → recovery pacing" accent="var(--amber)"
        right={<RBadge r={r} />} />
      <div className="chart-caption sm">
        <span>Yesterday’s strain vs next-day recovery</span>
        <span className="legend">
          <span className="legend-item"><span className="legend-dash" style={{ background: 'var(--amber)' }} />Strain</span>
          <span className="legend-item"><span className="legend-dash" style={{ background: 'var(--purple)', backgroundImage: 'repeating-linear-gradient(90deg, var(--purple) 0 4px, transparent 4px 7px)' }} />Next recovery</span>
        </span>
      </div>
      <DualAxis data={paired} xAccessor={(d) => d.date} height={210}
        a={{ accessor: (d) => d.strain, color: 'var(--amber)', label: 'Strain', unit: '', fmt: (v) => v.toFixed(1) }}
        b={{ accessor: (d) => d.nextRecovery, color: 'var(--purple)', label: 'Next-day recovery', unit: '%', fmt: (v) => Math.round(v) }} />
      <div className="pacing-advice" style={{ borderColor: 'color-mix(in srgb, ' + advice.c + ' 35%, transparent)' }}>
        <span style={{ color: advice.c }}><CI.Footprints size={16} /></span>
        <span><b>Cleared for walking only.</b> {advice.t}</span>
      </div>
    </CCard>
  );
}

// ============================================================
// 5) Event-annotated glucose timeline
// ============================================================
function AnnotatedGlucose({ gUnit, toG }) {
  const lo = 3.9, hi = 10.0;
  const t0 = CD.cgm[0].time.getTime(), tN = CD.cgm[CD.cgm.length - 1].time.getTime();
  const symptomMk = CD.manualEntries
    .filter((e) => { const t = new Date(e.time).getTime(); return t >= t0 && t <= tN && (e.type === 'symptom' || e.type === 'note'); })
    .map((e) => ({ id: e.id, time: e.time, label: e.label, detail: e.note, kind: e.type === 'symptom' ? 'symptom' : 'note', redFlag: !!e.redFlag }));
  const markers = [...CD.meals, ...symptomMk].sort((a, b) => new Date(a.time) - new Date(b.time));

  return (
    <CCard className="col-12">
      <CPanelHeader icon={<CI.Droplet size={18} />} title="Event-annotated glucose" accent="var(--purple)"
        right={<span className="muted-note">CGM · meals · symptoms · notes pinned on the curve</span>} />
      <CGMc data={CD.cgm} lo={lo} hi={hi} unit={gUnit} toDisplay={toG} height={236} markers={markers} />
      <div className="event-legend">
        {markers.map((mm) => {
          const col = mm.redFlag ? 'var(--red)' : mm.kind === 'meal' ? 'var(--amber)' : mm.kind === 'activity' ? 'var(--teal)' : 'var(--text-muted)';
          return (
            <span className={`event-chip ${mm.redFlag ? 'redflag' : ''}`} key={mm.id}>
              <span className="event-dot" style={{ background: col }} />
              {mm.redFlag && <CI.AlertTriangle size={12} />}
              <b>{mm.label}</b>
              <span className="event-time">{window.fmtTime(new Date(mm.time))}</span>
            </span>
          );
        })}
      </div>
      {markers.some((mm) => mm.redFlag) && (
        <div className="redflag-banner inline" style={{ marginTop: 12 }}>
          <CI.AlertTriangle size={14} />
          <span>A flagged symptom is pinned on today’s curve — these can be cardiac warning signs; contact your cardiologist or emergency services if they recur.</span>
        </div>
      )}
    </CCard>
  );
}

// ---------- Section wrapper ----------
function ConnectionsSection({ data, gUnit, toG }) {
  return (
    <>
      <div className="section-divider tabhead">
        <div className="section-head">
          <span className="section-kicker" style={{ color: 'var(--teal)' }}>Correlations</span>
          <h2 className="section-title">Cross-source relationships</h2>
          <p className="section-sub">Combining your devices into single views — where one signal explains another.</p>
        </div>
      </div>
      <div className="grid">
        <CorrelationExplorer data={data} />
        <ReadinessComposite data={data} />
        <SleepCascade data={data} />
        <ActivityPacing data={data} />
        <AnnotatedGlucose gUnit={gUnit} toG={toG} />
      </div>
    </>
  );
}

Object.assign(window, { ConnectionsSection });
