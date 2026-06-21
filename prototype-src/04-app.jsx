// ============================================================
// App — composes header + 9 sections, owns all state.
// ============================================================
const { useState: uS, useMemo: uM, useReducer: uRd } = React;
const Ic = window.Icons;
const D = window.HEALTH_DATA;
const H = window.HEALTH_HELPERS;

const MMOL_TO_MGDL = 18.0182;
const RANGES = [{ id: 7, label: '7d' }, { id: 30, label: '30d' }, { id: 90, label: '90d' }];

// ---- status helpers (calm thresholds) ----
const st = {
  recovery: (v) => (v >= 58 ? 'good' : v >= 45 ? 'watch' : 'concern'),
  bp: (s, d) => (s < 130 && d < 85 ? 'good' : s < 140 && d < 90 ? 'watch' : 'concern'),
  glucose: (v) => (v >= 3.9 && v <= 10 ? 'good' : (v >= 3.3 && v < 3.9) || (v > 10 && v <= 12) ? 'watch' : 'concern'),
  sleep: (h) => (h >= 7 ? 'good' : h >= 6 ? 'watch' : 'concern'),
  rhr: (v) => (v <= 68 ? 'good' : v <= 75 ? 'watch' : 'concern'),
};

const SLEEP_KEYS = [
  { key: 'deep', label: 'Deep', color: '#6C3FA8' },
  { key: 'light', label: 'Light', color: '#C49AE0' },
  { key: 'rem', label: 'REM', color: '#9B59B6' },
  { key: 'awake', label: 'Awake', color: 'var(--text-dim)' },
];

