export type SourceKey = 'whoop' | 'withings' | 'nightscout' | 'manual' | 'oxylink'

const SOURCES: Record<SourceKey, { label: string; color: string }> = {
  whoop:      { label: 'Whoop',          color: 'var(--purple)' },
  withings:   { label: 'Withings',       color: 'var(--teal)'   },
  nightscout: { label: 'Nightscout CGM', color: 'var(--purple)' },
  manual:     { label: 'Manual log',     color: 'var(--amber)'  },
  oxylink:    { label: 'Oxylink',        color: 'var(--teal)'   },
}

export function SourceBadge({ source }: { source: SourceKey }) {
  const s = SOURCES[source]
  return (
    <span className="source-badge">
      <span className="source-dot" style={{ background: s.color }} />
      {s.label}
    </span>
  )
}
