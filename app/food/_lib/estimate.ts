// Meal estimation — Sonnet via Anthropic tool_use.
//
// Reuses the Labs Anthropic integration (ANTHROPIC_API_KEY). Missing key
// returns { kind: 'error', missingKey: true } so the UI can offer a
// manual-entry fallback (same discipline as the Labs slice and the email
// primitive — a missing key never throws / never 500s the page).

import Anthropic from '@anthropic-ai/sdk'
import { ANTHROPIC_MODEL, ESTIMATE_TOOL, SYSTEM_PROMPT } from './prompt'
import type {
  MealDraft,
  MealEstimateResult,
  MealItem,
  MealLabel,
  MealTotals,
} from './types'

const MAX_OUTPUT_TOKENS = 4096

function n(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'string') {
    const x = Number(v)
    return Number.isFinite(x) ? x : null
  }
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return null
}

function s(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/** GST hour → label fallback if the model omits one. */
export function defaultMealLabel(eatenAt: string): MealLabel {
  const d = new Date(eatenAt)
  if (Number.isNaN(d.getTime())) return 'snack'
  // GST = UTC+4 fixed; lift the hour from the shifted instant.
  const hour = new Date(d.getTime() + 4 * 60 * 60 * 1000).getUTCHours()
  if (hour >= 4 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 15) return 'lunch'
  if (hour >= 17 && hour < 21) return 'dinner'
  return 'snack'
}

function pickToolUse(
  content: Anthropic.Messages.ContentBlock[],
): Anthropic.Messages.ToolUseBlock | null {
  for (const block of content) {
    if (block.type === 'tool_use' && block.name === ESTIMATE_TOOL.name) {
      return block
    }
  }
  return null
}

function normaliseDraft(
  raw: unknown,
  description: string,
  eatenAt: string,
): MealDraft {
  const obj = (raw ?? {}) as Record<string, unknown>
  const rawItems = Array.isArray(obj.items) ? obj.items : []
  const items: MealItem[] = rawItems.map((r) => {
    const it = (r ?? {}) as Record<string, unknown>
    return {
      name: s(it.name) ?? '(item)',
      qty: s(it.qty),
      carbs_g: n(it.carbs_g),
      protein_g: n(it.protein_g),
      fat_g: n(it.fat_g),
      fiber_g: n(it.fiber_g),
      sugar_g: n(it.sugar_g),
      sodium_mg: n(it.sodium_mg),
      calories: n(it.calories),
    }
  })
  const tt = ((obj.totals ?? {}) as Record<string, unknown>)
  const totals: MealTotals = {
    carbs_g: n(tt.carbs_g),
    protein_g: n(tt.protein_g),
    fat_g: n(tt.fat_g),
    fiber_g: n(tt.fiber_g),
    sugar_g: n(tt.sugar_g),
    sodium_mg: n(tt.sodium_mg),
    calories: n(tt.calories),
  }
  const labelRaw = s(obj.meal_label)
  const mealLabel: MealLabel =
    labelRaw === 'breakfast' || labelRaw === 'lunch' || labelRaw === 'dinner' || labelRaw === 'snack'
      ? labelRaw
      : defaultMealLabel(eatenAt)
  return {
    eatenAt,
    description,
    mealLabel,
    items,
    totals,
    note: s(obj.note),
  }
}

export async function estimateMeal(
  description: string,
  eatenAt: string,
): Promise<MealEstimateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return {
      kind: 'error',
      missingKey: true,
      error:
        'ANTHROPIC_API_KEY is not set — auto-estimate is unavailable. You can still log a meal by entering macros manually below.',
    }
  }
  if (!description.trim()) {
    return { kind: 'error', error: 'Describe the meal in a few words first.' }
  }

  try {
    const client = new Anthropic({ apiKey })
    const userText = `Eaten_at (GST timestamp): ${eatenAt}\n\nMeal: ${description.trim()}`
    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      tools: [ESTIMATE_TOOL as unknown as Anthropic.Tool],
      tool_choice: { type: 'tool', name: ESTIMATE_TOOL.name },
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    })
    if (response.stop_reason === 'max_tokens') {
      return { kind: 'error', error: 'Estimate truncated — try a shorter meal description.' }
    }
    const block = pickToolUse(response.content)
    if (!block) {
      return { kind: 'error', error: 'LLM did not call estimate_meal — please try again or enter macros manually.' }
    }
    const draft = normaliseDraft(block.input, description, eatenAt)
    return { kind: 'ok', draft }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { kind: 'error', error: `Estimate failed: ${msg}` }
  }
}
