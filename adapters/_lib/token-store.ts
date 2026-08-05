import type { SupabaseClient } from '@supabase/supabase-js'
import type { OAuthTokens } from './types'

export async function getTokens(
  supabase: SupabaseClient,
  sourceSlug: string
): Promise<OAuthTokens | null> {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('source_slug', sourceSlug)
    .maybeSingle()

  // Distinguish a genuine "no row" (source not connected → null, the
  // caller's "run the OAuth handshake" path is correct) from a query
  // ERROR (transient DB outage, RLS, network). Collapsing both to null
  // used to mislead a transient outage into a "not connected" remediation
  // (L13). A query error must propagate so the run fails loudly + the
  // ingestion_log records a real error, not a phantom "no tokens".
  if (error) {
    throw new Error(`Failed to read tokens for ${sourceSlug}: ${error.message}`)
  }
  if (!data) return null

  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresAt: new Date(data.expires_at as string),
  }
}

export async function saveTokens(
  supabase: SupabaseClient,
  sourceSlug: string,
  tokens: OAuthTokens
): Promise<void> {
  // The primary key (source_slug) resolves the conflict; no .eq() needed
  // here. The old .eq() was a misleading no-op — upsert + eq() reads as
  // "conditionally upsert" but PostgREST applies the eq() as a filter on
  // the upsert payload, which always matches by construction. Dropping it
  // for clarity (#15 in the code-review cleanups).
  const { error } = await supabase
    .from('oauth_tokens')
    .upsert({
      source_slug: sourceSlug,
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expires_at: tokens.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    })

  if (error) {
    throw new Error(`Failed to save tokens for ${sourceSlug}: ${error.message}`)
  }
}
