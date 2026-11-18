/**
 * Email list hygiene + transactional sending.
 *
 * These are the operations a newsletter actually needs, none of which involve
 * mailing strangers:
 *   · syntax validation        · dedupe / normalise
 *   · MX + A DNS verification  · disposable-domain detection
 *   · role-account detection   · risk scoring
 *   · one-click unsubscribe tokens (HMAC, stateless)
 *
 * Sending goes through a configured provider webhook (Resend, Brevo, SES proxy,
 * or a Google Apps Script — whatever the operator already has). Lists used for
 * this tool must be opted-in: see docs/email.md.
 */
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import { config } from '../config.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'throwawaymail.com', 'yopmail.com', 'trashmail.com', 'sharklasers.com',
  'getnada.com', 'dispostable.com', 'temp-mail.org', 'fakeinbox.com'
])

const ROLE_PREFIXES = new Set([
  'admin', 'administrator', 'info', 'support', 'sales', 'billing', 'contact',
  'hello', 'postmaster', 'webmaster', 'abuse', 'noreply', 'no-reply', 'office'
])

export function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase()
}

export function validSyntax(email) {
  return EMAIL_RE.test(normalizeEmail(email))
}

export function isDisposable(email) {
  const domain = normalizeEmail(email).split('@')[1] || ''
  return DISPOSABLE.has(domain)
}

export function isRoleAccount(email) {
  const local = normalizeEmail(email).split('@')[0] || ''
  return ROLE_PREFIXES.has(local.replace(/[.+_-].*$/, ''))
}

/** Classify without touching the network. */
export function classify(email) {
  const normalized = normalizeEmail(email)
  if (!validSyntax(normalized)) return { email: normalized, status: 'invalid', reason: 'syntax' }
  if (isDisposable(normalized)) return { email: normalized, status: 'risky', reason: 'disposable' }
  if (isRoleAccount(normalized)) return { email: normalized, status: 'risky', reason: 'role-account' }
  return { email: normalized, status: 'valid', reason: '' }
}

/** MX (and A fallback) lookup. Cached in-process for the run. */
const mxCache = new Map()

export async function checkDomain(email, { timeoutMs = 4000 } = {}) {
  const domain = normalizeEmail(email).split('@')[1]
  if (!domain) return { domain: '', ok: false, reason: 'no-domain' }
  if (mxCache.has(domain)) return mxCache.get(domain)

  const withTimeout = (promise) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('dns-timeout')), timeoutMs))
    ])

  let result
  try {
    const records = await withTimeout(dns.resolveMx(domain))
    result = { domain, ok: records.length > 0, reason: records.length ? '' : 'no-mx', mx: records.map((r) => r.exchange) }
  } catch (err) {
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      result = { domain, ok: false, reason: 'no-mx' }
    } else {
      try {
        const a = await withTimeout(dns.resolve4(domain))
        result = { domain, ok: a.length > 0, reason: a.length ? 'a-record-only' : 'unresolvable' }
      } catch {
        result = { domain, ok: false, reason: 'unresolvable' }
      }
    }
  }
  mxCache.set(domain, result)
  return result
}

/** Full pass over a raw list: normalise → dedupe → classify → DNS. */
export async function verifyList(input, { checkDns = true, limit = 5000 } = {}) {
  const lines = Array.isArray(input) ? input : String(input || '').split(/\r?\n/)
  const seen = new Map()
  const rows = []

  for (const line of lines) {
    const email = normalizeEmail(line)
    if (!email || email.startsWith('#')) continue
    if (seen.has(email)) {
      rows.push({ email, status: 'duplicate', reason: 'seen earlier' })
      continue
    }
    seen.set(email, true)
    rows.push(classify(email))
    if (rows.length >= limit) break
  }

  if (checkDns) {
    const unique = [...new Set(rows.filter((r) => r.status === 'valid').map((r) => r.email))]
    const domains = [...new Set(unique.map((e) => e.split('@')[1]))]
    for (const domain of domains) {
      await checkDomain(`x@${domain}`)
    }
    for (const row of rows) {
      if (row.status !== 'valid') continue
      const info = mxCache.get(row.email.split('@')[1])
      if (info && !info.ok) {
        row.status = 'invalid'
        row.reason = info.reason
      } else if (info && info.reason === 'a-record-only') {
        row.status = 'risky'
        row.reason = 'no-mx-only-a-record'
      }
    }
  }

  const counts = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1
      return acc
    },
    { valid: 0, invalid: 0, risky: 0, duplicate: 0 }
  )

  const total = rows.length || 1
  return {
    rows,
    counts,
    total: rows.length,
    quality: Math.round(((counts.valid || 0) / total) * 100),
    cleaned: rows.filter((r) => r.status === 'valid').map((r) => r.email)
  }
}

