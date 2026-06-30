// GST (Asia/Dubai) calendar-day helpers.
//
// Asia/Dubai is fixed UTC+4 — no DST. Today's GST date is whatever
// `(now UTC + 4h)` lands on. Don't trust the server's UTC date — a
// late-night tap from Irfan near UTC midnight would land on the
// wrong calendar day. All day-bucketing across the platform uses GST
// (gotcha #31 in SQL; gotcha #116 in TS).
//
// Lives in `lib/` (NOT inside any `'use server'` file) so cron routes
// + the medications actions + future readers can all import it
// directly as a plain util. Originally inline in
// app/medications/actions.ts; extracted here so the adherence-
// reminder cron can share the same definition (the cron route can't
// import a function from a server-actions file).

export function gstTodayISO(): string {
  const dubaiMs = Date.now() + 4 * 60 * 60 * 1000
  return new Date(dubaiMs).toISOString().slice(0, 10)
}

/** Walk back N GST days from today; index 0 = today, N-1 = oldest. */
export function gstDaysBack(n: number): string[] {
  const today = gstTodayISO()
  const todayMs = Date.parse(today + 'T00:00:00Z')
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(new Date(todayMs - i * 86400000).toISOString().slice(0, 10))
  }
  return out
}
