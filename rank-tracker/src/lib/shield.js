/**
 * Comment shield — protects a site you own from comment/form spam.
 *
 * Two layers:
 *   1. scoreSubmission(): a fast, explainable heuristic score (0–100) from
 *      time-to-submit, honeypot field, link density, keyword stuffing,
 *      repeated content, IP reputation cache and per-IP rate limits.
 *   2. blocklist(): feed the worst offenders back to your site (WAF / middleware).
 *
 * Nothing here posts anything anywhere — it only scores and throttles traffic
 * that arrives at your own endpoints.
 */
import crypto from 'node:crypto'

const SPAM_WORDS = [
  'casino', 'viagra', 'porn', 'sex', 'crypto giveaway', 'loan', 'replica',
  'seo services', 'buy followers', 'click here now', 'work from home',
  'make money fast', 'cheap drugs', 'pills', 'betting', 'slots'
]

const SHORTENERS = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'is.gd', 'cutt.ly', 'rb.gy']

/** In-memory rate limiter + reputation cache (process-local, good enough for one site). */
const buckets = new Map()
const reputation = new Map()

export function rateLimit(key, { windowMs = 60_000, max = 5 } = {}, now = Date.now()) {
  const bucket = buckets.get(key) || { count: 0, reset: now + windowMs }
  if (now > bucket.reset) {
    bucket.count = 0
    bucket.reset = now + windowMs
  }
  bucket.count += 1
  buckets.set(key, bucket)
  return {
    allowed: bucket.count <= max,
    remaining: Math.max(0, max - bucket.count),
    retryAfter: Math.max(0, Math.ceil((bucket.reset - now) / 1000))
  }
}

export function resetBuckets() {
  buckets.clear()
  reputation.clear()
}

export function bumpReputation(ip, delta = 1) {
  reputation.set(ip, (reputation.get(ip) || 0) + delta)
  return reputation.get(ip) || 0
}

export function reputationOf(ip) {
  return reputation.get(ip) || 0
}

/**
 * @param {object} input
 * @param {string} input.name
 * @param {string} input.email
 * @param {string} input.comment
 * @param {number} [input.elapsedMs]   time between form render and submit
 * @param {boolean} [input.honeypot]   hidden field must stay empty
 * @param {string} [input.ip]
 * @param {Set<string>} [input.seenHashes] hashes of comments already accepted
 * @returns {{score:number, verdict:'allow'|'review'|'block', reasons:string[]}}
 */
export function scoreSubmission(input, { seenHashes = new Set() } = {}) {
  const reasons = []
  let score = 0

  const name = String(input.name || '').trim()
  const email = String(input.email || '').trim()
  const comment = String(input.comment || '').trim()

  if (input.honeypot) {
    score += 60
    reasons.push('honeypot filled')
  }

  if (input.elapsedMs != null && input.elapsedMs < 1500) {
    score += 35
    reasons.push('submitted faster than a human can type')
  }

  if (comment.length < 8) {
    score += 20
    reasons.push('comment too short')
  }

  const links = (comment.match(/https?:\/\//gi) || []).length
  if (links >= 3) {
    score += 30
    reasons.push(`${links} links in one comment`)
  } else if (links > 0) {
    score += 10
    reasons.push('contains links')
  }

  if (SHORTENERS.some((s) => comment.toLowerCase().includes(s))) {
    score += 20
    reasons.push('URL shortener')
  }

  const lower = comment.toLowerCase()
  const hits = SPAM_WORDS.filter((w) => lower.includes(w))
  if (hits.length) {
    score += Math.min(40, hits.length * 15)
    reasons.push(`spam keywords: ${hits.join(', ')}`)
  }

  const letters = comment.replace(/[^a-z]/gi, '')
  const uppercase = comment.replace(/[^A-Z]/g, '')
  if (letters.length > 20 && uppercase.length / letters.length > 0.5) {
    score += 15
    reasons.push('mostly uppercase')
  }

  if (/(.)\1{6,}/.test(comment)) {
    score += 10
    reasons.push('repeated characters')
  }

  const hash = contentHash(comment)
  if (seenHashes.has(hash)) {
    score += 45
    reasons.push('duplicate of an existing comment')
  }

  if (/[\u0400-\u04FF\u0600-\u06FF]{20,}/.test(comment) && !/[\u0600-\u06FF]/.test(name)) {
    reasons.push('mixed-script payload')
    score += 10
  }

  if (input.ip) {
    const rep = reputationOf(input.ip)
    if (rep > 0) {
      score += Math.min(30, rep * 10)
      reasons.push('IP has prior flags')
    }
  }

  if (email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) {
    score += 20
    reasons.push('invalid email')
  }

  if (name && /\d{4,}/.test(name)) {
    score += 10
    reasons.push('digits in name')
  }

  score = Math.max(0, Math.min(100, score))
  const verdict = score >= 60 ? 'block' : score >= 30 ? 'review' : 'allow'
  return { score, verdict, reasons }
}

export function contentHash(text) {
  return crypto
    .createHash('sha256')
    .update(String(text).trim().toLowerCase().replace(/\s+/g, ' '))
    .digest('hex')
    .slice(0, 32)
}

/** Domains that appeared repeatedly in blocked submissions (for your WAF). */
export function blocklist({ minFlags = 2 } = {}) {
  return [...reputation.entries()]
    .filter(([, flags]) => flags >= minFlags)
    .map(([ip, flags]) => ({ ip, flags }))
    .sort((a, b) => b.flags - a.flags)
}
