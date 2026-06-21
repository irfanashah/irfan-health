import { SourceBadge, type SourceKey } from './SourceBadge'

interface Props {
  icon?: React.ReactNode
  title: string
  source?: SourceKey
  right?: React.ReactNode
  accent?: string
}

export function PanelHeader({ icon, title, source, right, accent }: Props) {
  return (
    <div className="panel-head">
      <div className="panel-head-l">
        {icon && <span className="panel-icon" style={accent ? { color: accent } : undefined}>{icon}</span>}
        <h2 className="panel-title">{title}</h2>
      </div>
      <div className="panel-head-r">
        {right}
        {source && <SourceBadge source={source} />}
      </div>
    </div>
  )
}
