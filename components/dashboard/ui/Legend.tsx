interface LegendItem {
  color: string
  label: string
  dash?: boolean
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((it, i) => (
        <span className="legend-item" key={i}>
          <span
            className="legend-dash"
            style={
              it.dash
                ? {
                    backgroundImage: `repeating-linear-gradient(90deg, ${it.color} 0 4px, transparent 4px 7px)`,
                  }
                : { background: it.color }
            }
          />
          {it.label}
        </span>
      ))}
    </div>
  )
}