function greeting(h) {
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it, i) => (
        <span className="legend-item" key={i}>
          <span className="legend-dash" style={{ background: it.color, ...(it.dash ? { backgroundImage: `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)`, background: 'none' } : {}) }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function App() {
  const [theme, setTheme] = uS('dark');
  const [tab, setTab] = uS('dashboard');
  const [range, setRange] = uS(30);
  const [gUnit, setGUnit] = uS('mmol/L');
  const [meds, setMeds] = uS(D.meds);
  const [entries, setEntries] = uS(D.manualEntries);

  React.useEffect(() => { document.documentElement.setAttribute('data-theme', theme); }, [theme]);

  const sliced = uM(() => D.daily.slice(-range), [range]);
  const latest = D.daily[D.daily.length - 1];
  const recoveryDay = Math.round((D.now - new Date(2026, 3, 5)) / 86400000);

  // glucose display helpers
  const toG = (v) => (gUnit === 'mmol/L' ? H.round(v, 1) : Math.round(v * MMOL_TO_MGDL));
  const gLo = 3.9, gHi = 10.0;

  // KPI sparkline series
  const sp = (key, k = 16) => D.daily.slice(-k).map((d) => (key === 'sleep' ? d.sleep.total : d[key]));

  const cgmT = D.cgmTrend;
  const tir = D.tir;

  // weight delta over range
  const wStart = sliced[0].weight, wNow = latest.weight;
  const wDelta = H.round(wNow - wStart, 1);

  const toggleMed = (id) => setMeds((ms) => ms.map((m) => (m.id === id ? { ...m, taken: !m.taken } : m)));
  const addEntry = (e) => setEntries((es) => [e, ...es]);
  const sortedEntries = uM(() => [...entries].sort((a, b) => new Date(b.time) - new Date(a.time)), [entries]);

  const sleepData = D.daily.slice(-7).map((d) => ({ label: d.date, values: d.sleep.stages }));

  return (
    <div className="app">
      {/* ---------- Header ---------- */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark"><Ic.HeartPulse size={22} /></span>
            <div className="brand-txt">
              <div className="greet">{greeting(D.now.getHours())}</div>
              <div className="greet-sub">{D.now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })} · Recovery day {recoveryDay}</div>
            </div>
          </div>
          <div className="topbar-ctrls">
            <div className="seg range-seg">
              {RANGES.map((r) => (
                <button key={r.id} className={`seg-btn ${range === r.id ? 'active' : ''}`} onClick={() => setRange(r.id)}>{r.label}</button>
              ))}
            </div>
            <button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Toggle theme">
              {theme === 'dark' ? <Ic.Sun size={18} /> : <Ic.Moon size={18} />}
            </button>
          </div>
        </div>
        <nav className="tabnav">
          <button className={`tab ${tab === 'dashboard' ? 'active' : ''}`} onClick={() => setTab('dashboard')}>
            <Ic.Activity size={15} /> Dashboard
          </button>
          <button className={`tab ${tab === 'correlations' ? 'active' : ''}`} onClick={() => setTab('correlations')}>
            <Ic.Sparkles size={15} /> Correlations
          </button>
        </nav>
      </header>

      {tab === 'dashboard' && (
      <main className="grid">
        {/* ---------- Today at a glance ---------- */}
        <Card className="col-12 glance-card">
          <PanelHeader icon={<Ic.Sparkles size={18} />} title="Today at a glance" accent="var(--teal)"
            right={<span className="muted-note">Latest readings</span>} />
          <div className="kpi-grid">
            <KpiCard icon={<Ic.Activity size={17} />} label="Recovery" value={latest.recovery} unit="%"
              status={st.recovery(latest.recovery)} spark={sp('recovery')} sub="Whoop" />
            <KpiCard icon={<Ic.HeartPulse size={17} />} label="Blood pressure" value={`${latest.sys}/${latest.dia}`} unit="mmHg"
              status={st.bp(latest.sys, latest.dia)} spark={sp('sys')} sub="Withings" />
            <KpiCard icon={<Ic.Droplet size={17} />} label="Glucose"
              value={<span className="kpi-glucose">{toG(cgmT.value)} <span className="g-arrow">{cgmT.dir === 'rising' ? <Ic.ArrowUp size={16} /> : cgmT.dir === 'falling' ? <Ic.ArrowDown size={16} /> : <Ic.ArrowRight size={16} />}</span></span>}
              unit={gUnit} status={st.glucose(cgmT.value)} spark={D.cgm.slice(-40).map((p) => p.value)} sparkColor="var(--purple)" sub="CGM · live" />
            <KpiCard icon={<Ic.Moon size={17} />} label="Sleep" value={latest.sleep.total} unit="h"
              status={st.sleep(latest.sleep.total)} spark={sp('sleep')} sparkColor="var(--purple)" sub={`${latest.sleep.performance}% performance`} />
            <KpiCard icon={<Ic.Heart size={17} />} label="Resting HR" value={latest.rhr} unit="bpm"
              status={st.rhr(latest.rhr)} spark={sp('rhr')} sub="Whoop" />
            <KpiCard icon={<Ic.Scale size={17} />} label="Weight" value={latest.weight} unit="kg"
              status="good" spark={sp('weight')} deltaText={`${Math.abs(wDelta)} kg`} deltaDir={wDelta <= 0 ? 'down' : 'up'} deltaGood={wDelta <= 0} sub={`${range}d trend`} />
          </div>
        </Card>

        {/* ---------- Cardiac panel (hero) ---------- */}
        <Card className="col-12 hero">
          <PanelHeader icon={<Ic.Heart size={18} />} title="Cardiac" source="withings" accent="var(--red)"
            right={<Legend items={[{ color: 'var(--red)', label: 'Systolic' }, { color: 'var(--teal)', label: 'Diastolic' }]} />} />
          <div className="cardiac-grid">
            <div className="cardiac-main">
              <div className="chart-caption"><span>Blood pressure</span><span className="muted-note">mmHg · healthy &lt; 120/80 · elevated zones shaded</span></div>
              <TC data={sliced} height={300} xAccessor={(d) => d.date} yDomain={[60, 160]} yTicks={5}
                bands={[
                  { from: 120, to: 130, color: 'var(--amber)', opacity: 0.07 },
                  { from: 130, to: 160, color: 'var(--red)', opacity: 0.07 },
                  { from: 60, to: 120, color: 'var(--teal)', opacity: 0.05 },
                ]}
                series={[
                  { accessor: (d) => d.sys, color: 'var(--red)', label: 'Systolic', fill: false },
                  { accessor: (d) => d.dia, color: 'var(--teal)', label: 'Diastolic', fill: false },
                ]}
                tooltipRows={(d) => [
                  { color: 'var(--red)', label: 'Systolic', value: `${d.sys} mmHg` },
                  { color: 'var(--teal)', label: 'Diastolic', value: `${d.dia} mmHg` },
                  { color: 'var(--text-muted)', label: 'Pulse', value: `${d.pulse} bpm` },
                ]} />
            </div>
            <div className="cardiac-side">
              <div className="mini-stat-row">
                <div className="mini-stat"><div className="mini-lbl">Resting HR</div><div className="mini-val">{latest.rhr}<span>bpm</span></div></div>
                <div className="mini-stat"><div className="mini-lbl">HRV</div><div className="mini-val">{latest.hrv}<span>ms</span></div></div>
              </div>
              <div className="chart-caption sm"><span>Resting HR &amp; HRV</span><Legend items={[{ color: 'var(--purple)', label: 'RHR' }, { color: 'var(--teal)', label: 'HRV' }]} /></div>
              <TC data={sliced} height={188} xAccessor={(d) => d.date} yDomain={[30, 70]} yTicks={4} maxXTicks={5} formatY={(v) => Math.round(v)}
                series={[
                  { accessor: (d) => d.rhr, color: 'var(--purple)', label: 'Resting HR', fill: true },
                  { accessor: (d) => d.hrv, color: 'var(--teal)', label: 'HRV', fill: false },
                ]}
                tooltipRows={(d) => [
                  { color: 'var(--purple)', label: 'Resting HR', value: `${d.rhr} bpm` },
                  { color: 'var(--teal)', label: 'HRV', value: `${d.hrv} ms` },
                ]} />
            </div>
          </div>
        </Card>

        {/* ---------- Glucose panel ---------- */}
        <Card className="col-7">
          <PanelHeader icon={<Ic.Droplet size={18} />} title="Glucose" source="nightscout" accent="var(--purple)"
            right={
              <div className="seg unit-seg">
                <button className={`seg-btn ${gUnit === 'mmol/L' ? 'active' : ''}`} onClick={() => setGUnit('mmol/L')}>mmol/L</button>
                <button className={`seg-btn ${gUnit === 'mg/dL' ? 'active' : ''}`} onClick={() => setGUnit('mg/dL')}>mg/dL</button>
              </div>
            } />
          <div className="glucose-top">
            <div className="glucose-now">
              <div className="g-now-val" style={{ color: STATUS_COLOR[st.glucose(cgmT.value)] }}>
                {toG(cgmT.value)}
                <span className="g-now-arrow">{cgmT.dir === 'rising' ? <Ic.ArrowUp size={22} /> : cgmT.dir === 'falling' ? <Ic.ArrowDown size={22} /> : <Ic.ArrowRight size={22} />}</span>
              </div>
              <div className="g-now-unit">{gUnit} · {cgmT.dir}</div>
              <div className="g-now-meta">Updated {window.fmtTime(D.cgm[D.cgm.length - 1].time)}</div>
            </div>
            <div className="glucose-tir">
              <DonutC size={132} thickness={18}
                segments={[
                  { value: tir.inRange, color: 'var(--teal)' },
                  { value: tir.above, color: 'var(--amber)' },
                  { value: tir.below, color: 'var(--red)' },
                ]}
                centerLabel={`${tir.inRange}%`} centerSub="in range" />
              <div className="tir-legend">
                <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--amber)' }} />Above {toG(gHi)}<b>{tir.above}%</b></div>
                <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--teal)' }} />In range<b>{tir.inRange}%</b></div>
                <div className="tir-row"><span className="tir-dot" style={{ background: 'var(--red)' }} />Below {toG(gLo)}<b>{tir.below}%</b></div>
              </div>
            </div>
          </div>
          <div className="chart-caption"><span>Last 24 hours</span><span className="muted-note">target band {toG(gLo)}–{toG(gHi)} {gUnit}</span></div>
          <CGM data={D.cgm} lo={gLo} hi={gHi} unit={gUnit} toDisplay={toG} height={216} />
        </Card>

        {/* ---------- Recovery & sleep ---------- */}
        <Card className="col-5">
          <PanelHeader icon={<Ic.Moon size={18} />} title="Recovery &amp; sleep" source="whoop" accent="var(--purple)"
            right={<div className="strain-readout"><Ic.Flame size={14} /><span>Strain {latest.strain}</span><span className="strain-sub">/21</span></div>} />
          <div className="chart-caption sm"><span>Recovery</span><span className="muted-note">{range}-day trend</span></div>
          <TC data={sliced} height={140} xAccessor={(d) => d.date} yDomain={[30, 90]} yTicks={3} maxXTicks={5} formatY={(v) => Math.round(v)}
            series={[{ accessor: (d) => d.recovery, color: 'var(--purple)', label: 'Recovery', fill: true }]} unit="%" />
          <div className="chart-caption sm" style={{ marginTop: 14 }}><span>Sleep stages · last 7 nights</span></div>
          <SB data={sleepData} keys={SLEEP_KEYS} height={170} />
          <Legend items={SLEEP_KEYS.map((k) => ({ color: k.color, label: k.label }))} />
        </Card>

        {/* ---------- Weight ---------- */}
        <Card className="col-6">
          <PanelHeader icon={<Ic.Scale size={18} />} title="Weight" source="withings" accent="var(--teal)"
            right={<span className="trend-pill" style={{ color: wDelta <= 0 ? 'var(--teal)' : 'var(--amber)' }}>{wDelta <= 0 ? <Ic.TrendingDown size={14} /> : <Ic.TrendingUp size={14} />} {Math.abs(wDelta)} kg · {range}d</span>} />
          <div className="big-stat"><span className="big-val">{latest.weight}</span><span className="big-unit">kg</span></div>
          <TC data={sliced} height={188} xAccessor={(d) => d.date} yTicks={4}
            series={[{ accessor: (d) => d.weight, color: 'var(--teal)', label: 'Weight', fill: true }]} unit=" kg" formatY={(v) => v.toFixed(1)} />
        </Card>

        {/* ---------- Medication adherence ---------- */}
        <Card className="col-6">
          <PanelHeader icon={<Ic.Pill size={18} />} title="Medication" accent="var(--teal)"
            right={<span className="muted-note">Tap to mark taken</span>} />
          <MedChecklist meds={meds} onToggle={toggleMed} adherence={D.medWeekAdherence} streak={D.medStreak} />
        </Card>

        {/* ---------- Quick-log ---------- */}
        <Card className="col-5">
          <PanelHeader icon={<Ic.NotebookPen size={18} />} title="Quick log" source="manual" accent="var(--amber)" />
          <QuickLog onAdd={addEntry} glucoseUnit={gUnit} />
        </Card>

        {/* ---------- Activity / symptom log ---------- */}
        <Card className="col-7">
          <PanelHeader icon={<Ic.Activity size={18} />} title="Recent activity" accent="var(--amber)"
            right={<span className="muted-note">{sortedEntries.length} entries</span>} />
          <Timeline entries={sortedEntries} now={D.now} />
        </Card>
      </main>
      )}

      {/* ---------- Correlations (cross-source) ---------- */}
      {tab === 'correlations' && <ConnectionsSection data={sliced} gUnit={gUnit} toG={toG} />}

      <footer className="foot">
        <Ic.Info size={13} />
        <span>Prototype with synthetic data — not medical advice. Designed for the Slice-7 personal health platform.</span>
      </footer>
    </div>
  );
}

const { Card, PanelHeader, KpiCard, MedChecklist, Timeline, QuickLog, STATUS_COLOR, ConnectionsSection } = window;
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
