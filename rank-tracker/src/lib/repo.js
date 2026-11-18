/**
 * Query helpers shared by the API and the dashboard.
 */
import { all, get, run } from '../db.js'
import { safeJson } from './collector.js'

export function userByEmail(email) {
  return get('SELECT * FROM users WHERE email = ?', String(email || '').toLowerCase().trim())
}

export function userById(id) {
  return get('SELECT * FROM users WHERE id = ?', Number(id))
}

export function userByApiKey(key) {
  if (!key) return null
  return get('SELECT * FROM users WHERE api_key = ?', String(key))
}

export function countUsers() {
  return get('SELECT COUNT(*) AS n FROM users').n
}

export function sitesOf(userId) {
  return all(
    `SELECT s.*,
            (SELECT COUNT(*) FROM keywords k WHERE k.site_id = s.id AND k.active = 1) AS keywords,
            (SELECT COUNT(*) FROM competitors c WHERE c.site_id = s.id) AS competitors
     FROM sites s WHERE s.user_id = ? ORDER BY s.created_at`,
    userId
  )
}

export function siteOf(userId, siteId) {
  return get('SELECT * FROM sites WHERE id = ? AND user_id = ?', Number(siteId), userId)
}

export function keywordsOf(siteId) {
  return all('SELECT * FROM keywords WHERE site_id = ? ORDER BY phrase', siteId)
}

/** Latest position per keyword + engine, with the previous reading for delta. */
export function latestPositions(siteId, { days = 30 } = {}) {
  const rows = all(
    `SELECT p.*, k.phrase, k.intent, s.domain
     FROM positions p
     JOIN keywords k ON k.id = p.keyword_id
     JOIN sites s ON s.id = k.site_id
     WHERE k.site_id = ? AND p.serp_date >= date('now', ?)
     ORDER BY p.serp_date DESC`,
    siteId,
    `-${Number(days)} days`
  )
  const byKey = new Map()
  for (const row of rows) {
    const key = `${row.keyword_id}:${row.engine}`
    if (!byKey.has(key)) byKey.set(key, { current: row, previous: null })
    else if (!byKey.get(key).previous) byKey.get(key).previous = row
  }
  return [...byKey.values()].map(({ current, previous }) => ({
    keywordId: current.keyword_id,
    phrase: current.phrase,
    intent: current.intent,
    engine: current.engine,
    position: current.position,
    previous: previous ? previous.position : null,
    delta:
      current.position != null && previous && previous.position != null
        ? previous.position - current.position
        : null,
    url: current.url,
    title: current.title,
    date: current.serp_date,
    features: safeJson(current.features, []),
    competitors: safeJson(current.competitors, {})
  }))
}

/** History for one keyword+engine as [date, position]. */
export function history(keywordId, engine = 'google', limit = 90) {
  return all(
    `SELECT serp_date AS date, position FROM positions
     WHERE keyword_id = ? AND engine = ? ORDER BY serp_date DESC LIMIT ?`,
    Number(keywordId),
    engine,
    Number(limit)
  ).reverse()
}

export function summary(userId) {
  const totals = get(
    `SELECT COUNT(DISTINCT k.id) AS keywords,
            COUNT(DISTINCT s.id) AS sites
     FROM sites s LEFT JOIN keywords k ON k.site_id = s.id
     WHERE s.user_id = ?`,
    userId
  )
  const top10 = get(
    `SELECT COUNT(*) AS n FROM (
       SELECT p.keyword_id, p.engine, MAX(p.serp_date) AS d, p.position
       FROM positions p
       JOIN keywords k ON k.id = p.keyword_id
       JOIN sites s ON s.id = k.site_id
       WHERE s.user_id = ? GROUP BY p.keyword_id, p.engine
     ) WHERE position BETWEEN 1 AND 10`,
    userId
  )
  const avg = get(
    `SELECT ROUND(AVG(position), 1) AS avg FROM positions p
     JOIN keywords k ON k.id = p.keyword_id
     JOIN sites s ON s.id = k.site_id
     WHERE s.user_id = ? AND p.position IS NOT NULL
       AND p.serp_date >= date('now', '-7 days')`,
    userId
  )
  const alerts = get(
    'SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL',
    userId
  )
  return {
    sites: totals?.sites || 0,
    keywords: totals?.keywords || 0,
    top10: top10?.n || 0,
    avgPosition: avg?.avg ?? null,
    unreadAlerts: alerts?.n || 0
  }
}

