// ============================================================
// SVG chart primitives — thin lines, subtle grid, shaded bands,
// smooth hover tooltips. No chart-junk. currentColor-aware.
// ============================================================
const { useState: _uS, useRef: _uR, useEffect: _uE, useMemo: _uM, useCallback: _uC } = React;

// measure container width responsively
function useMeasure() {
  const ref = _uR(null);
  const [w, setW] = _uS(0);
  _uE(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setW(e.contentRect.width);
    });
    ro.observe(ref.current);
    setW(ref.current.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtTime = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => d.toLocaleDateString([], { month: 'short', day: 'numeric' });
const fmtDayShort = (d) => d.toLocaleDateString([], { weekday: 'short' });

// build smooth-ish path via straight segments (clean & precise) or monotone curve
function linePath(pts) {
  if (!pts.length) return '';
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' ');
}
// monotone cubic-ish smoothing
function smoothPath(pts) {
  if (pts.length < 2) return linePath(pts);
  let d = `M${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 < pts.length ? i + 2 : i + 1];
    const t = 0.18;
    const c1x = p1.x + (p2.x - p0.x) * t;
    const c1y = p1.y + (p2.y - p0.y) * t;
    const c2x = p2.x - (p3.x - p1.x) * t;
    const c2y = p2.y - (p3.y - p1.y) * t;
    d += ` C${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }
  return d;
}

// ---------------- Sparkline (tiny, no axes) ----------------
function Sparkline({ data, color = 'var(--teal)', width = 96, height = 34, fill = true }) {
  if (!data || data.length === 0) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const pad = (max - min) * 0.15 || 1;
  const lo = min - pad, hi = max + pad;
  const n = data.length;
  const pts = data.map((v, i) => ({
    x: (i / (n - 1)) * width,
    y: height - ((v - lo) / (hi - lo)) * height,
  }));
  const d = smoothPath(pts);
  const gid = _uM(() => 'spark' + Math.random().toString(36).slice(2), []);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={`${d} L${width} ${height} L0 ${height} Z`} fill={`url(#${gid})`} stroke="none" />}
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[n - 1].x} cy={pts[n - 1].y} r="2.6" fill={color} />
    </svg>
  );
}

