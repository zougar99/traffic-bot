/**
 * Collector — walks the keywords of a site, asks the SERP layer for each
 * engine, stores the position and derives alerts.
 *
 * Everything is idempotent per (keyword, engine, day): re-running the same day
 * updates the row instead of duplicating it.
 */
import { all, get, run, transaction } from '../db.js'
import {
  search,
  findRank,
  competitorRanks,
  classifyIntent,
  detectCannibalization,
  ENGINES
} from './serp.js'

export function today() {
  return new Date().toISOString().slice(0, 10)
}

export function enginesOf(keyword) {
  return String(keyword.engines || 'google')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((e) => ENGINES.includes(e))
}

/**
 * Collect one site.
 * @param {number} siteId
 * @param {{engines?: string[], trigger?: string, userId?: number, dryRun?: boolean}} opts
 */
export async function collectSite(siteId, opts = {}) {
  const site = get('SELECT * FROM sites WHERE id = ?', siteId)
  if (!site) throw new Error('site not found')

  const keywords = all('SELECT * FROM keywords WHERE site_id = ? AND active = 1', siteId)
  const competitors = all('SELECT domain FROM competitors WHERE site_id = ?', siteId).map((r) => r.domain)
  const date = opts.date || today()

  const enginesFilter = (opts.engines && opts.engines.length ? opts.engines : ENGINES).map((e) =>
    String(e).toLowerCase()
  )

  const runId = run(
    `INSERT INTO runs (user_id, engine, keyword_count, provider, trigger, status)
     VALUES (?, ?, ?, ?, ?, 'running')`,
    site.user_id,
    enginesFilter.length === ENGINES.length ? 'all' : enginesFilter.join(','),
    keywords.length * enginesFilter.length,
    '',
    opts.trigger || 'manual'
  ).lastInsertRowid

  let ok = 0
  let errors = 0
  let provider = ''
  const created = []
  const touchedKeywords = new Map()

  try {
    for (const kw of keywords) {
      const engines = enginesOf(kw).filter((e) => enginesFilter.includes(e))
      for (const engine of engines) {
        try {
          const out = await search(kw.phrase, {
            engine,
            country: site.country,
            language: site.language,
            domain: site.domain,
            seed: opts.seed || date
          })
          provider = out.provider
          const hit = findRank(out.results, site.domain)
          const comps = competitorRanks(out.results, competitors)

          if (opts.dryRun) {
            ok += 1
            continue
          }

          run(
            `INSERT INTO positions (keyword_id, engine, position, url, title, serp_date, features, competitors)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(keyword_id, engine, serp_date) DO UPDATE SET
               position = excluded.position,
               url      = excluded.url,
               title    = excluded.title,
               features = excluded.features,
               competitors = excluded.competitors`,
            kw.id,
            engine,
            hit ? hit.position : null,
            hit ? hit.url : null,
            hit ? hit.title : null,
            date,
            JSON.stringify(out.features || []),
            JSON.stringify(comps || {})
          )

          touchedKeywords.set(kw.id, kw)
          ok += 1
        } catch (err) {
          errors += 1
          if (errors <= 3) console.warn(`[collect] ${kw.phrase} (${engine}): ${err.message}`)
        }
      }
    }

    if (!opts.dryRun) {
      for (const kw of touchedKeywords.values()) {
        const alerts = deriveAlerts(kw, site, date)
        created.push(...alerts)
      }
    }

    run(
      `UPDATE runs SET ok_count = ?, error_count = ?, provider = ?, status = 'done',
       finished_at = datetime('now') WHERE id = ?`,
      ok,
      errors,
      provider,
      runId
    )
  } catch (err) {
    run(
      `UPDATE runs SET ok_count = ?, error_count = ?, provider = ?, status = 'failed',
       error = ?, finished_at = datetime('now') WHERE id = ?`,
      ok,
      errors,
      provider,
      String(err.message || err).slice(0, 400),
      runId
    )
    throw err
  }

  return { runId, ok, errors, provider, alerts: created, site }
}

