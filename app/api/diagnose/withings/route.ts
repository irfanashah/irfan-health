import { NextRequest, NextResponse } from 'next/server'
import { createClient as createServerSupabase } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getTokens } from '@/adapters/_lib/token-store'
import {
  ensureFreshToken,
  fetchBpMeasureGroups,
  MEAS_TYPE_DIASTOLIC,
  MEAS_TYPE_SYSTOLIC,
  MEAS_TYPE_PULSE,
  type WithingsMeasureGroup,
} from '@/adapters/withings/api'

export const runtime = 'nodejs'
export const maxDuration = 800

const DEFAULT_FROM = '2025-01-01T00:00:00.000Z'

// Must match adapters/withings/index.ts ACCEPTED_ATTRIB. Kept identical inline
// so this route stays self-contained for the diagnostic narrative.
const ACCEPTED_ATTRIB = new Set<number>([0, 1, 2])

interface DiagnoseBody {
  fromDate?: string
  toDate?: string
}

interface DiagnoseResult {
  windowStart: string
  windowEnd: string
  withings: {
    totalGroups: number
    validBp: number
    skipped: {
      onlyPulse: number
      wrongAttrib: number
      partialOrNoBp: number
    }
  }
  bpReadingsInDb: number
  gap: number // validBp − bpReadingsInDb
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabaseUser = await createServerSupabase()
  const {
    data: { user },
    error: authError,
  } = await supabaseUser.auth.getUser()

  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const body = ((await request.json().catch(() => ({}))) as DiagnoseBody) ?? {}
  const fromDate = new Date(body.fromDate ?? DEFAULT_FROM)
  const toDate = body.toDate ? new Date(body.toDate) : new Date()

  const supabase = createServiceClient()

  const tokens = await getTokens(supabase, 'withings')
  if (!tokens) {
    return NextResponse.json(
      { error: 'No Withings tokens. Run handshake first.' },
      { status: 400 }
    )
  }
  const fresh = await ensureFreshToken(supabase, tokens)

  let measureGrps: WithingsMeasureGroup[]
  try {
    measureGrps = await fetchBpMeasureGroups(fresh.accessToken, fromDate, toDate)
  } catch (err) {
    return NextResponse.json(
      { error: `Withings fetch failed: ${(err as Error).message}` },
      { status: 502 }
    )
  }

  // Categorise what came back from Withings
  const totalGroups = measureGrps.length
  let validBp = 0
  let onlyPulse = 0
  let wrongAttrib = 0
  let partialOrNoBp = 0

  for (const g of measureGrps) {
    const hasSys = g.measures.some((m) => m.type === MEAS_TYPE_SYSTOLIC)
    const hasDia = g.measures.some((m) => m.type === MEAS_TYPE_DIASTOLIC)
    const hasPulse = g.measures.some((m) => m.type === MEAS_TYPE_PULSE)

    if (!hasSys && !hasDia) {
      if (hasPulse) onlyPulse++
      else partialOrNoBp++
      continue
    }
    if (!hasSys || !hasDia) {
      partialOrNoBp++
      continue
    }
    if (!ACCEPTED_ATTRIB.has(g.attrib)) {
      wrongAttrib++
      continue
    }
    validBp++
  }

  // DB row count for this window (count-only, head: true to avoid the
  // 1000-row select cap — gotcha #10).
  const { count, error: dbError } = await supabase
    .from('bp_readings')
    .select('*', { count: 'exact', head: true })
    .eq('source_slug', 'withings')
    .gte('measured_at', fromDate.toISOString())
    .lte('measured_at', toDate.toISOString())

  if (dbError) {
    return NextResponse.json(
      { error: `DB count failed: ${dbError.message}` },
      { status: 500 }
    )
  }

  const dbRowCount = count ?? 0

  const payload: DiagnoseResult = {
    windowStart: fromDate.toISOString(),
    windowEnd: toDate.toISOString(),
    withings: {
      totalGroups,
      validBp,
      skipped: { onlyPulse, wrongAttrib, partialOrNoBp },
    },
    bpReadingsInDb: dbRowCount,
    gap: validBp - dbRowCount,
  }

  return NextResponse.json(payload, { status: 200 })
}
