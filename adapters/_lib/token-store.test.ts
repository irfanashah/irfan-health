// L13 — getTokens must distinguish "no row" (source not connected → null,
// the caller's 'run the handshake' path is correct) from a query ERROR
// (transient DB outage → throw, so it doesn't masquerade as 'not connected').
// getTokens takes `supabase` as a parameter, so a tiny hand mock of the
// query chain is enough — no real DB.

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getTokens } from './token-store'

/** Mock the `.from().select().eq().maybeSingle()` chain used by getTokens. */
function mockSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  }
  return { from: () => chain } as unknown as SupabaseClient
}

describe('getTokens (L13 — no-row vs query error)', () => {
  it('no row (data null, no error) → returns null (not connected)', async () => {
    const result = await getTokens(mockSupabase({ data: null, error: null }), 'whoop')
    expect(result).toBeNull()
  })

  it('query error → THROWS (does not masquerade as "no tokens")', async () => {
    await expect(
      getTokens(mockSupabase({ data: null, error: { message: 'connection reset' } }), 'whoop')
    ).rejects.toThrow(/connection reset/)
  })

  it('row present → returns the parsed tokens', async () => {
    const expiresAt = '2026-08-01T00:00:00.000Z'
    const result = await getTokens(
      mockSupabase({
        data: { access_token: 'at', refresh_token: 'rt', expires_at: expiresAt },
        error: null,
      }),
      'whoop'
    )
    expect(result).toEqual({
      accessToken: 'at',
      refreshToken: 'rt',
      expiresAt: new Date(expiresAt),
    })
  })
})
