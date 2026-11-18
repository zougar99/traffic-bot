/**
 * Authentication: login, bootstrap (first owner), logout, password change.
 * - scrypt password hashes
 * - signed session cookies (HttpOnly, SameSite=Lax)
 * - simple in-memory login throttle (5 tries / 10 min / IP+email)
 */
import { readJson, json, html, redirect, cookie, clearCookie, signToken, hashPassword, verifyPassword, randomId, clientIp, HttpError, normalizeDomain } from '../lib/auth.js'
import { run, get } from '../db.js'
import { config } from '../config.js'
import * as repo from '../lib/repo.js'

const attempts = new Map()

function throttleKey(req, email) {
  return `${clientIp(req)}:${String(email || '').toLowerCase()}`
}

function isBlocked(key) {
  const row = attempts.get(key)
  if (!row) return false
  if (Date.now() - row.first > 10 * 60 * 1000) {
    attempts.delete(key)
    return false
  }
  return row.count >= 5
}

function noteFailure(key) {
  const row = attempts.get(key)
  if (!row || Date.now() - row.first > 10 * 60 * 1000) attempts.set(key, { count: 1, first: Date.now() })
  else row.count += 1
}

export function createSession(userId) {
  const id = randomId(32)
  const days = config.sessionDays
  const expires = new Date(Date.now() + days * 86400 * 1000)
  run(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)`,
    id,
    userId,
    expires.toISOString().replace('T', ' ').slice(0, 19)
  )
  return { id, maxAge: days * 86400 }
}

export function destroySession(id) {
  if (id) run('DELETE FROM sessions WHERE id = ?', id)
}

export function sessionUser(id) {
  if (!id) return null
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now')`,
    id
  )
  return row || null
}

function setSessionCookie(res, session) {
  return cookie(config.cookieName, session.id, { maxAge: session.maxAge })
}

export async function loginPage(ctx) {
  const bootstrap = repo.countUsers() === 0 && config.allowBootstrap
  const error = ctx.query.get('error') || ''
  html(ctx.res, 200, page({ bootstrap, error }))
}

export async function doLogin(ctx) {
  const body = await readJson(ctx.req).catch(() => ({}))
  const email = String(body.email || '').toLowerCase().trim()
  const password = String(body.password || '')
  const key = throttleKey(ctx.req, email)

  if (isBlocked(key)) throw new HttpError(429, 'too many attempts, try again later')

  const user = repo.userByEmail(email)
  const ok = user && verifyPassword(password, user.password_hash)
  if (!ok) {
    noteFailure(key)
    repo.audit(null, 'auth.failed', email, clientIp(ctx.req))
    throw new HttpError(401, 'invalid email or password')
  }

  attempts.delete(key)
  const session = createSession(user.id)
  run('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?', user.id)
  repo.audit(user.id, 'auth.login', email, clientIp(ctx.req))

  return json(
    ctx.res,
    200,
    { ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    { 'set-cookie': setSessionCookie(undefined, session) }
  )
}

export async function doBootstrap(ctx) {
  if (repo.countUsers() > 0 || !config.allowBootstrap) {
    throw new HttpError(403, 'setup already completed')
  }
  const body = await readJson(ctx.req)
  const email = String(body.email || '').toLowerCase().trim()
  const password = String(body.password || '')
  const name = String(body.name || '').slice(0, 80)

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'invalid email')
  if (password.length < 10) throw new HttpError(400, 'password must be at least 10 characters')

  const result = run(
    'INSERT INTO users (email, name, password_hash, role, api_key) VALUES (?, ?, ?, ?, ?)',
    email,
    name || email.split('@')[0],
    hashPassword(password),
    'owner',
    'rt_' + randomId(24)
  )
  const userId = Number(result.lastInsertRowid)

  if (body.site) {
    const domain = normalizeDomain(body.site)
    if (domain) {
      run(
        'INSERT OR IGNORE INTO sites (user_id, domain, label, country, language) VALUES (?, ?, ?, ?, ?)',
        userId,
        domain,
        domain,
        String(body.country || 'us').toLowerCase().slice(0, 2),
        String(body.language || 'en').toLowerCase().slice(0, 5)
      )
    }
  }

  const session = createSession(userId)
  repo.audit(userId, 'auth.bootstrap', email, clientIp(ctx.req))
  return json(
    ctx.res,
    201,
    { ok: true, user: { id: userId, email, name: name || email.split('@')[0], role: 'owner' } },
    { 'set-cookie': setSessionCookie(undefined, session) }
  )
}

export async function doLogout(ctx) {
  const sessionId = ctx.cookies[config.cookieName]
  destroySession(sessionId)
  return json(ctx.res, 200, { ok: true }, { 'set-cookie': clearCookie(config.cookieName) })
}

export async function changePassword(ctx) {
  if (!ctx.user) throw new HttpError(401, 'authentication required')
  const body = await readJson(ctx.req)
  const current = String(body.currentPassword || '')
  const next = String(body.newPassword || '')
  if (!verifyPassword(current, ctx.user.password_hash)) throw new HttpError(403, 'current password is wrong')
  if (next.length < 10) throw new HttpError(400, 'new password must be at least 10 characters')
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), ctx.user.id)
  run('DELETE FROM sessions WHERE user_id = ? AND id <> ?', ctx.user.id, ctx.cookies[config.cookieName] || '')
  repo.audit(ctx.user.id, 'auth.password', ctx.user.email, clientIp(ctx.req))
  return json(ctx.res, 200, { ok: true })
}

function page({ bootstrap, error }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${bootstrap ? 'Set up Rank Tracker' : 'Sign in'} — Rank Tracker Pro</title>
<link rel="stylesheet" href="/app.css">
</head>
<body class="auth-body">
<main class="auth">
  <div class="auth__card">
    <div class="auth__brand"><span class="logo">▲</span> Rank Tracker <b>Pro</b></div>
    <h1>${bootstrap ? 'Create the owner account' : 'Sign in'}</h1>
    <p class="muted">${bootstrap ? 'This is a private instance. The first account owns it.' : 'Private instance — accounts are created by the owner.'}</p>
    ${error ? `<div class="alert alert--error">${escape(error)}</div>` : ''}
    <form id="form" class="stack" autocomplete="on">
      ${bootstrap ? '<label>Name<input name="name" autocomplete="name" placeholder="Your name"></label>' : ''}
      <label>Email<input name="email" type="email" required autocomplete="username" placeholder="you@example.com"></label>
      <label>Password<input name="password" type="password" required autocomplete="${bootstrap ? 'new-password' : 'current-password'}" minlength="${bootstrap ? 10 : 1}" placeholder="••••••••••"></label>
      ${bootstrap ? '<label>First site to track (optional)<input name="site" placeholder="your-site.com"></label>' : ''}
      <button class="btn btn--primary" type="submit">${bootstrap ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="muted small" id="msg"></p>
  </div>
</main>
<script>
const form = document.getElementById('form');
const msg = document.getElementById('msg');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  msg.textContent = '…';
  const data = Object.fromEntries(new FormData(form).entries());
  const endpoint = ${bootstrap ? "'/api/bootstrap'" : "'/api/login'"};
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data)
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'failed');
    location.href = '/';
  } catch (err) {
    msg.textContent = err.message;
  }
});
</script>
</body>
</html>`
}

function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