/**
 * Alerts for one keyword:
 *  - drop / gain vs the last reading on the same engine
 *  - lost  (left the top 100) / new (entered)
 *  - cannibalization (2+ URLs of the domain ranking)
 */
export function deriveAlerts(keyword, site, date = today()) {
  const rows = all(
    `SELECT engine, position, url, serp_date FROM positions
     WHERE keyword_id = ? ORDER BY serp_date DESC, engine`,
    keyword.id
  )
  const byEngine = new Map()
  for (const row of rows) {
    if (!byEngine.has(row.engine)) byEngine.set(row.engine, [])
    byEngine.get(row.engine).push(row)
  }

  const alerts = []
  const push = (kind, severity, title, body, payload = {}) => {
    run(
      `INSERT INTO alerts (user_id, keyword_id, kind, severity, title, body, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      site.user_id,
      keyword.id,
      kind,
      severity,
      title,
      body,
      JSON.stringify(payload)
    )
    alerts.push({ kind, severity, title, body, keyword: keyword.phrase, site: site.domain })
  }

  const now = []
  for (const [engine, list] of byEngine) {
    const current = list.find((r) => r.serp_date === date)
    if (!current) continue
    const previous = list.find((r) => r.serp_date < date)
    const cur = current.position
    const prev = previous ? previous.position : null
    now.push({ engine, position: cur, url: current.url })

    if (cur == null && prev != null) {
      push('lost', 'critical', `Lost ranking: “${keyword.phrase}”`, `${site.domain} is no longer in the top results on ${engine} (was #${prev}).`, { engine, prev })
      continue
    }
    if (cur != null && prev == null) {
      push('new', 'info', `New ranking: “${keyword.phrase}”`, `Entered the results at #${cur} on ${engine}.`, { engine, position: cur })
      continue
    }
    if (cur == null || prev == null) continue

    const delta = prev - cur
    if (delta >= 3) {
      push('gain', 'info', `Up ${delta}: “${keyword.phrase}”`, `#${prev} → #${cur} on ${engine}.`, { engine, prev, position: cur })
    } else if (delta <= -3) {
      push('drop', Math.abs(delta) >= 6 ? 'critical' : 'warning', `Down ${Math.abs(delta)}: “${keyword.phrase}”`, `#${prev} → #${cur} on ${engine}.`, { engine, prev, position: cur })
    }
  }

  const cannibal = detectCannibalization(now)
  if (cannibal.length > 1) {
    push(
      'cannibalization',
      'warning',
      `Cannibalization: “${keyword.phrase}”`,
      `Two pages of ${site.domain} rank for this keyword: ${cannibal.join(', ')}.`,
      { urls: cannibal }
    )
  }

  return alerts
}

/** Keywords that dropped 3+ positions within the last 7 days, worst first. */
export function contentDecay(userId, days = 7) {
  return all(
    `WITH recent AS (
       SELECT p.keyword_id, p.engine, p.position, p.serp_date,
              ROW_NUMBER() OVER (PARTITION BY p.keyword_id, p.engine ORDER BY p.serp_date DESC) rn
       FROM positions p
       JOIN keywords k ON k.id = p.keyword_id
       JOIN sites s ON s.id = k.site_id
       WHERE s.user_id = ? AND p.serp_date >= date('now', ?)
     )
     SELECT k.phrase, s.domain, r.engine, r.position AS current, o.position AS previous,
            (o.position - r.position) AS delta
     FROM recent r
     JOIN recent o ON o.keyword_id = r.keyword_id AND o.engine = r.engine AND o.rn = 2
     JOIN keywords k ON k.id = r.keyword_id
     JOIN sites s ON s.id = k.site_id
     WHERE r.rn = 1 AND (o.position - r.position) <= -3
     ORDER BY delta ASC
     LIMIT 50`,
    userId,
    `-${Number(days)} days`
  )
}

/** Share of voice per domain for a set of keywords (latest reading each). */
export function shareOfVoice(siteId) {
  const rows = all(
    `SELECT p.competitors, p.position FROM positions p
     JOIN keywords k ON k.id = p.keyword_id
     WHERE k.site_id = ? AND p.serp_date >= date('now', '-30 days')`,
    siteId
  )
  const score = new Map()
  for (const row of rows) {
    const comps = safeJson(row.competitors, {})
    for (const [domain, pos] of Object.entries(comps)) {
      score.set(domain, (score.get(domain) || 0) + Math.max(0, 31 - Number(pos)))
    }
    if (row.position) {
      // the site itself, resolved by the caller from the keywords table
    }
  }
  return [...score.entries()]
    .map(([domain, points]) => ({ domain, points }))
    .sort((a, b) => b.points - a.points)
}

export function safeJson(text, fallback) {
  try {
    const value = JSON.parse(text)
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

/** Keyword clustering by intent — stored in keywords.cluster. */
export function clusterKeywords(siteId) {
  const keywords = all('SELECT id, phrase, intent FROM keywords WHERE site_id = ?', siteId)
  let updated = 0
  transaction(() => {
    for (const kw of keywords) {
      const intent = classifyIntent(kw.phrase)
      const cluster = clusterName(kw.phrase, intent)
      if (intent !== kw.intent) {
        run('UPDATE keywords SET intent = ?, cluster = ? WHERE id = ?', intent, cluster, kw.id)
        updated += 1
      } else {
        run('UPDATE keywords SET cluster = ? WHERE id = ?', cluster, kw.id)
      }
    }
  })
  return updated
}

const CLUSTER_RULES = [
  { name: 'pricing', test: /\b(price|pricing|cost|cheap|plan|pricing)\b/ },
  { name: 'comparison', test: /\b(vs|versus|compare|alternative|alternatives)\b/ },
  { name: 'reviews', test: /\b(review|reviews|rating|testimonial)\b/ },
  { name: 'how-to', test: /\b(how to|how do|tutorial|guide|steps)\b/ },
  { name: 'tools', test: /\b(tool|tools|software|app|platform)\b/ },
  { name: 'local', test: /\b(near me|local|in [a-z]+)\b/ },
  { name: 'definitions', test: /\b(what is|meaning|definition|defin)\b/ }
]

export function clusterName(phrase, intent) {
  const p = String(phrase).toLowerCase()
  for (const rule of CLUSTER_RULES) if (rule.test.test(p)) return rule.name
  return intent === 'unknown' ? 'general' : intent
}

/** Content brief: headings, PAA-style questions and related queries. */
export async function contentBrief(phrase, opts = {}) {
  const out = await search(phrase, { engine: opts.engine || 'google', ...opts })
  const questions = (out.related || [])
    .filter((q) => /\?$/.test(q) || /^(how|what|why|when|where|which|who|can|does|is|are)\b/i.test(q))
    .slice(0, 8)
  const titles = out.results.slice(0, 10).map((r) => r.title).filter(Boolean)
  const headings = buildHeadings(phrase, titles)
  return {
    phrase,
    provider: out.provider,
    intent: classifyIntent(phrase),
    headings,
    questions,
    related: (out.related || []).slice(0, 10),
    serpFeatures: out.features || [],
    competitors: out.results.slice(0, 5).map((r) => ({ position: r.position, url: r.url, title: r.title })),
    suggestedTitle: `${cap(phrase)}: ${new Date().getFullYear()} Guide`,
    suggestedMeta: `Everything you need to know about ${phrase.toLowerCase()} — practical steps, tools and examples.`
  }
}

function buildHeadings(phrase, titles) {
  const base = cap(phrase)
  const out = [`What is ${phrase}?`, `How ${phrase} works`]
  const hasComparison = titles.some((t) => /vs|versus|compare/i.test(t))
  const hasPricing = titles.some((t) => /price|pricing|cost/i.test(t))
  const hasTools = titles.some((t) => /tool|software|platform/i.test(t))
  if (hasComparison) out.push(`${base} vs alternatives`)
  if (hasPricing) out.push(`${base} pricing explained`)
  if (hasTools) out.push(`Best ${phrase} tools`)
  out.push(`Common mistakes with ${phrase}`, `Checklist`, `FAQ`)
  return out
}

function cap(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1)
}
