/**
 * Delivery channels: Telegram, Google Sheets (Apps Script webhook) and email
 * (any transactional provider exposed through a webhook — Resend, Brevo, or a
 * Google Apps Script that sends with Gmail).
 *
 * Every channel is optional and fail-silent: a broken webhook never breaks a
 * collection run. Each attempt is recorded in `deliveries` for the dashboard.
 */
import { config } from '../config.js'
import { run, all } from '../db.js'

async function post(url, payload, headers = {}) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: ac.signal
    })
    const text = await res.text().catch(() => '')
    if (!res.ok) return { ok: false, detail: `${res.status} ${text.slice(0, 200)}` }
    return { ok: true, detail: text.slice(0, 200) }
  } catch (err) {
    return { ok: false, detail: String(err.message || err).slice(0, 200) }
  } finally {
    clearTimeout(timer)
  }
}

function record(userId, channel, result) {
  try {
    run(
      'INSERT INTO deliveries (user_id, channel, status, detail) VALUES (?, ?, ?, ?)',
      userId,
      channel,
      result.ok ? 'ok' : 'failed',
      result.detail || ''
    )
  } catch {
    /* delivery logging must never throw */
  }
}

/* ----------------------------- Telegram ----------------------------- */
export async function sendTelegram(userId, message) {
  const t = config.alerts.telegram
  if (!t.enabled || !t.token || !t.chatId) {
    return { ok: false, skipped: true, detail: 'telegram not configured' }
  }
  const result = await post(`https://api.telegram.org/bot${t.token}/sendMessage`, {
    chat_id: t.chatId,
    text: message,
    parse_mode: 'HTML',
    disable_web_page_preview: true
  })
  record(userId, 'telegram', result)
  return result
}

/* --------------------------- Google Sheets --------------------------- */
/**
 * The Apps Script receives:
 *   { sheetId, token, rows: [[date, site, keyword, engine, position, url, change]] }
 * and appends them to the configured spreadsheet.
 */
export async function pushSheet(userId, rows) {
  const s = config.alerts.sheets
  if (!s.enabled || !s.scriptUrl) {
    return { ok: false, skipped: true, detail: 'sheets not configured' }
  }
  const result = await post(
    s.scriptUrl,
    { sheetId: s.sheetId, token: s.token, rows },
    s.token ? { 'x-webhook-token': s.token } : {}
  )
  record(userId, 'sheets', result)
  return result
}

/* ------------------------------- Email ------------------------------- */
export async function sendEmail(userId, { subject, html, text }) {
  const e = config.alerts.email
  if (!e.enabled || !e.webhookUrl) {
    return { ok: false, skipped: true, detail: 'email not configured' }
  }
  const result = await post(
    e.webhookUrl,
    { to: e.to, subject, html, text },
    e.token ? { authorization: `Bearer ${e.token}` } : {}
  )
  record(userId, 'email', result)
  return result
}

/* ------------------------------ Digest ------------------------------ */
export function buildDigest(alerts, siteCount) {
  if (!alerts.length) {
    return {
      subject: 'Rank Tracker — no movement today',
      text: `No ranking changes across ${siteCount} site(s).`,
      html: `<p>No ranking changes across <b>${siteCount}</b> site(s).</p>`
    }
  }
  const movers = alerts
    .filter((a) => ['drop', 'gain', 'lost', 'new'].includes(a.kind))
    .slice(0, 20)
  const critical = alerts.filter((a) => a.severity === 'critical')

  const lines = [
    `Rank Tracker digest — ${new Date().toISOString().slice(0, 10)}`,
    `${alerts.length} alerts across ${siteCount} site(s), ${critical.length} critical.`,
    ''
  ]
  for (const a of movers) lines.push(`• ${a.title} — ${a.body}`)

  const html = `
    <h2>Rank Tracker digest</h2>
    <p><b>${alerts.length}</b> alerts · <b>${critical.length}</b> critical · ${siteCount} site(s)</p>
    <ul>
      ${movers.map((a) => `<li><b>${escapeHtml(a.title)}</b><br><span>${escapeHtml(a.body)}</span></li>`).join('')}
    </ul>`

  return { subject: lines[0], text: lines.join('\n'), html }
}

export function digestForUser(userId, sinceDays = 1) {
  const rows = all(
    `SELECT a.*, k.phrase FROM alerts a
     LEFT JOIN keywords k ON k.id = a.keyword_id
     WHERE a.user_id = ? AND a.created_at >= datetime('now', ?)
     ORDER BY CASE a.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
              a.created_at DESC
     LIMIT 100`,
    userId,
    `-${Number(sinceDays)} days`
  )
  return rows.map((r) => ({
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body,
    phrase: r.phrase || ''
  }))
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Spreadsheet rows for a collection run. */
export function sheetRows(positions) {
  return positions.map((p) => [
    p.serp_date,
    p.domain,
    p.phrase,
    p.engine,
    p.position == null ? '' : p.position,
    p.url || '',
    p.delta == null ? '' : p.delta
  ])
}