// ---------------- TrendChart (multi-series line + bands) ----------------
function TrendChart({
  data, xAccessor, series, bands = [], height = 260,
  yDomain, yTicks = 4, formatY = (v) => v, formatX = fmtDay,
  tooltipRows, unit = '', maxXTicks = 7,
}) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = _uS(null);
  const width = w || 600;
  const m = { top: 14, right: 14, bottom: 26, left: 38 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const n = data.length;

  const allVals = [];
  for (const s of series) for (const d of data) { const v = s.accessor(d); if (v != null) allVals.push(v); }
  for (const b of bands) { allVals.push(b.from, b.to); }
  let lo = yDomain ? yDomain[0] : Math.min(...allVals);
  let hi = yDomain ? yDomain[1] : Math.max(...allVals);
  if (!yDomain) { const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad; }

  const xOf = (i) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const yOf = (v) => m.top + ih - ((v - lo) / (hi - lo)) * ih;

  const ticks = [];
  for (let i = 0; i <= yTicks; i++) ticks.push(lo + ((hi - lo) * i) / yTicks);

  const xTickIdx = [];
  const step = Math.max(1, Math.ceil(n / maxXTicks));
  for (let i = 0; i < n; i += step) xTickIdx.push(i);
  if (xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1);

  const onMove = _uC((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - m.left;
    const idx = Math.round(clampN((x / iw) * (n - 1), 0, n - 1));
    setHover(idx);
  }, [iw, n]);

  function clampN(v, a, b) { return Math.max(a, Math.min(b, v)); }

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* shaded zones */}
        {bands.map((b, i) => (
          <rect key={'b' + i} x={m.left} y={yOf(b.to)} width={iw} height={Math.max(0, yOf(b.from) - yOf(b.to))}
            fill={b.color} opacity={b.opacity != null ? b.opacity : 0.08} />
        ))}
        {/* gridlines + y labels */}
        {ticks.map((t, i) => (
          <g key={'g' + i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={m.left - 8} y={yOf(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--text-dim)">{formatY(t)}</text>
          </g>
        ))}
        {/* x labels */}
        {xTickIdx.map((i) => (
          <text key={'x' + i} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-dim)">
            {formatX(xAccessor(data[i]), i)}
          </text>
        ))}
        {/* series */}
        {series.map((s, si) => {
          const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(s.accessor(d)) }));
          return (
            <g key={'s' + si}>
              {s.fill && (
                <path d={`${smoothPath(pts)} L${pts[n - 1].x} ${m.top + ih} L${pts[0].x} ${m.top + ih} Z`}
                  fill={s.color} opacity="0.10" stroke="none" />
              )}
              <path d={smoothPath(pts)} fill="none" stroke={s.color} strokeWidth={s.width || 2.2}
                strokeDasharray={s.dash || 'none'} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          );
        })}
        {/* hover guide */}
        {hover != null && (
          <g>
            <line x1={xOf(hover)} y1={m.top} x2={xOf(hover)} y2={m.top + ih} stroke="var(--text-dim)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            {series.map((s, si) => (
              <circle key={'h' + si} cx={xOf(hover)} cy={yOf(s.accessor(data[hover]))} r="3.8" fill="var(--surface)" stroke={s.color} strokeWidth="2.4" />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <Tooltip x={xOf(hover)} width={width}
          title={formatX(xAccessor(data[hover]), hover)}
          rows={tooltipRows
            ? tooltipRows(data[hover])
            : series.map((s) => ({ color: s.color, label: s.label, value: `${formatY(s.accessor(data[hover]))}${unit}` }))} />
      )}
    </div>
  );
}

