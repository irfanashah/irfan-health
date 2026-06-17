// Helpers for <input type="datetime-local"> ⇄ ISO timestamp round-trips.

export function nowLocalForInput(): string {
  const d = new Date()
  return toLocalInput(d)
}

export function toLocalInput(d: Date): string {
  // YYYY-MM-DDTHH:mm in local time (what datetime-local expects).
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    'T' + pad(d.getHours()) +
    ':' + pad(d.getMinutes())
  )
}

export function fromLocalInput(local: string): string {
  // Browser parses local time correctly when there's no Z suffix.
  return new Date(local).toISOString()
}

export function formatStamp(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
