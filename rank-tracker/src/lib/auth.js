/**
 * Password hashing (scrypt), signed cookies, CSRF tokens and small HTTP helpers.
 * Nothing here needs an external dependency.
 */
import crypto from 'node:crypto'
import { config } from '../config.js'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 128 * SCRYPT.N * SCRYPT.r * 2
  })
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, keyB64] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(keyB64, 'base64')
    const actual = crypto.scryptSync(String(password), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 128 * Number(N) * Number(r) * 2
    })
    return crypto.timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

export function randomId(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

export function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url')
  return `${body}.${mac}`
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url')
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (payload.exp && Date.now() > payload.exp) return null
    return payload
  } catch {
    return null
  }
}

/* ---------- cookies ---------- */
export function parseCookies(header = '') {
  const out = {}
  String(header)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((pair) => {
      const eq = pair.indexOf('=')
      if (eq < 1) return
      out[pair.slice(0, eq).trim()] = decodeURIComponent(pair.slice(eq + 1).trim())
    })
  return out
}

export function cookie(name, value, { maxAge, httpOnly = true, path: p = '/', secure = config.secureCookies, sameSite = 'Lax' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${p}`, `SameSite=${sameSite}`]
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge)}`)
  return parts.join('; ')
}

export function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`
}

/* ---------- http ---------- */
export function json(res, status, data, headers = {}) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  })
  res.end(body)
}

export function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': type,
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff'
  })
  res.end(body)
}

export function html(res, status, body) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin'
  })
  res.end(body)
}

export function redirect(res, location, headers = {}) {
  res.writeHead(302, { location, ...headers })
  res.end()
}

export async function readJson(req, limit = 1_000_000) {
  const type = req.headers['content-type'] || ''
  if (!type.includes('application/json')) {
    const err = new Error('expected application/json')
    err.status = 415
    throw err
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) {
      const err = new Error('payload too large')
      err.status = 413
      throw err
    }
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const err = new Error('invalid JSON body')
    err.status = 400
    throw err
  }
}

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function clientIp(req) {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim()
  return req.socket?.remoteAddress || ''
}

export function normalizeDomain(input) {
  let raw = String(input || '').trim().toLowerCase()
  if (!raw) return ''
  raw = raw.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '')
  raw = raw.split('/')[0].split('?')[0].split('#')[0]
  raw = raw.replace(/:\d+$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(raw)) return ''
  return raw
}
