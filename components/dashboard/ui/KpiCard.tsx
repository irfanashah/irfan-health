import { Sparkline } from '../charts/Sparkline'
import { STATUS_COLOR, type Status } from '../thresholds'

interface Props {
  icon: React.ReactNode
  label: string
  value: React.ReactNode      // number | string | ReactNode (glucose embeds a trend arrow)
  unit?: React.ReactNode
  sub?: React.ReactNode
  spark?: number[]
  sparkColor?: string
  status?: Status
  deltaText?: string
  deltaDir?: 'up' | 'down'
  deltaGood?: boolean
}

export function KpiCard({
  icon,
  label,
  value,
  unit,
  sub,
  spark,
  sparkColor,
  status = 'neutral',
  deltaText,
  deltaDir,
  deltaGood,
}: Props) {
  const color = STATUS_COLOR[status]
  const isEmpty = value === null || value === undefined || value === '—'
  return (
    <div className={`kpi ${isEmpty ? 'kpi-empty' : ''}`}>
      <div className="kpi-top">
        <span className="kpi-icon" style={{ color }}>{icon}</span>
        <span className="kpi-label">{label}</span>
        <span className="kpi-status-dot" style={{ background: color }} />
      </div>
      <div className="kpi-mid">
        <span className="kpi-value">{isEmpty ? '—' : value}</span>
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
      <div className="kpi-bottom">
        <div className="kpi-sub">
          {deltaText && (
            <span
              className="kpi-delta"
              style={{ color: deltaGood ? 'var(--teal)' : 'var(--amber)' }}
            >
              {deltaDir === 'up' ? '▲' : deltaDir === 'down' ? '▼' : ''} {deltaText}
            </span>
          )}
          {sub && <span className="kpi-subtext">{sub}</span>}
        </div>
        {spark && spark.length > 0 && (
          <div className="kpi-spark">
            <Sparkline data={spark} color={sparkColor || color} width={76} height={30} />
          </div>
        )}
      </div>
    </div>
  )
}
