'use server'

// Optional LLM "what else could explain this?" expand for engine
// connections. Spec §1.9.
//
// Lazy + per-card — only called when the user clicks the expand on a
// specific connection card. Reuses the Labs Anthropic integration
// (ANTHROPIC_API_KEY); uses Haiku (cheap, fast, qualitative output is
// fine). Missing key → returns { available: false }; the UI uses that to
// hide the button. The curated confounder map ALWAYS renders regardless.
//
// Caching is by (xId, yId, lag) — keyed in-memory on the server, scoped
// per request. The client-side useState in the panel caches the rendered
// result for the session. We accept a small re-call cost across server
// restarts; the alternative (DB cache) is overkill for an optional surface.
//
// HARD PROMPT DISCIPLINE:
//   - no advice ("you should…");
//   - no diagnosis ("this means…");
//   - no alarming language ("this is dangerous…");
//   - no invented mechanisms ("statin lowers LDL by…");
//   - associational language only ("could plausibly explain", "a clinician
//     might also consider", "worth ruling out");
//   - emphasis on variables NOT in the tracked list (the user already sees
//     the tracked ones via the curated map);
//   - concise (≤ 6 bullet items, ≤ 14 words each).

import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { METRIC_INDEX, ENGINE_METRIC_IDS } from '@/components/dashboard/connections/metrics'

// Guard against unauthenticated callers — every export in a 'use server'
// file is an independently-callable RPC. The LLM expand carries no PHI
// (just metric ids + lag) but an unguarded RPC would let an attacker
// rack up Anthropic spend.
async function requireSession() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorised')
  return user
}

const MODEL = 'claude-haiku-4-5-20251001'

const SYSTEM_PROMPT = `You are an honest hypothesis-broadener for an n-of-1 health platform. You receive an observed associational pattern between two daily-tracked signals on a single subject (Irfan, a post-MI cardiac patient). Your job is to suggest plausible alternative explanations — especially variables NOT in the tracked list — that a clinician would consider before treating the pattern as a real signal.

HARD RULES:
- Associational language only. NEVER imply causation, treatment, diagnosis, or advice.
- NEVER suggest changing behaviour, doses, or anything else. "Consider" / "could plausibly explain" / "worth ruling out" — never "you should".
- NEVER claim a mechanism is established. Phrase as possibilities a clinician would weigh.
- NEVER alarming language. The user is not in distress and there is no emergency context.
- NEVER invent specific numeric thresholds, ranges, or normal values.
- Lean toward variables that are NOT in the tracked metrics list (the user already sees those). Diet, alcohol, stress, illness, hydration, meal timing, caffeine, room temperature, household disruption (newborn), measurement-context artefacts, etc.
- ≤ 6 bullet items. Each ≤ 14 words. No headings. No preamble. No closing summary.`

export interface LlmConfounderResult {
  available: boolean
  /** Markdown bullet list. Empty when available=false. */
  text?: string
  error?: string
}

// Server-process memory cache. Key = `${x}__${y}__lag${L}`. Bounded loosely
// — for a single-user app the cardinality is tiny; we never evict.
const CACHE = new Map<string, LlmConfounderResult>()

export async function fetchLlmConfounders(
  xId: string,
  yId: string,
  lag: number,
): Promise<LlmConfounderResult> {
  await requireSession()
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return { available: false }

  const cacheKey = `${xId}__${yId}__lag${lag}`
  const cached = CACHE.get(cacheKey)
  if (cached) return cached

  const X = METRIC_INDEX[xId]
  const Y = METRIC_INDEX[yId]
  if (!X || !Y) return { available: false, error: 'unknown metric id' }

  const trackedList = ENGINE_METRIC_IDS
    .map((id) => {
      const m = METRIC_INDEX[id]
      return m ? `${m.label} (${m.short})` : null
    })
    .filter(Boolean)
    .join(', ')

  const lagWords = lag === 0 ? 'same-day' : lag === 1 ? 'next-day' : `${lag} days later`

  const userPrompt = `Observed pattern in Irfan's daily data: ${X.label} (X) and ${Y.label} (Y) tend to track together, with X preceding Y by ${lagWords} (lag = ${lag}). The pattern survives a detrended, FDR-controlled lagged-correlation scan, so it isn't an obvious artefact of the post-MI recovery trend or multiple testing. But correlation isn't causation, and many plausible explanations don't live in the tracked metrics.

Tracked metrics the platform already considers (and therefore the user already sees in the dashboard): ${trackedList}.

List up to 6 plausible alternative explanations — confounders, mechanism candidates, measurement artefacts — that a clinician might weigh before treating this as a real signal. Lean toward variables NOT in the tracked list. Concise bullets only, ≤ 14 words each.`

  try {
    const client = new Anthropic({ apiKey })
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    })
    const text = resp.content
      .filter((block) => block.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('\n')
      .trim()
    const result: LlmConfounderResult = { available: true, text }
    CACHE.set(cacheKey, result)
    return result
  } catch (err) {
    // Never let an LLM failure 500 the panel — return available with an error string.
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[confounder-llm] ${cacheKey}: ${msg}`)
    return { available: true, error: 'AI suggestion temporarily unavailable.' }
  }
}

/** Server-only convenience for the UI: whether the LLM expand button should render. */
export async function llmConfoundersAvailable(): Promise<boolean> {
  return !!process.env.ANTHROPIC_API_KEY
}
