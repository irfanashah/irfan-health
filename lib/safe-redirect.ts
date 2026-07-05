// Open-redirect guard for the `?next=` param on the Supabase auth callback.
// Pure + testable on purpose — this is the one line of logic standing
// between a magic-link/OAuth callback and an attacker-controlled redirect.

/**
 * Only allow a same-origin relative path through. Anything that isn't a
 * single leading `/` (a real absolute URL, a protocol-relative `//host`,
 * or a backslash-disguised `/\host` — some browsers normalise `\` to `/`
 * and treat it as protocol-relative too) falls back to `/`.
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next) return '/'
  if (!next.startsWith('/')) return '/'
  if (next.startsWith('//') || next.startsWith('/\\')) return '/'
  return next
}
