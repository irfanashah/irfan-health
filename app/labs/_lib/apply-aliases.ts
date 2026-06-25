// Apply learned marker aliases to a draft BEFORE showing the LLM's
// suggestions to the user. Deterministic mappings from past commits
// take precedence over the LLM's per-call guess.
//
// Lookup order: lab-scoped (raw_marker_name, lab_name) → global
// (raw_marker_name, NULL). The first match wins. This lets a lab that
// uses an ambiguous raw name (e.g. "Cholesterol") map differently from
// the global default if needed.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DraftValue } from './types'

interface AliasRow {
  raw_marker_name: string
  lab_name: string | null
  marker_slug: string
}

export async function applyAliasesToDraft(
  supabase: SupabaseClient,
  values: DraftValue[],
  labName: string | null
): Promise<DraftValue[]> {
  if (values.length === 0) return values

  const rawNames = Array.from(new Set(values.map((v) => v.raw_marker_name).filter(Boolean)))
  if (rawNames.length === 0) return values

  // One round-trip: pull every alias that could match any draft raw name.
  // Filter scope client-side (NULL lab_name = global vs labName-scoped).
  const { data, error } = await supabase
    .from('lab_marker_aliases')
    .select('raw_marker_name, lab_name, marker_slug')
    .in('raw_marker_name', rawNames)

  if (error || !data) return values
  const rows = data as AliasRow[]

  // Build the lookup: scoped wins over global for the same raw name.
  const scoped = new Map<string, string>()  // raw → slug, scoped to labName
  const global = new Map<string, string>()  // raw → slug, lab_name IS NULL
  for (const r of rows) {
    if (r.lab_name && labName && r.lab_name === labName) scoped.set(r.raw_marker_name, r.marker_slug)
    if (r.lab_name === null) global.set(r.raw_marker_name, r.marker_slug)
  }

  return values.map((v) => {
    const hit = scoped.get(v.raw_marker_name) ?? global.get(v.raw_marker_name)
    if (!hit) return v
    // Alias hit — overrides the LLM's suggestion (deterministic + learned).
    return { ...v, suggested_marker_slug: hit }
  })
}