// ---------------- Tooltip (HTML overlay) ----------------
function Tooltip({ x, width, title, rows }) {
  const left = clampNum(x, 70, width - 70);
  return (
    <div className="chart-tip" style={{ left, transform: 'translate(-50%, 0)' }}>
      <div className="chart-tip-title">{title}</div>
      {rows.map((r, i) => (
        <div className="chart-tip-row" key={i}>
          <span className="chart-tip-dot" style={{ background: r.color }} />
          <span className="chart-tip-label">{r.label}</span>
          <span className="chart-tip-val">{r.value}</span>
        </div>
      ))}
    </div>
  );
}
function clampNum(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ---------------- CGM Area chart (time x-axis, target band) ----------------
function CGMChart({ data, lo = 3.9, hi = 10.0, unit = 'mmol/L', toDisplay = (v) => v, height = 240, markers = [] }) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = _uS(null);
  const [hoverMk, setHoverMk] = _uS(null);
  const width = w || 700;
  const m = { top: 14, right: 14, bottom: 26, left: 40 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const n = data.length;

  const vals = data.map((d) => d.value);
  let dLo = Math.min(...vals, lo), dHi = Math.max(...vals, hi);
  dLo = Math.floor(dLo - 0.6); dHi = Math.ceil(dHi + 0.6);

  const xOf = (i) => m.left + (i / (n - 1)) * iw;
  const yOf = (v) => m.top + ih - ((v - dLo) / (dHi - dLo)) * ih;
  const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.value) }));

  // hour ticks
  const xticks = [];
  for (let i = 0; i < n; i++) {
    const t = data[i].time;
    if (t.getMinutes() === 0 && t.getHours() % 4 === 0) xticks.push(i);
  }

  const yticks = [];
  const yStep = (dHi - dLo) <= 8 ? 2 : 3;
  for (let v = dLo; v <= dHi; v += yStep) yticks.push(v);

  const gid = _uM(() => 'cgm' + Math.random().toString(36).slice(2), []);

  // map markers (by time) to x; nearest sample for y
  const t0 = data[0].time.getTime();
  const tN = data[n - 1].time.getTime();
  const mk = markers.map((mm) => {
    const tt = new Date(mm.time).getTime();
    const frac = clampNum((tt - t0) / (tN - t0), 0, 1);
    const di = Math.round(frac * (n - 1));
    return { ...mm, x: xOf(di), gy: yOf(data[di].value), val: data[di].value };
  }).filter((mm) => { const tt = new Date(mm.time).getTime(); return tt >= t0 && tt <= tN; });

  const onMove = _uC((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - m.left;
    const idx = Math.round(clampNum((x / iw) * (n - 1), 0, n - 1));
    setHover(idx);
  }, [iw, n]);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--purple)" stopOpacity="0.30" />
            <stop offset="100%" stopColor="var(--purple)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* target band */}
        <rect x={m.left} y={yOf(hi)} width={iw} height={Math.max(0, yOf(lo) - yOf(hi))} fill="var(--teal)" opacity="0.10" />
        <line x1={m.left} y1={yOf(hi)} x2={m.left + iw} y2={yOf(hi)} stroke="var(--teal)" strokeWidth="1" strokeDasharray="4 4" opacity="0.45" />
        <line x1={m.left} y1={yOf(lo)} x2={m.left + iw} y2={yOf(lo)} stroke="var(--teal)" strokeWidth="1" strokeDasharray="4 4" opacity="0.45" />
        {/* y grid + labels */}
        {yticks.map((t, i) => (
          <g key={'y' + i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={m.left - 8} y={yOf(t) + 3.5} textAnchor="end" fontSize="10.5" fill="var(--text-dim)">{toDisplay(t)}</text>
          </g>
        ))}
        {/* x labels */}
        {xticks.map((i) => (
          <text key={'x' + i} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-dim)">
            {data[i].time.toLocaleTimeString([], { hour: 'numeric' })}
          </text>
        ))}
        {/* area + line */}
        <path d={`${smoothPath(pts)} L${pts[n - 1].x} ${m.top + ih} L${pts[0].x} ${m.top + ih} Z`} fill={`url(#${gid})`} stroke="none" />
        <path d={smoothPath(pts)} fill="none" stroke="var(--purple)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        {/* event markers */}
        {mk.map((mm, i) => {
          const col = mm.redFlag ? 'var(--red)' : mm.kind === 'meal' ? 'var(--amber)' : mm.kind === 'activity' ? 'var(--teal)' : 'var(--text-muted)';
          const active = hoverMk === i;
          return (
            <g key={'mk' + i} onMouseEnter={() => setHoverMk(i)} onMouseLeave={() => setHoverMk(null)} style={{ cursor: 'default' }}>
              <line x1={mm.x} y1={m.top} x2={mm.x} y2={m.top + ih} stroke={col} strokeWidth={mm.redFlag ? 1.4 : 1} strokeDasharray="3 3" opacity={active ? 0.85 : 0.4} />
              <circle cx={mm.x} cy={m.top} r={active ? 11 : 9} fill="var(--surface)" stroke={col} strokeWidth="1.5" />
              {mm.redFlag
                ? <path d="M0 4 L5 -5 L-5 -5 Z" transform={`translate(${mm.x} ${m.top + 1})`} fill={col} />
                : <circle cx={mm.x} cy={m.top} r="3.2" fill={col} />}
              <circle cx={mm.x} cy={mm.gy} r="3" fill={col} stroke="var(--surface)" strokeWidth="1.5" />
            </g>
          );
        })}
        {hover != null && (
          <g>
            <line x1={xOf(hover)} y1={m.top} x2={xOf(hover)} y2={m.top + ih} stroke="var(--text-dim)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={xOf(hover)} cy={yOf(data[hover].value)} r="4" fill="var(--surface)" stroke="var(--purple)" strokeWidth="2.4" />
          </g>
        )}
      </svg>
      {hover != null && (
        <Tooltip x={xOf(hover)} width={width}
          title={fmtTime(data[hover].time)}
          rows={[{ color: 'var(--purple)', label: 'Glucose', value: `${toDisplay(data[hover].value)} ${unit}` }]} />
      )}
      {hoverMk != null && mk[hoverMk] && (
        <Tooltip x={mk[hoverMk].x} width={width}
          title={fmtTime(mk[hoverMk].time)}
          rows={[
            { color: mk[hoverMk].redFlag ? 'var(--red)' : mk[hoverMk].kind === 'meal' ? 'var(--amber)' : 'var(--teal)', label: mk[hoverMk].label, value: `${toDisplay(mk[hoverMk].val)} ${unit}` },
            ...(mk[hoverMk].detail ? [{ color: 'transparent', label: mk[hoverMk].detail, value: '' }] : []),
          ]} />
      )}
    </div>
  );
}

