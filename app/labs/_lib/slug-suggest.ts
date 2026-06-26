// Slug-suggest helpers for unmapped markers.
//
// The LLM proposes a `suggested_marker_slug` per row; for unmapped
// markers we also need:
//   1. A code-side fallback slug derived from the raw name (in case
//      the LLM didn't propose one for some reason).
//   2. A "similar-existing-slug" list so the user can MERGE rather
//      than fork (Neutrophil % → existing `neutrophils_pct`, not a
//      new `neutrophil_pct`).
//
// Slug rules: lowercase, alphanumeric + underscore, ≤40 chars; strip
// noise prefixes ("serum ", "plasma ") and parenthesised qualifiers.
// Symbol "%" → "_pct"; "/" → "_per_"; arithmetic and spaces → "_".

import { ALL_MARKER_SLUGS } from './markers'

const NOISE_PREFIXES = [
  'serum ', 'plasma ', 'blood ', 'whole blood ', 'urine ',
]

export function slugify(rawName: string): string {
  let s = (rawName ?? '').toLowerCase().trim()
  for (const prefix of NOISE_PREFIXES) {
    if (s.startsWith(prefix)) s = s.slice(prefix.length)
  }
  // Strip parenthesised qualifiers ("(K)", "( calculated )").
  s = s.replace(/\s*\([^)]*\)\s*/g, ' ').trim()
  // Symbol mappings.
  s = s.replace(/%/g, ' pct ')
  s = s.replace(/\//g, ' per ')
  s = s.replace(/[+&,]/g, ' ')
  // Collapse non-alphanumerics to underscore.
  s = s.replace(/[^a-z0-9]+/g, '_')
  s = s.replace(/^_+|_+$/g, '')
  return s.slice(0, 40)
}

// Cheap edit-distance: bounded Levenshtein up to maxDistance — returns
// Infinity once it exceeds. Used to surface merge candidates.
function distance(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0
  const lenA = a.length
  const lenB = b.length
  if (Math.abs(lenA - lenB) > maxDistance) return Infinity
  if (lenA === 0) return lenB
  if (lenB === 0) return lenA
  let prev = new Array<number>(lenB + 1)
  let curr = new Array<number>(lenB + 1)
  for (let j = 0; j <= lenB; j++) prev[j] = j
  for (let i = 1; i <= lenA; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= lenB; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      )
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > maxDistance) return Infinity
    ;[prev, curr] = [curr, prev]
  }
  return prev[lenB]
}

/**
 * Find existing slugs that are similar enough to the candidate that
 * the user is probably looking at a merge, not a fork. Returns up to
 * `limit` candidates sorted by closeness. The threshold scales with
 * length so short slugs stay strict (3-char slugs match only on near-
 * exact) while long ones tolerate a couple of typos.
 */
export function similarExistingSlugs(candidate: string, limit = 5): string[] {
  const c = slugify(candidate)
  if (!c) return []
  const maxDistance = Math.max(2, Math.floor(c.length * 0.3))
  const scored: Array<[string, number]> = []
  for (const slug of ALL_MARKER_SLUGS) {
    if (slug === c) continue                       // exact match isn't a "merge candidate"
    if (slug.includes(c) || c.includes(slug)) {
      scored.push([slug, 0])                       // substring match always wins
      continue
    }
    const d = distance(c, slug, maxDistance)
    if (d <= maxDistance) scored.push([slug, d])
  }
  scored.sort((a, b) => a[1] - b[1])
  return scored.slice(0, limit).map(([slug]) => slug)
}

/**
 * Best-effort canonical slug for a raw marker name:
 *   1. LLM's suggested_marker_slug, if provided and non-empty.
 *   2. Code-side slugify(raw_name) as the fallback.
 *
 * Always returns a non-empty string; never 'unmapped' (that's reserved
 * for "user explicitly skipped").
 */
export function bestSuggestedSlug(rawName: string, llmSuggestion: string | null): string {
  const llm = (llmSuggestion ?? '').trim()
  if (llm) return llm
  const fallback = slugify(rawName)
  return fallback || 'misc'
}
