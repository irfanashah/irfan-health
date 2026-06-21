interface Props {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function Card({ children, className = '', style }: Props) {
  return (
    <section className={`card ${className}`.trim()} style={style}>
      {children}
    </section>
  )
}
