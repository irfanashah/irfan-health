// Insight-sentence builder for the Correlation Explorer.
//
// The Slice 7.2 spec rewrites the prototype's wording so it's strictly
// associational, never causal. The prototype's template said things like
// "Short sleep nudged BP up — a moderate inverse link." This version uses
// "On days when X was lower, Y averaged …; … link" — observed pattern, not
// mechanism.
//
// Below the MIN_PAIRED_N threshold we emit a "not enough paired days yet"
// sentence instead — the slot stays in the layout so the user sees why no
// r is being shown (decision #2: show the message, don't hide the slot).

import { MIN_PAIRED_N, pearson, pairedNonNull, strengthWord, type RStrength } from '@/components/dashboard/charts/stats'
import type { MetricDef } from './metrics'

export interface Insight {
  /** Pearson r over the surviving pairs. NaN-safe (0 on degenerate input). */
  r: number
  /** Count of valid paired days (both A and B non-null). */
  n: number
  /** True iff n >= MIN_PAIRED_N — drives badge greying + sentence template. */
  enough: boolean
  strength: RStrength
  /** Display-ready sentence (associational; "keep logging" below threshold). */
  sentence: string
  /** Tertile means used in the sentence — exposed for tooltips/debug. */
  lowMeanA: number | null
  highMeanA: number | null
  lowMeanB: number | null
  highMeanB: number | null
}

/**
 * Build a tertile-based associational sentence. The pattern: split valid days
 * into bottom and top tertiles of A; report mean(B) in each. Strictly
 * descriptive of observed values — no "caused", "led to", "because".
 */
export function buildInsight(
  xs: Array<number | null>,
  ys: Array<number | null>,
  A: MetricDef,
  B: MetricDef
): Insight {
  const paired = pairedNonNull(xs, ys)
  const n = paired.n
  const enough = n >= MIN_PAIRED_N

  if (n < 2) {
    return {
      r: 0, n, enough: false, strength: 'weak',
      sentence: `Not enough paired days yet (n = ${n}) — keep logging.`,
      lowMeanA: null, highMeanA: null, lowMeanB: null, highMeanB: null,
    }
  }

  const r = pearson(paired.xs, paired.ys)
  const strength = strengthWord(r)

  if (!enough) {
    return {
      r, n, enough: false, strength,
      sentence: `Not enough paired days yet (n = ${n}) — keep logging.`,
      lowMeanA: null, highMeanA: null, lowMeanB: null, highMeanB: null,
    }
  }

  // Tertile split — bottom/top k of A by value, mean B in each.
  const order = paired.xs.map((_, i) => i).sort((i, j) => paired.xs[i] - paired.xs[j])
  const k = Math.max(2, Math.floor(order.length / 3))
  const low = order.slice(0, k)
  const high = order.slice(-k)
  const meanA = (set: number[]) => set.reduce((s, i) => s + paired.xs[i], 0) / set.length
  const meanB = (set: number[]) => set.reduce((s, i) => s + paired.ys[i], 0) / set.length

  const lowMeanA = meanA(low)
  const highMeanA = meanA(high)
  const lowMeanB = meanB(low)
  const highMeanB = meanB(high)

  // Direction word: how B differs in high-A days vs low-A days. Strictly
  // observational — "ran higher / ran lower", not "caused".
  const diff = highMeanB - lowMeanB
  const direction = Math.abs(diff) < 0.0001 ? 'tracked similarly' : diff > 0 ? 'ran higher' : 'ran lower'
  const linkWord = r === 0 ? 'no link' : r > 0 ? 'positive link' : 'inverse link'

  const aLow  = `${A.fmt(lowMeanA)}${A.unit ? ' ' + A.unit : ''}`
  const aHigh = `${A.fmt(highMeanA)}${A.unit ? ' ' + A.unit : ''}`
  const bLow  = `${B.fmt(lowMeanB)}${B.unit ? ' ' + B.unit : ''}`
  const bHigh = `${B.fmt(highMeanB)}${B.unit ? ' ' + B.unit : ''}`

  // Read the sentence aloud — it's strictly "observed value X, observed value Y, link word".
  const sentence =
    `On days when ${A.label.toLowerCase()} ran lower (around ${aLow}), ` +
    `${B.label.toLowerCase()} averaged ${bLow} — versus ${bHigh} ` +
    `on days it ran higher (around ${aHigh}). A ${strength} ${linkWord}. ` +
    `(n = ${n} paired days · association only)`

  // Direction is captured in the value comparison itself — the explicit "ran
  // higher/lower" string isn't needed in the sentence; it's a debug breadcrumb.
  void direction

  return { r, n, enough, strength, sentence, lowMeanA, highMeanA, lowMeanB, highMeanB }
}