/* ------------------------- unsubscribe tokens ------------------------- */
export function unsubscribeToken(email, secret = config.sessionSecret) {
  return crypto.createHmac('sha256', secret).update(normalizeEmail(email)).digest('base64url').slice(0, 24)
}

export function verifyUnsubscribe(email, token, secret = config.sessionSecret) {
  const expected = unsubscribeToken(email, secret)
  const a = Buffer.from(String(token || ''))
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function unsubscribeUrl(baseUrl, email) {
  const token = unsubscribeToken(email)
  return `${baseUrl.replace(/\/$/, '')}/unsubscribe?email=${encodeURIComponent(normalizeEmail(email))}&token=${token}`
}

/* ----------------------------- sending ------------------------------ */
/**
 * Send to an opted-in recipient through the configured webhook.
 * @returns {Promise<{ok:boolean, skipped?:boolean, detail:string}>}
 */
export async function sendTransactional({ to, subject, html, text, tag = 'transactional' }) {
  const webhook = process.env.EMAIL_WEBHOOK_URL || config.alerts.email.webhookUrl
  if (!webhook) return { ok: false, skipped: true, detail: 'EMAIL_WEBHOOK_URL not configured' }
  if (!validSyntax(to)) return { ok: false, detail: 'invalid recipient' }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(process.env.EMAIL_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` } : {})
      },
      body: JSON.stringify({
        to: normalizeEmail(to),
        subject,
        html,
        text: text || stripTags(html || ''),
        tag,
        unsubscribe: unsubscribeUrl(process.env.PUBLIC_BASE_URL || 'http://localhost:4170', to)
      }),
      signal: ac.signal
    })
    const body = await res.text().catch(() => '')
    return { ok: res.ok, detail: `${res.status} ${body.slice(0, 160)}`.trim() }
  } catch (err) {
    return { ok: false, detail: String(err.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

function stripTags(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/* --------------------------- message builder ------------------------ */
export function buildNewsletter({ title, intro, items = [], footer = '' }) {
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7fb;font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0c1724">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 10px 30px rgba(12,34,56,.08)">
      <tr><td style="padding:22px 26px;background:linear-gradient(135deg,#22d3ee,#3b82f6);color:#04121a">
        <h1 style="margin:0;font-size:19px">${escape(title)}</h1>
      </td></tr>
      <tr><td style="padding:24px 26px">
        <p style="margin:0 0 18px;line-height:1.65">${escape(intro)}</p>
        ${items
          .map(
            (item) => `<div style="padding:14px 0;border-top:1px solid #e7eef7">
              <a href="${escape(item.url || '#')}" style="color:#0b6bcb;font-weight:600;text-decoration:none">${escape(item.title)}</a>
              <p style="margin:6px 0 0;color:#4a5b6e;font-size:14px;line-height:1.6">${escape(item.description || '')}</p>
            </div>`
          )
          .join('')}
      </td></tr>
      <tr><td style="padding:16px 26px;background:#f6f9fc;color:#6d7f93;font-size:12px">${escape(footer || 'You are receiving this because you subscribed.')}</td></tr>
    </table>
  </td></tr></table></body></html>`

  const text = [title, '', intro, '', ...items.map((i) => `- ${i.title}: ${i.url || ''}`), '', footer].join('\n')
  return { html, text }
}

function escape(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
