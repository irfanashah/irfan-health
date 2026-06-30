// Email primitive — Resend via raw fetch.
//
// One destination (Irfan), one provider (Resend), no SDK dependency.
// A single authenticated POST keeps the surface minimal and easy to
// swap if we ever change providers.
//
// Missing-key contract: if RESEND_API_KEY or ALERT_EMAIL_TO is unset,
// no-op + console.warn and return { ok: false }. NEVER throw — a
// missing key must not 500 a cron run. Cron emails are nice-to-have,
// not a hard dependency of the ingestion pipeline.
//
// Sender defaults to onboarding@resend.dev (Resend's verified test
// sender that delivers to the account owner's own address with zero
// DNS setup). Set ALERT_EMAIL_FROM to a custom address once a domain
// is verified in Resend.
//
// PHI rule: callers MUST NOT put health values in `lines`. Cron-
// failure emails carry source names + timestamps; the adherence nudge
// carries one sentence + a CTA. Nothing else.

export interface AlertEmailCta {
  label: string
  url: string
}

export interface AlertEmail {
  subject: string
  lines: string[]
  cta?: AlertEmailCta
}

export interface SendResult {
  ok: boolean
  error?: string
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const DEFAULT_FROM = 'Irfan Health <onboarding@resend.dev>'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderHtml(email: AlertEmail): string {
  const paragraphs = email.lines.map((l) => `<p style="margin:0 0 12px 0;">${escapeHtml(l)}</p>`).join('')
  const cta = email.cta
    ? `<p style="margin:18px 0 0 0;"><a href="${escapeHtml(email.cta.url)}" style="display:inline-block;padding:8px 14px;background:#00C896;color:#000;text-decoration:none;border-radius:6px;font-weight:600;">${escapeHtml(email.cta.label)}</a></p>`
    : ''
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.5;color:#111;max-width:560px;">${paragraphs}${cta}</div>`
}

function renderText(email: AlertEmail): string {
  const body = email.lines.join('\n\n')
  return email.cta ? `${body}\n\n${email.cta.label}: ${email.cta.url}` : body
}

export async function sendAlertEmail(email: AlertEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY
  const to = process.env.ALERT_EMAIL_TO
  const from = process.env.ALERT_EMAIL_FROM || DEFAULT_FROM

  if (!key || !to) {
    console.warn(
      `[email] sendAlertEmail skipped: ${!key ? 'RESEND_API_KEY' : 'ALERT_EMAIL_TO'} not set. Subject was: ${email.subject}`,
    )
    return { ok: false, error: 'missing-env' }
  }

  try {
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: email.subject,
        text: renderText(email),
        html: renderHtml(email),
      }),
    })
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '')
      console.warn(`[email] Resend ${resp.status}: ${detail.slice(0, 200)}`)
      return { ok: false, error: `resend-${resp.status}` }
    }
    return { ok: true }
  } catch (err) {
    // Never throw — even a network blip in cron must return a result.
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[email] sendAlertEmail threw: ${msg}`)
    return { ok: false, error: msg }
  }
}
