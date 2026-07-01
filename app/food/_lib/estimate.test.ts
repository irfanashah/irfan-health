// Unit test for defaultMealLabel — the only pure, deterministic function in
// the food-diary estimate module (estimateMeal itself calls the Anthropic
// API and is out of scope for this pass; there is no separate items->totals
// resum function to test — totals come directly from the LLM's `totals`
// field, not a recomputed sum of `items[]`).
//
// GST hour boundaries (Asia/Dubai, fixed UTC+4): breakfast 04-11, lunch
// 11-15, dinner 17-21, else snack. Expected GST hour for each UTC input is
// hand-computed as (UTC hour + 4) mod 24, carrying into the next calendar
// day where relevant.

import { describe, it, expect } from 'vitest'
import { defaultMealLabel } from './estimate'

describe('defaultMealLabel', () => {
  it('03:00 UTC -> GST 07:00 -> breakfast', () => {
    expect(defaultMealLabel('2026-06-01T03:00:00.000Z')).toBe('breakfast')
  })
  it('07:30 UTC -> GST 11:30 -> lunch', () => {
    expect(defaultMealLabel('2026-06-01T07:30:00.000Z')).toBe('lunch')
  })
  it('15:00 UTC -> GST 19:00 -> dinner', () => {
    expect(defaultMealLabel('2026-06-01T15:00:00.000Z')).toBe('dinner')
  })
  it('12:00 UTC -> GST 16:00 (between lunch and dinner) -> snack', () => {
    expect(defaultMealLabel('2026-06-01T12:00:00.000Z')).toBe('snack')
  })
  it('20:00 UTC -> GST rolls into the next calendar day at 00:00 -> snack', () => {
    expect(defaultMealLabel('2026-06-01T20:00:00.000Z')).toBe('snack')
  })
  it('an unparseable timestamp falls back to snack rather than throwing', () => {
    expect(defaultMealLabel('not-a-date')).toBe('snack')
  })
})
