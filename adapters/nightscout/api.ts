// Typed Nightscout REST client.
// Single endpoint we use: GET /api/v1/entries.json, filtered to sgv only.
// Auth is a static read token passed as `token=` query param — NOT OAuth.

export interface NightscoutEntry {
  _id: string                    // stable Mongo ObjectId — our source_record_id
  type: string                   // 'sgv' | 'mbg' | 'cal' | ... — we only consume sgv
  sgv?: number                   // mg/dL (present on sgv entries)
  date: number                   // epoch ms, UTC
  dateString?: string
  device?: string                // e.g. 'xDrip-DexcomG7', 'clarity-import'
  direction?: string             // trend; may be absent on backfilled rows
  noise?: number                 // may be absent
  // Nightscout passes through other fields per device; we ignore them.
  [key: string]: unknown
}

export interface NightscoutConfig {
  url: string
  token: string
}

export function getNightscoutConfig(): NightscoutConfig {
  const rawUrl = process.env.NIGHTSCOUT_URL
  const token = process.env.NIGHTSCOUT_TOKEN
  if (!rawUrl) throw new Error('NIGHTSCOUT_URL not set')
  if (!token) throw new Error('NIGHTSCOUT_TOKEN not set')
  // Defensive: strip a trailing slash so we can join cleanly below.
  const url = rawUrl.replace(/\/+$/, '')
  return { url, token }
}

export interface GetEntriesArgs {
  fromDate: Date
  toDate: Date
  /** Hard cap on entries returned per call. NS default is 10 — must override. */
  count?: number
}

/**
 * Fetch sgv entries in [fromDate, toDate]. Caller is responsible for windowing
 * the call (e.g. 30-day chunks during a full-history refill) since CGM is dense.
 */
export async function getEntries(
  args: GetEntriesArgs
): Promise<NightscoutEntry[]> {
  const { url, token } = getNightscoutConfig()
  const { fromDate, toDate, count = 100000 } = args

  const params = new URLSearchParams({
    token,
    'find[type]': 'sgv',
    'find[date][$gte]': String(fromDate.getTime()),
    'find[date][$lte]': String(toDate.getTime()),
    count: String(count),
  })

  const res = await fetch(`${url}/api/v1/entries.json?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    // Don't cache cron/refill traffic.
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(
      `Nightscout GET /api/v1/entries.json ${res.status}: ${body.slice(0, 200)}`
    )
  }

  const data = (await res.json()) as unknown
  if (!Array.isArray(data)) {
    throw new Error('Nightscout returned non-array body for entries.json')
  }
  return data as NightscoutEntry[]
}
