'use client'

interface Segment {
  value: number
  color: string
}

interface Props {
  segments: Segment[]
  size?: number
  thickness?: number
  centerLabel?: React.ReactNode
  centerSub?: React.ReactNode
}

/** Stroke-dasharray donut. Ported from prototype-src/06-charts.jsx::Donut. */
export function Donut({
  segments,
  size = 150,
  thickness = 20,
  centerLabel,
  centerSub,
}: Props) {
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  const circ = 2 * Math.PI * r
  const total = segments.reduce((a, s) => a + s.value, 0) || 1

  // Precompute each arc's length + cumulative starting offset BEFORE
  // building any JSX — no mutation of a running total during the render map.
  const lens = segments.map((s) => (s.value / total) * circ)
  const offsets = lens.reduce<number[]>((acc, len, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + lens[i - 1])
    return acc
  }, [])

  const arcs = segments.map((s, i) => (
    <circle
      key={i}
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke={s.color}
      strokeWidth={thickness}
      strokeDasharray={`${lens[i]} ${circ - lens[i]}`}
      strokeDashoffset={-offsets[i]}
      strokeLinecap="butt"
    />
  ))

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--grid)" strokeWidth={thickness} />
        {arcs}
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {centerLabel}
        </div>
        {centerSub && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>{centerSub}</div>
        )}
      </div>
    </div>
  )
}
