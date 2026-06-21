export function SeverityDots({ n }: { n: number }) {
  return (
    <span className="sev-dots">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`sev-dot ${i <= n ? 'on' : ''}`} />
      ))}
    </span>
  )
}
