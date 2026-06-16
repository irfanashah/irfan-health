import type { SupabaseClient } from '@supabase/supabase-js'

export interface Adapter {
  readonly sourceSlug: string
  fetchAndIngest(config: AdapterConfig): Promise<IngestionResult>
}

export interface AdapterConfig {
  supabase: SupabaseClient
  fromDate?: Date
  toDate?: Date
}

export interface IngestionResult {
  ingestionLogId: string
  recordsFound: number
  recordsWritten: number
  recordsSkipped: number
  errors: string[]
  status: 'success' | 'partial' | 'error'
}

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
}
