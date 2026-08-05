// L11 — the /report LDL reduction label's arrow must follow the SIGN of the
// change: a reduction (LDL fell) is a down arrow "from baseline"; a rise (LDL
// went up) is an up arrow "above baseline", never a down arrow with a "+12%".
// Expected strings are written out by hand, not echoed from the implementation.

import { describe, it, expect } from 'vitest'
import { ldlReductionLabel } from './format'

describe('ldlReductionLabel (L11 — arrow follows the sign)', () => {
  it('LDL fell: down arrow, "from baseline"', () => {
    expect(ldlReductionLabel(30, 3.2)).toBe('↓ 30% from baseline 3.20')
  })

  it('LDL rose (negative reduction): UP arrow, "above baseline", no reduction framing', () => {
    // The bug rendered this as "↓ +12% from baseline" — down arrow on a rise.
    expect(ldlReductionLabel(-12, 1.4)).toBe('↑ 12% above baseline 1.40')
  })

  it('exact zero change counts as non-negative → down arrow, 0%', () => {
    expect(ldlReductionLabel(0, 2.0)).toBe('↓ 0% from baseline 2.00')
  })

  it('rounds the percentage to a whole number', () => {
    expect(ldlReductionLabel(12.6, 2.55)).toBe('↓ 13% from baseline 2.55')
  })
})
