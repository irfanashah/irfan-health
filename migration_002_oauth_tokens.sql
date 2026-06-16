-- ============================================================
-- Health Platform — OAuth Tokens Migration
-- Version: 002
-- Date: 2026-06-16
-- Run this in the Supabase SQL Editor BEFORE the Slice 1 OAuth handshake.
-- Safe to re-run: uses IF NOT EXISTS and DROP POLICY IF EXISTS.
-- ============================================================

-- ============================================================
-- TABLE: oauth_tokens
-- One row per OAuth source. Read and written exclusively by the
-- ingestion adapter via the service role key (bypasses RLS).
-- The dashboard (authenticated session) has NO access to this table.
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_tokens (
  source_slug    text        PRIMARY KEY REFERENCES sources(slug),
  access_token   text        NOT NULL,
  refresh_token  text        NOT NULL,
  expires_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);


-- ============================================================
-- ROW LEVEL SECURITY
-- Service role bypasses RLS automatically — no policy needed for it.
-- Deny all access for the authenticated role (dashboard) and anon.
-- Tokens must only be accessible to the ingestion backend.
-- ============================================================

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all" ON oauth_tokens;

CREATE POLICY "deny_all" ON oauth_tokens
  FOR ALL USING (false);


-- ============================================================
-- DONE
-- Expected result: 1 new table (oauth_tokens), 1 RLS policy.
-- Verify in Table Editor that oauth_tokens appears with 0 rows.
-- ============================================================