export function featureCounts(siteId) {
  const rows = all(
    `SELECT p.features FROM positions p
     JOIN keywords k ON k.id = p.keyword_id
     WHERE k.site_id = ? AND p.serp_date >= date('now', '-30 days')`,
    siteId
  )
  const counts = new Map()
  for (const row of rows) {
    for (const f of safeJson(row.features, [])) counts.set(f, (counts.get(f) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count)
}

export function cannibalization(siteId) {
  // keywords where two different URLs of the same domain ranked in the last 30 days
  const rows = all(
    `SELECT k.phrase, p.url, COUNT(*) AS days, MAX(p.serp_date) AS last_seen
     FROM positions p JOIN keywords k ON k.id = p.keyword_id
     WHERE k.site_id = ? AND p.serp_date >= date('now', '-30 days') AND p.url IS NOT NULL
     GROUP BY k.id, p.url
     ORDER BY k.phrase`,
    siteId
  )
  const byPhrase = new Map()
  for (const row of rows) {
    if (!byPhrase.has(row.phrase)) byPhrase.set(row.phrase, [])
    byPhrase.get(row.phrase).push({ url: row.url, days: row.days, lastSeen: row.last_seen })
  }
  return [...byPhrase.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([phrase, urls]) => ({ phrase, urls }))
}

export function competitorOverview(siteId) {
  const site = get('SELECT id, domain FROM sites WHERE id = ?', Number(siteId))
  if (!site) return []
  const rows = all(
    `SELECT p.position, p.competitors FROM positions p
     JOIN keywords k ON k.id = p.keyword_id
     WHERE k.site_id = ? AND p.serp_date >= date('now', '-30 days')`,
    siteId
  )
  const own = String(site.domain || '').replace(/^www\./, '')
  const score = new Map()
  const win = (position) => Math.max(0, 31 - Number(position))

  for (const row of rows) {
    // the tracked site itself is part of the visibility picture
    if (row.position != null) score.set(own, (score.get(own) || 0) + win(row.position))
    const comps = safeJson(row.competitors, {})
    for (const [domain, position] of Object.entries(comps)) {
      const key = String(domain).replace(/^www\./, '')
      score.set(key, (score.get(key) || 0) + win(position))
    }
  }

  const sorted = [...score.entries()].sort((a, b) => b[1] - a[1])
  const max = sorted[0]?.[1] || 1
  return sorted.map(([domain, points]) => ({
    domain,
    visibility: Math.round((points / max) * 100),
    points,
    you: domain === own
  }))
}

/** Biggest risers and fallers over the selected window. */
export function movers(siteId, days = 7, limit = 8) {
  const rows = latestPositions(siteId, { days })
  return rows
    .filter((row) => row.delta != null && row.delta !== 0)
    .map((row) => ({
      phrase: row.phrase,
      engine: row.engine,
      position: row.position,
      previous: row.previous,
      delta: row.delta,
      date: row.date
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, Number(limit) || 8)
}

export function recentRuns(userId, limit = 20) {
  return all('SELECT * FROM runs WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, Number(limit))
}

export function recentDeliveries(userId, limit = 20) {
  return all('SELECT * FROM deliveries WHERE user_id = ? ORDER BY id DESC LIMIT ?', userId, Number(limit))
}

export function alertsOf(userId, { unreadOnly = false, limit = 100 } = {}) {
  return all(
    `SELECT a.*, k.phrase FROM alerts a LEFT JOIN keywords k ON k.id = a.keyword_id
     WHERE a.user_id = ? ${unreadOnly ? 'AND a.read_at IS NULL' : ''}
     ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    userId,
    Number(limit)
  )
}

export function audit(userId, action, target = '', ip = '') {
  try {
    run('INSERT INTO audit_log (user_id, action, target, ip) VALUES (?, ?, ?, ?)', userId ?? null, action, target, ip)
  } catch {
    /* never throw on audit */
  }
}
