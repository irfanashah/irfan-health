// ============================================================
// Presentational components: cards, KPIs, panels, med checklist,
// activity timeline, quick-log form.
// ============================================================
const { Icons: I, Sparkline: Spark, TrendChart: TC, CGMChart: CGM, Donut: DonutC, StackedBars: SB } = window;
const { useState: uS2, useMemo: uM2 } = React;

const STATUS_COLOR = { good: 'var(--teal)', watch: 'var(--amber)', concern: 'var(--red)', neutral: 'var(--text-muted)' };

// data-source identity (consistent colors so the eye learns them)
const SOURCES = {
  whoop: { label: 'Whoop', color: 'var(--purple)' },
  withings: { label: 'Withings', color: 'var(--teal)' },
  nightscout: { label: 'Nightscout CGM', color: 'var(--purple)' },
  manual: { label: 'Manual log', color: 'var(--amber)' },
};

function SourceBadge({ source }) {
  const s = SOURCES[source];
  return (
    <span className="source-badge">
      <span className="source-dot" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

function Card({ children, className = '', style, span }) {
  return <section className={`card ${className}`} style={{ ...(span ? { gridColumn: `span ${span}` } : {}), ...style }}>{children}</section>;
}

function PanelHeader({ icon, title, source, right, accent }) {
  return (
    <div className="panel-head">
      <div className="panel-head-l">
        {icon && <span className="panel-icon" style={accent ? { color: accent } : null}>{icon}</span>}
        <h2 className="panel-title">{title}</h2>
      </div>
      <div className="panel-head-r">
        {right}
        {source && <SourceBadge source={source} />}
      </div>
    </div>
  );
}

function TrendArrow({ dir, good }) {
  // dir: 'up' | 'down' | 'flat'; good: which direction is positive
  const map = { up: I.ArrowUpRight, down: I.ArrowDownRight, flat: I.ArrowRight };
  const Ico = map[dir] || I.ArrowRight;
  let color = 'var(--text-muted)';
  if (dir !== 'flat' && good) color = dir === good ? 'var(--teal)' : 'var(--amber)';
  return <Ico size={15} />;
}

// ---------------- KPI card ----------------
function KpiCard({ icon, label, value, unit, sub, spark, sparkColor, status = 'neutral', deltaText, deltaDir, deltaGood }) {
  const color = STATUS_COLOR[status];
  return (
    <div className="kpi">
      <div className="kpi-top">
        <span className="kpi-icon" style={{ color }}>{icon}</span>
        <span className="kpi-label">{label}</span>
        <span className="kpi-status-dot" style={{ background: color }} />
      </div>
      <div className="kpi-mid">
        <span className="kpi-value">{value}</span>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className="kpi-bottom">
        <div className="kpi-sub">
          {deltaText && (
            <span className="kpi-delta" style={{ color: deltaGood ? 'var(--teal)' : 'var(--amber)' }}>
              {deltaDir === 'up' ? '▲' : deltaDir === 'down' ? '▼' : ''} {deltaText}
            </span>
          )}
          {sub && <span className="kpi-subtext">{sub}</span>}
        </div>
        {spark && <div className="kpi-spark"><Spark data={spark} color={sparkColor || color} width={76} height={30} /></div>}
      </div>
    </div>
  );
}

// ---------------- Medication checklist ----------------
function MedChecklist({ meds, onToggle, adherence, streak }) {
  const takenCount = meds.filter((m) => m.taken).length;
  return (
    <div>
      <div className="med-stats">
        <div className="med-stat">
          <div className="med-stat-num" style={{ color: 'var(--teal)' }}>{takenCount}<span className="med-stat-den">/{meds.length}</span></div>
          <div className="med-stat-lbl">Today's doses</div>
        </div>
        <div className="med-stat">
          <div className="med-stat-num">{adherence}<span className="med-stat-den">%</span></div>
          <div className="med-stat-lbl">7-day adherence</div>
        </div>
        <div className="med-stat">
          <div className="med-stat-num">{streak}<span className="med-stat-den">d</span></div>
          <div className="med-stat-lbl">On-track streak</div>
        </div>
      </div>
      <div className="med-list">
        {meds.map((m) => (
          <button key={m.id} className={`med-item ${m.taken ? 'taken' : ''}`} onClick={() => onToggle(m.id)}>
            <span className={`med-check ${m.taken ? 'on' : ''}`}>{m.taken && <I.Check size={13} stroke={3} />}</span>
            <span className="med-name">{m.name}</span>
            <span className="med-dose">{m.dose}</span>
            <span className="med-sched">{m.schedule}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------- Activity timeline ----------------
const TYPE_META = {
  weight: { color: 'var(--teal)', icon: (p) => <I.Scale {...p} /> },
  glucose: { color: 'var(--purple)', icon: (p) => <I.Droplet {...p} /> },
  bp: { color: 'var(--teal)', icon: (p) => <I.HeartPulse {...p} /> },
  symptom: { color: 'var(--amber)', icon: (p) => <I.Activity {...p} /> },
  note: { color: 'var(--text-muted)', icon: (p) => <I.NotebookPen {...p} /> },
};

function relTime(d, now) {
  const diff = (now - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const days = Math.round((today - that) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (days === 0) return `Today · ${time}`;
  if (days === 1) return `Yesterday · ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} · ${time}`;
}

function SeverityDots({ n }) {
  return (
    <span className="sev-dots">
      {[1, 2, 3, 4, 5].map((i) => <span key={i} className={`sev-dot ${i <= n ? 'on' : ''}`} />)}
    </span>
  );
}

function Timeline({ entries, now }) {
  return (
    <div className="timeline">
      {entries.map((e) => {
        const meta = TYPE_META[e.type] || TYPE_META.note;
        return (
          <div key={e.id} className={`tl-item ${e.redFlag ? 'redflag' : ''}`}>
            <span className="tl-icon" style={{ color: meta.color, background: 'color-mix(in srgb, ' + (e.redFlag ? 'var(--red)' : meta.color) + ' 14%, transparent)' }}>
              {e.redFlag ? <I.AlertTriangle size={15} /> : meta.icon({ size: 15 })}
            </span>
            <div className="tl-body">
              <div className="tl-row1">
                <span className="tl-label">{e.label}</span>
                {e.value && <span className="tl-value">{e.value}</span>}
                {e.severity != null && <SeverityDots n={e.severity} />}
                <span className="tl-time">{relTime(new Date(e.time), now)}</span>
              </div>
              {e.note && <div className="tl-note">{e.note}</div>}
              {e.redFlag && (
                <div className="redflag-banner">
                  <I.AlertTriangle size={14} />
                  <span>These can be cardiac warning signs — contact your cardiologist or emergency services if they occur.</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Quick-log form ----------------
const LOG_TABS = [
  { id: 'weight', label: 'Weight' },
  { id: 'glucose', label: 'Glucose' },
  { id: 'bp', label: 'BP' },
  { id: 'symptom', label: 'Symptom' },
];

function QuickLog({ onAdd, glucoseUnit }) {
  const [tab, setTab] = uS2('weight');
  const [note, setNote] = uS2('');
  const [weight, setWeight] = uS2('');
  const [glucose, setGlucose] = uS2('');
  const [sys, setSys] = uS2('');
  const [dia, setDia] = uS2('');
  const [symptom, setSymptom] = uS2(RED_FLAG_SYMPTOMS[2]);
  const [sev, setSev] = uS2(0);
  const [flash, setFlash] = uS2(false);

  const isRedFlag = tab === 'symptom' && RED_FLAG_SYMPTOMS.includes(symptom);

  function reset() { setWeight(''); setGlucose(''); setSys(''); setDia(''); setSev(0); setNote(''); }

  function submit(e) {
    e.preventDefault();
    let entry = null;
    const time = new Date(HEALTH_DATA.now);
    if (tab === 'weight' && weight) entry = { type: 'weight', label: 'Weight', value: `${weight} kg` };
    else if (tab === 'glucose' && glucose) entry = { type: 'glucose', label: 'Fingerstick glucose', value: `${glucose} ${glucoseUnit}` };
    else if (tab === 'bp' && sys && dia) entry = { type: 'bp', label: 'Blood pressure', value: `${sys}/${dia} mmHg` };
    else if (tab === 'symptom') entry = { type: 'symptom', label: symptom, severity: sev || null, redFlag: isRedFlag };
    if (!entry) return;
    entry.note = note.trim();
    entry.time = time;
    entry.id = 'u' + Date.now();
    onAdd(entry);
    reset();
    setFlash(true); setTimeout(() => setFlash(false), 1400);
  }

  return (
    <form className="quicklog" onSubmit={submit}>
      <div className="seg">
        {LOG_TABS.map((t) => (
          <button type="button" key={t.id} className={`seg-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>

      <div className="ql-fields">
        {tab === 'weight' && (
          <label className="field"><span className="field-lbl">Weight</span>
            <div className="input-unit"><input type="number" step="0.1" inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="88.5" /><span>kg</span></div>
          </label>
        )}
        {tab === 'glucose' && (
          <label className="field"><span className="field-lbl">Fingerstick glucose</span>
            <div className="input-unit"><input type="number" step="0.1" inputMode="decimal" value={glucose} onChange={(e) => setGlucose(e.target.value)} placeholder={glucoseUnit === 'mmol/L' ? '6.1' : '110'} /><span>{glucoseUnit}</span></div>
          </label>
        )}
        {tab === 'bp' && (
          <div className="bp-fields">
            <label className="field"><span className="field-lbl">Systolic</span>
              <div className="input-unit"><input type="number" inputMode="numeric" value={sys} onChange={(e) => setSys(e.target.value)} placeholder="122" /><span>mmHg</span></div>
            </label>
            <span className="bp-slash">/</span>
            <label className="field"><span className="field-lbl">Diastolic</span>
              <div className="input-unit"><input type="number" inputMode="numeric" value={dia} onChange={(e) => setDia(e.target.value)} placeholder="79" /><span>mmHg</span></div>
            </label>
          </div>
        )}
        {tab === 'symptom' && (
          <div className="sym-fields">
            <label className="field"><span className="field-lbl">Symptom</span>
              <div className="select-wrap">
                <select value={symptom} onChange={(e) => setSymptom(e.target.value)}>
                  <optgroup label="Common">
                    <option>Mild fatigue</option><option>Headache</option><option>Swelling (ankles)</option><option>Poor sleep</option>
                  </optgroup>
                  <optgroup label="Cardiac warning signs">
                    {RED_FLAG_SYMPTOMS.map((s) => <option key={s}>{s}</option>)}
                  </optgroup>
                </select>
                <I.ChevronDown size={15} />
              </div>
            </label>
            <label className="field"><span className="field-lbl">Severity <span className="field-opt">(optional)</span></span>
              <div className="sev-pick">
                {[1, 2, 3, 4, 5].map((i) => (
                  <button type="button" key={i} className={`sev-btn ${sev >= i ? 'on' : ''} ${sev === i ? 'sel' : ''}`} onClick={() => setSev(sev === i ? 0 : i)}>{i}</button>
                ))}
              </div>
            </label>
          </div>
        )}
      </div>

      {isRedFlag && (
        <div className="redflag-banner inline">
          <I.AlertTriangle size={14} />
          <span>These can be cardiac warning signs — contact your cardiologist or emergency services if they occur. You can still log it below.</span>
        </div>
      )}

      <label className="field"><span className="field-lbl">Quick note</span>
        <input className="note-input" type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an optional note…" />
      </label>

      <div className="ql-actions">
        <button type="submit" className={`btn-primary ${flash ? 'flash' : ''}`}>
          {flash ? <><I.Check size={16} stroke={2.5} /> Added to log</> : <><I.Plus size={16} stroke={2.5} /> Add entry</>}
        </button>
      </div>
    </form>
  );
}

Object.assign(window, { Card, PanelHeader, SourceBadge, KpiCard, MedChecklist, Timeline, QuickLog, TrendArrow, STATUS_COLOR, SOURCES, relTime });
