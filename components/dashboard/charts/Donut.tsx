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

  let offset = 0
  const arcs = segments.map((s, i) => {
    const frac = s.value / total
    const len = frac * circ
    const el = (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={s.color}
        strokeWidth={thickness}
        strokeDasharray={`${len} ${circ - len}`}
        strokeDashoffset={-offset}
        strokeLinecap="butt"
      />
    )
    offset += len
    return el
  })

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