// ---------------- Donut (time-in-range) ----------------
function Donut({ segments, size = 150, thickness = 20, centerLabel, centerSub }) {
  const r = (size - thickness) / 2;
  const cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--grid)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const frac = s.value / total;
          const len = frac * circ;
          const el = (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${len} ${circ - len}`} strokeDashoffset={-offset} strokeLinecap="butt" />
          );
          offset += len;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{centerLabel}</div>
        {centerSub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{centerSub}</div>}
      </div>
    </div>
  );
}

// ---------------- Stacked bars (sleep stages) ----------------
function StackedBars({ data, keys, height = 200, formatX = fmtDayShort, unit = 'h' }) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = _uS(null);
  const width = w || 500;
  const m = { top: 12, right: 8, bottom: 24, left: 30 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const n = data.length;
  const totals = data.map((d) => keys.reduce((a, k) => a + d.values[k.key], 0));
  const maxT = Math.max(...totals) * 1.05;
  const yOf = (v) => m.top + ih - (v / maxT) * ih;
  const bw = Math.min(34, (iw / n) * 0.62);
  const xOf = (i) => m.left + (i + 0.5) * (iw / n);

  const yticks = [0, maxT / 2, maxT];

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {yticks.map((t, i) => (
          <g key={i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={m.left - 6} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-dim)">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          let yAcc = 0;
          return (
            <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={xOf(i) - (iw / n) / 2} y={m.top} width={iw / n} height={ih} fill="transparent" />
              {keys.map((k, ki) => {
                const v = d.values[k.key];
                const h = (v / maxT) * ih;
                const y = m.top + ih - yAcc - h;
                yAcc += h;
                const top = ki === keys.length - 1;
                return <rect key={ki} x={xOf(i) - bw / 2} y={y} width={bw} height={Math.max(0, h - 1)} fill={k.color}
                  rx={top ? 3 : 0} opacity={hover == null || hover === i ? 1 : 0.45} />;
              })}
              <text x={xOf(i)} y={height - 7} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{formatX(d.label)}</text>
            </g>
          );
        })}
      </svg>
      {hover != null && (
        <Tooltip x={xOf(hover)} width={width}
          title={typeof data[hover].label === 'string' ? data[hover].label : fmtDay(data[hover].label)}
          rows={[...keys].reverse().map((k) => ({ color: k.color, label: k.label, value: `${data[hover].values[k.key].toFixed(1)}${unit}` }))} />
      )}
    </div>
  );
}

// ---------------- Stats helpers ----------------
function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return 0;
  let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sxx += xs[i] * xs[i]; syy += ys[i] * ys[i]; }
  const cov = sxy - (sx * sy) / n;
  const vx = sxx - (sx * sx) / n;
  const vy = syy - (sy * sy) / n;
  if (vx <= 0 || vy <= 0) return 0;
  return cov / Math.sqrt(vx * vy);
}
function linReg(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxy += xs[i] * ys[i]; sxx += xs[i] * xs[i]; }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const intercept = (sy - slope * sx) / n;
  return { slope, intercept };
}

// ---------------- ScatterChart (A vs B + fit line) ----------------
function ScatterChart({ points, xLabel, yLabel, xUnit = '', yUnit = '', color = 'var(--teal)', height = 240, fmtX = (v) => v, fmtY = (v) => v }) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = _uS(null);
  const width = w || 460;
  const m = { top: 14, right: 16, bottom: 38, left: 46 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;

  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  let xLo = Math.min(...xs), xHi = Math.max(...xs), yLo = Math.min(...ys), yHi = Math.max(...ys);
  const px = (xHi - xLo) * 0.08 || 1, py = (yHi - yLo) * 0.08 || 1;
  xLo -= px; xHi += px; yLo -= py; yHi += py;
  const xOf = (v) => m.left + ((v - xLo) / (xHi - xLo)) * iw;
  const yOf = (v) => m.top + ih - ((v - yLo) / (yHi - yLo)) * ih;

  const { slope, intercept } = linReg(xs, ys);
  const lx1 = xLo, lx2 = xHi;
  const ly1 = slope * lx1 + intercept, ly2 = slope * lx2 + intercept;

  const xticks = [xLo + (xHi - xLo) * 0.1, (xLo + xHi) / 2, xHi - (xHi - xLo) * 0.1];
  const yticks = [yLo + (yHi - yLo) * 0.12, (yLo + yHi) / 2, yHi - (yHi - yLo) * 0.12];

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {yticks.map((t, i) => (
          <g key={'y' + i}>
            <line x1={m.left} y1={yOf(t)} x2={m.left + iw} y2={yOf(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={m.left - 7} y={yOf(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-dim)">{fmtY(t)}</text>
          </g>
        ))}
        {xticks.map((t, i) => (
          <text key={'x' + i} x={xOf(t)} y={height - 20} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{fmtX(t)}</text>
        ))}
        {/* fit line */}
        <line x1={xOf(lx1)} y1={yOf(ly1)} x2={xOf(lx2)} y2={yOf(ly2)} stroke={color} strokeWidth="2" strokeDasharray="5 4" opacity="0.9" />
        {/* points */}
        {points.map((p, i) => (
          <circle key={i} cx={xOf(p.x)} cy={yOf(p.y)} r={hover === i ? 5 : 3.4}
            fill={color} opacity={hover == null ? 0.55 : hover === i ? 1 : 0.28}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} />
        ))}
        {/* axis titles */}
        <text x={m.left + iw / 2} y={height - 4} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--text-muted)">{xLabel}{xUnit ? ` (${xUnit})` : ''}</text>
        <text x={12} y={m.top + ih / 2} textAnchor="middle" fontSize="10.5" fontWeight="600" fill="var(--text-muted)" transform={`rotate(-90 12 ${m.top + ih / 2})`}>{yLabel}{yUnit ? ` (${yUnit})` : ''}</text>
      </svg>
      {hover != null && (
        <Tooltip x={xOf(points[hover].x)} width={width}
          title={points[hover].label || ''}
          rows={[
            { color: 'var(--text-muted)', label: xLabel, value: `${fmtX(points[hover].x)}${xUnit ? ' ' + xUnit : ''}` },
            { color: color, label: yLabel, value: `${fmtY(points[hover].y)}${yUnit ? ' ' + yUnit : ''}` },
          ]} />
      )}
    </div>
  );
}

// ---------------- DualAxisChart (two series, independent y-axes) ----------------
function DualAxisChart({ data, xAccessor, a, b, height = 240, formatX = fmtDay, maxXTicks = 7 }) {
  const [ref, w] = useMeasure();
  const [hover, setHover] = _uS(null);
  const width = w || 600;
  const m = { top: 14, right: 46, bottom: 26, left: 46 };
  const iw = Math.max(10, width - m.left - m.right);
  const ih = height - m.top - m.bottom;
  const n = data.length;

  function domain(acc) {
    const vs = data.map(acc); let lo = Math.min(...vs), hi = Math.max(...vs);
    const p = (hi - lo) * 0.14 || 1; return [lo - p, hi + p];
  }
  const [aLo, aHi] = domain(a.accessor);
  const [bLo, bHi] = domain(b.accessor);
  const xOf = (i) => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const aY = (v) => m.top + ih - ((v - aLo) / (aHi - aLo)) * ih;
  const bY = (v) => m.top + ih - ((v - bLo) / (bHi - bLo)) * ih;

  const aPts = data.map((d, i) => ({ x: xOf(i), y: aY(a.accessor(d)) }));
  const bPts = data.map((d, i) => ({ x: xOf(i), y: bY(b.accessor(d)) }));

  const xTickIdx = [];
  const step = Math.max(1, Math.ceil(n / maxXTicks));
  for (let i = 0; i < n; i += step) xTickIdx.push(i);
  if (xTickIdx[xTickIdx.length - 1] !== n - 1) xTickIdx.push(n - 1);

  const aTicks = [aLo + (aHi - aLo) * 0.1, (aLo + aHi) / 2, aHi - (aHi - aLo) * 0.1];
  const bTicks = [bLo + (bHi - bLo) * 0.1, (bLo + bHi) / 2, bHi - (bHi - bLo) * 0.1];

  const onMove = _uC((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left - m.left;
    setHover(Math.round(clampNum((x / iw) * (n - 1), 0, n - 1)));
  }, [iw, n]);

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {[0.5].map((f, i) => (
          <line key={i} x1={m.left} y1={m.top + ih * f} x2={m.left + iw} y2={m.top + ih * f} stroke="var(--grid)" strokeWidth="1" />
        ))}
        {aTicks.map((t, i) => (
          <text key={'a' + i} x={m.left - 7} y={aY(t) + 3.5} textAnchor="end" fontSize="10" fill={a.color} opacity="0.9">{a.fmt ? a.fmt(t) : Math.round(t)}</text>
        ))}
        {bTicks.map((t, i) => (
          <text key={'b' + i} x={m.left + iw + 7} y={bY(t) + 3.5} textAnchor="start" fontSize="10" fill={b.color} opacity="0.9">{b.fmt ? b.fmt(t) : Math.round(t)}</text>
        ))}
        {xTickIdx.map((i) => (
          <text key={'x' + i} x={xOf(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="var(--text-dim)">{formatX(xAccessor(data[i]), i)}</text>
        ))}
        <path d={smoothPath(aPts)} fill="none" stroke={a.color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d={smoothPath(bPts)} fill="none" stroke={b.color} strokeWidth="2.2" strokeDasharray="5 4" strokeLinecap="round" strokeLinejoin="round" />
        {hover != null && (
          <g>
            <line x1={xOf(hover)} y1={m.top} x2={xOf(hover)} y2={m.top + ih} stroke="var(--text-dim)" strokeWidth="1" strokeDasharray="3 3" opacity="0.6" />
            <circle cx={xOf(hover)} cy={aY(a.accessor(data[hover]))} r="3.8" fill="var(--surface)" stroke={a.color} strokeWidth="2.4" />
            <circle cx={xOf(hover)} cy={bY(b.accessor(data[hover]))} r="3.8" fill="var(--surface)" stroke={b.color} strokeWidth="2.4" />
          </g>
        )}
      </svg>
      {hover != null && (
        <Tooltip x={xOf(hover)} width={width}
          title={formatX(xAccessor(data[hover]), hover)}
          rows={[
            { color: a.color, label: a.label, value: `${a.fmt ? a.fmt(a.accessor(data[hover])) : a.accessor(data[hover])}${a.unit ? ' ' + a.unit : ''}` },
            { color: b.color, label: b.label, value: `${b.fmt ? b.fmt(b.accessor(data[hover])) : b.accessor(data[hover])}${b.unit ? ' ' + b.unit : ''}` },
          ]} />
      )}
    </div>
  );
}

Object.assign(window, { Sparkline, TrendChart, CGMChart, Donut, StackedBars, ScatterChart, DualAxisChart, pearson, linReg, useMeasure, fmtTime, fmtDay, fmtDayShort });
