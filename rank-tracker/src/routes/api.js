/**
 * JSON API. Authenticated either by session cookie (dashboard) or by
 * `Authorization: Bearer <api_key>` (automation, Sheets scripts, cron jobs).
 */
import { readJson, json, normalizeDomain, clientIp, HttpError } from '../lib/auth.js'
import { all, get, run } from '../db.js'
import { ENGINES } from '../lib/serp.js'
import * as repo from '../lib/repo.js'
import { collectSite, today, clusterKeywords, contentBrief, clusterName, contentDecay } from '../lib/collector.js'
import { classifyIntent } from '../lib/serp.js'
import { buildDigest, digestForUser, pushSheet, sendEmail, sendTelegram, sheetRows } from '../lib/notify.js'
import { listJobs, createJob, deleteJob } from '../lib/jobs.js'
import { buildCalendar } from '../lib/calendar.js'
import { verifyList, buildNewsletter, unsubscribeUrl, sendTransactional } from '../lib/email.js'
import { scoreSubmission, blocklist } from '../lib/shield.js'
import { checkSite } from '../lib/synthetic.js'
import { BudgetGuard } from '../lib/budget.js'
import { config } from '../config.js'

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'authentication required')
  if (ctx.user.role === 'viewer' && ctx.method !== 'GET') {
    throw new HttpError(403, 'viewer accounts are read-only')
  }
  return ctx.user
}

function id(value) {
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'invalid id')
  return n
}

function siteFor(ctx, siteId) {
  const site = repo.siteOf(ctx.user.id, id(siteId))
  if (!site) throw new HttpError(404, 'site not found')
  return site
}

const routes = [
  /* ------------------------------- meta ------------------------------ */
  ['GET', '/api/health', async () => ({
    ok: true,
    version: '1.0.0',
    engines: ENGINES,
    provider: (await import('../lib/serp.js')).providerName(),
    time: new Date().toISOString()
  })],

  ['GET', '/api/me', async (ctx) => {
    if (!ctx.user) return { user: null, bootstrap: repo.countUsers() === 0 && config.allowBootstrap }
    return {
      user: publicUser(ctx.user),
      summary: repo.summary(ctx.user.id),
      bootstrap: false
    }
  }],

  /* ------------------------------ overview --------------------------- */
  ['GET', '/api/overview', async (ctx) => {
    const user = requireUser(ctx)
    const sites = repo.sitesOf(user.id)
    const siteId = Number(ctx.query.get('site'))
    const site = sites.find((s) => !siteId || s.id === siteId) || sites[0] || null
    return {
      summary: repo.summary(user.id),
      sites,
      alerts: repo.alertsOf(user.id, { limit: 8 }),
      runs: repo.recentRuns(user.id, 5),
      movers: site ? repo.movers(site.id, Number(ctx.query.get('days')) || 7) : [],
      features: site ? repo.featureCounts(site.id) : [],
      cannibalization: site ? repo.cannibalization(site.id) : [],
      share: site ? repo.competitorOverview(site.id) : []
    }
  }],

  /* -------------------------------- sites ---------------------------- */
  ['GET', '/api/sites', async (ctx) => {
    const user = requireUser(ctx)
    return { sites: repo.sitesOf(user.id) }
  }],

  ['POST', '/api/sites', async (ctx) => {
    const user = requireUser(ctx)
    const body = await readJson(ctx.req)
    const domain = normalizeDomain(body.domain)
    if (!domain) throw new HttpError(400, 'invalid domain')
    const count = get('SELECT COUNT(*) AS n FROM sites WHERE user_id = ?', user.id).n
    if (count >= config.limits.maxSitesPerUser) throw new HttpError(429, 'site limit reached')

    const exists = get('SELECT id FROM sites WHERE user_id = ? AND domain = ?', user.id, domain)
    if (exists) throw new HttpError(409, 'domain already tracked')

    const result = run(
      'INSERT INTO sites (user_id, domain, label, country, language) VALUES (?, ?, ?, ?, ?)',
      user.id,
      domain,
      String(body.label || domain).slice(0, 80),
      String(body.country || 'us').slice(0, 2).toLowerCase(),
      String(body.language || 'en').slice(0, 5).toLowerCase()
    )
    repo.audit(user.id, 'site.create', domain, clientIp(ctx.req))
    return { site: repo.siteOf(user.id, result.lastInsertRowid) }
  }],

  ['DELETE', '/api/sites/:id', async (ctx) => {
    const user = requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    run('DELETE FROM sites WHERE id = ?', site.id)
    repo.audit(user.id, 'site.delete', site.domain, clientIp(ctx.req))
    return { ok: true }
  }],

  /* ------------------------------ keywords --------------------------- */
  ['GET', '/api/sites/:id/keywords', async (ctx) => {
    const user = requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    return { site, keywords: repo.keywordsOf(site.id) }
  }],

  ['POST', '/api/sites/:id/keywords', async (ctx) => {
    const user = requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    const body = await readJson(ctx.req)

    const phrases = (Array.isArray(body.phrases) ? body.phrases : String(body.phrases || body.phrase || '').split('\n'))
      .map((p) => String(p).trim())
      .filter(Boolean)

    if (!phrases.length) throw new HttpError(400, 'no keywords provided')

    const engines = (Array.isArray(body.engines) ? body.engines : ['google'])
      .map((e) => String(e).toLowerCase())
      .filter((e) => ENGINES.includes(e))
    if (!engines.length) throw new HttpError(400, 'no valid engine')

    const current = get('SELECT COUNT(*) AS n FROM keywords WHERE site_id = ?', site.id).n
    const room = config.limits.maxKeywordsPerUser - current
    const accepted = phrases.slice(0, Math.max(0, room))

    let added = 0
    for (const phrase of accepted) {
      const intent = classifyIntent(phrase)
      const result = run(
        `INSERT INTO keywords (site_id, phrase, intent, cluster, engines)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT(site_id, phrase) DO UPDATE SET engines = excluded.engines`,
        site.id,
        phrase.slice(0, 200),
        intent,
        clusterName(phrase, intent),
        engines.join(',')
      )
      if (result.changes) added += 1
    }

    repo.audit(user.id, 'keyword.add', `${site.domain}:${accepted.length}`, clientIp(ctx.req))
    return { ok: true, added, skipped: phrases.length - accepted.length }
  }],

  ['PATCH', '/api/keywords/:id', async (ctx) => {
    const user = requireUser(ctx)
    const kw = get(
      'SELECT k.* FROM keywords k JOIN sites s ON s.id = k.site_id WHERE k.id = ? AND s.user_id = ?',
      id(ctx.params.id),
      user.id
    )
    if (!kw) throw new HttpError(404, 'keyword not found')
    const body = await readJson(ctx.req)
    if (body.active != null) run('UPDATE keywords SET active = ? WHERE id = ?', body.active ? 1 : 0, kw.id)
    if (body.engines) {
      const engines = String(body.engines)
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter((e) => ENGINES.includes(e))
      run('UPDATE keywords SET engines = ? WHERE id = ?', engines.join(',') || 'google', kw.id)
    }
    return { keyword: get('SELECT * FROM keywords WHERE id = ?', kw.id) }
  }],

  ['DELETE', '/api/keywords/:id', async (ctx) => {
    const user = requireUser(ctx)
    const kw = get(
      'SELECT k.* FROM keywords k JOIN sites s ON s.id = k.site_id WHERE k.id = ? AND s.user_id = ?',
      id(ctx.params.id),
      user.id
    )
    if (!kw) throw new HttpError(404, 'keyword not found')
    run('DELETE FROM keywords WHERE id = ?', kw.id)
    return { ok: true }
  }],

  /* ----------------------------- competitors ------------------------- */
  ['GET', '/api/sites/:id/competitors', async (ctx) => {
    requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    return {
      competitors: all('SELECT * FROM competitors WHERE site_id = ?', site.id),
      overview: repo.competitorOverview(site.id)
    }
  }],

  ['POST', '/api/sites/:id/competitors', async (ctx) => {
    const user = requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    const body = await readJson(ctx.req)
    const domain = normalizeDomain(body.domain)
    if (!domain) throw new HttpError(400, 'invalid domain')
    if (domain === site.domain) throw new HttpError(400, 'cannot add the tracked site as competitor')
    run('INSERT OR IGNORE INTO competitors (site_id, domain) VALUES (?, ?)', site.id, domain)
    repo.audit(user.id, 'competitor.add', domain, clientIp(ctx.req))
    return { ok: true, overview: repo.competitorOverview(site.id) }
  }],

  ['DELETE', '/api/competitors/:id', async (ctx) => {
    requireUser(ctx)
    const row = get(
      `SELECT c.* FROM competitors c JOIN sites s ON s.id = c.site_id
       WHERE c.id = ? AND s.user_id = ?`,
      id(ctx.params.id),
      ctx.user.id
    )
    if (!row) throw new HttpError(404, 'competitor not found')
    run('DELETE FROM competitors WHERE id = ?', row.id)
    return { ok: true }
  }],

  /* ------------------------------ positions -------------------------- */
  ['GET', '/api/sites/:id/positions', async (ctx) => {
    requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    const url = new URL(ctx.req.url, 'http://x')
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 30, 1), 365)
    return {
      site,
      positions: repo.latestPositions(site.id, { days }),
      features: repo.featureCounts(site.id),
      cannibalization: repo.cannibalization(site.id),
      share: repo.competitorOverview(site.id)
    }
  }],

  ['GET', '/api/keywords/:id/history', async (ctx) => {
    requireUser(ctx)
    const kw = get(
      'SELECT k.* FROM keywords k JOIN sites s ON s.id = k.site_id WHERE k.id = ? AND s.user_id = ?',
      id(ctx.params.id),
      ctx.user.id
    )
    if (!kw) throw new HttpError(404, 'keyword not found')
    const url = new URL(ctx.req.url, 'http://x')
    const engine = String(url.searchParams.get('engine') || 'google')
    return { keyword: kw, engine, history: repo.history(kw.id, engine) }
  }],

  /* -------------------------------- collect -------------------------- */
  ['POST', '/api/sites/:id/collect', async (ctx) => {
    const user = requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    const body = await readJson(ctx.req).catch(() => ({}))
    const result = await collectSite(site.id, {
      engines: body.engines,
      trigger: ctx.viaApi ? 'api' : 'manual'
    })

    const rows = all(
      `SELECT p.serp_date, s.domain, k.phrase, p.engine, p.position, p.url
       FROM positions p JOIN keywords k ON k.id = p.keyword_id JOIN sites s ON s.id = k.site_id
       WHERE k.site_id = ? AND p.serp_date = ?`,
      site.id,
      today()
    )

    const [sheet, email, telegram] = await Promise.all([
      pushSheet(user.id, sheetRows(rows)),
      sendEmail(user.id, buildDigest(result.alerts, 1)),
      result.alerts.length
        ? sendTelegram(
            user.id,
            `<b>Rank Tracker</b>\n${site.domain}: ${result.ok} readings, ${result.alerts.length} alerts.\n` +
              result.alerts
                .slice(0, 5)
                .map((a) => `• ${escape(a.title)}`)
                .join('\n')
          )
        : Promise.resolve({ ok: false, skipped: true })
    ])

    return {
      run: result.runId,
      ok: result.ok,
      errors: result.errors,
      provider: result.provider,
      alerts: result.alerts.length,
      deliveries: {
        sheets: flag(sheet),
        email: flag(email),
        telegram: flag(telegram)
      }
    }
  }],

  /* ---------------------------- analytics ---------------------------- */
  ['GET', '/api/sites/:id/decay', async (ctx) => {
    const user = requireUser(ctx)
    siteFor(ctx, ctx.params.id)
    return { decay: contentDecay(user.id) }
  }],

  ['GET', '/api/sites/:id/cannibalization', async (ctx) => {
    requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    return { cannibalization: repo.cannibalization(site.id) }
  }],

  ['GET', '/api/sites/:id/share-of-voice', async (ctx) => {
    requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    return { share: repo.competitorOverview(site.id) }
  }],

  ['POST', '/api/sites/:id/cluster', async (ctx) => {
    requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    const updated = clusterKeywords(site.id)
    return { ok: true, updated, keywords: repo.keywordsOf(site.id) }
  }],

  ['GET', '/api/brief', async (ctx) => {
    requireUser(ctx)
    const url = new URL(ctx.req.url, 'http://x')
    const phrase = String(url.searchParams.get('phrase') || '').trim()
    if (!phrase) throw new HttpError(400, 'phrase required')
    const engine = String(url.searchParams.get('engine') || 'google')
    return { brief: await contentBrief(phrase, { engine }) }
  }],

  /* ------------------------------- alerts ---------------------------- */
  ['GET', '/api/alerts', async (ctx) => {
    const user = requireUser(ctx)
    const url = new URL(ctx.req.url, 'http://x')
    return { alerts: repo.alertsOf(user.id, { unreadOnly: url.searchParams.get('unread') === '1' }) }
  }],

  ['POST', '/api/alerts/read', async (ctx) => {
    const user = requireUser(ctx)
    const body = await readJson(ctx.req).catch(() => ({}))
    if (body.id) run('UPDATE alerts SET read_at = datetime(\'now\') WHERE id = ? AND user_id = ?', id(body.id), user.id)
    else run('UPDATE alerts SET read_at = datetime(\'now\') WHERE user_id = ? AND read_at IS NULL', user.id)
    return { ok: true, unread: get('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND read_at IS NULL', user.id).n }
  }],

  ['POST', '/api/alerts/test', async (ctx) => {
    const user = requireUser(ctx)
    const digest = buildDigest(digestForUser(user.id, 7), repo.sitesOf(user.id).length)
    const [email, telegram] = await Promise.all([sendEmail(user.id, digest), sendTelegram(user.id, digest.text.slice(0, 3500))])
    return { email: flag(email), telegram: flag(telegram) }
  }],

  /* -------------------------------- jobs ----------------------------- */
  ['GET', '/api/jobs', async (ctx) => {
    const user = requireUser(ctx)
    const url = new URL(ctx.req.url, 'http://x')
    return { jobs: listJobs(user.id, { limit: Number(url.searchParams.get('limit')) || 50 }) }
  }],

  ['POST', '/api/jobs', async (ctx) => {
    const user = requireUser(ctx)
    const body = await readJson(ctx.req)
    const site = siteFor(ctx, body.siteId)
    const days = Array.isArray(body.days) ? body.days : body.days != null ? [body.days] : []
    if (!days.length) throw new HttpError(400, 'pick at least one day (0=Sunday … 6=Saturday)')
    const hour = Number(body.hour ?? 9)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new HttpError(400, 'hour must be 0–23')
    const job = createJob(user.id, { siteId: site.id, days, hour, minute: Number(body.minute ?? 0) })
    repo.audit(user.id, 'job.create', `${site.domain} ${hour}:00`, clientIp(ctx.req))
    return { job }
  }],

  ['DELETE', '/api/jobs/:id', async (ctx) => {
    const user = requireUser(ctx)
    return { ok: deleteJob(user.id, id(ctx.params.id)) }
  }],

  /* ------------------------------ decay ------------------------------ */
  ['GET', '/api/sites/:id/calendar', async (ctx) => {
    requireUser(ctx)
    const site = siteFor(ctx, ctx.params.id)
    const url = new URL(ctx.req.url, 'http://x')
    const perWeek = Math.min(Math.max(Number(url.searchParams.get('perWeek')) || 2, 1), 7)
    const keywords = repo.keywordsOf(site.id)
    return {
      calendar: buildCalendar(keywords, { perWeek }),
      csv: ['date,topic,cluster,intent,format,notes']
        .concat(
          buildCalendar(keywords, { perWeek }).map((r) =>
            [r.date, r.topic, r.cluster, r.intent, r.format, r.notes]
              .map((v) => `"${String(v).replace(/"/g, '""')}"`)
              .join(',')
          )
        )
        .join('\n')
    }
  }],

  ['GET', '/api/decay', async (ctx) => {
    const user = requireUser(ctx)
    return { decay: contentDecay(user.id) }
  }],

  /* ------------------------------- email ----------------------------- */
  ['POST', '/api/email/verify', async (ctx) => {
    requireUser(ctx)
    const body = await readJson(ctx.req)
    const report = await verifyList(body.list || body.emails || '', {
      checkDns: body.checkDns !== false,
      limit: Math.min(Number(body.limit) || 2000, 5000)
    })
    return {
      counts: report.counts,
      total: report.total,
      quality: report.quality,
      cleaned: report.cleaned,
      sample: report.rows.slice(0, 200),
      csv: ['email,status,reason']
        .concat(report.rows.map((r) => `${r.email},${r.status},"${r.reason}"`))
        .join('\n')
    }
  }],

  ['POST', '/api/email/preview', async (ctx) => {
    requireUser(ctx)
    const body = await readJson(ctx.req)
    const message = buildNewsletter({
      title: body.title || 'Monthly update',
      intro: body.intro || 'Here is what changed this month.',
      items: Array.isArray(body.items) ? body.items : [],
      footer: body.footer
    })
    return { message, unsubscribeExample: unsubscribeUrl(process.env.PUBLIC_BASE_URL || 'http://localhost:4170', 'someone@example.com') }
  }],

  ['POST', '/api/email/send', async (ctx) => {
    const user = requireUser(ctx)
    const body = await readJson(ctx.req)
    const to = String(body.to || '').trim()
    if (!to) throw new HttpError(400, 'recipient required')
    // hard guard: only send to addresses the operator explicitly opted in
    if (!body.confirmed) throw new HttpError(400, 'confirm the recipient opted in (confirmed: true)')
    const message = buildNewsletter({
      title: body.title || 'Update',
      intro: body.intro || '',
      items: Array.isArray(body.items) ? body.items : [],
      footer: body.footer
    })
    const result = await sendTransactional({ to, subject: body.subject || body.title || 'Update', ...message })
    repo.audit(user.id, 'email.send', to, clientIp(ctx.req))
    return { result }
  }],

  /* ------------------------------- shield ---------------------------- */
  ['POST', '/api/shield/score', async (ctx) => {
    requireUser(ctx)
    const body = await readJson(ctx.req)
    const submission = body.submission || body
    const seen = new Set(Array.isArray(body.seenHashes) ? body.seenHashes : [])
    return { result: scoreSubmission(submission, { seenHashes: seen }), blocklist: blocklist() }
  }],

  ['GET', '/api/shield/blocklist', async (ctx) => {
    requireUser(ctx)
    return { blocklist: blocklist() }
  }],

  /* ----------------------------- synthetic --------------------------- */
  ['GET', '/api/check', async (ctx) => {
    requireUser(ctx)
    const url = new URL(ctx.req.url, 'http://x')
    const target = String(url.searchParams.get('url') || '').trim()
    if (!target) throw new HttpError(400, 'url required')
    return { report: await checkSite(target) }
  }],

  /* ------------------------------ budget ----------------------------- */
  ['GET', '/api/budget', async (ctx) => {
    const user = requireUser(ctx)
    const guard = new BudgetGuard({ userId: user.id })
    return { state: guard.state, limits: config.limits }
  }],

  /* ------------------------------ activity --------------------------- */
  ['GET', '/api/activity', async (ctx) => {
    const user = requireUser(ctx)
    return {
      runs: repo.recentRuns(user.id),
      deliveries: repo.recentDeliveries(user.id),
      audit: all('SELECT * FROM audit_log WHERE user_id = ? ORDER BY id DESC LIMIT 50', user.id)
    }
  }],

  /* --------------------------------- me ------------------------------ */
  ['PATCH', '/api/me', async (ctx) => {
    const user = requireUser(ctx)
    const body = await readJson(ctx.req)
    if (body.name != null) run('UPDATE users SET name = ? WHERE id = ?', String(body.name).slice(0, 80), user.id)
    if (body.timezone != null) run('UPDATE users SET timezone = ? WHERE id = ?', String(body.timezone).slice(0, 60), user.id)
    if (body.rotateApiKey) {
      const { randomId } = await import('../lib/auth.js')
      run('UPDATE users SET api_key = ? WHERE id = ?', 'rt_' + randomId(24), user.id)
    }
    return { user: publicUser(repo.userById(user.id)) }
  }]
]

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    plan: user.plan,
    timezone: user.timezone,
    apiKey: user.api_key,
    createdAt: user.created_at
  }
}

function flag(result) {
  if (!result) return 'skipped'
  if (result.skipped) return 'skipped'
  return result.ok ? 'ok' : 'failed'
}

function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function handleApi(ctx) {
  const path = ctx.pathname.replace(/\/+$/, '') || '/'
  for (const [method, pattern, handler] of routes) {
    const params = matchPattern(pattern, path)
    if (!params) continue
    if (method !== ctx.method) continue
    ctx.params = params
    const result = await handler(ctx)
    return json(ctx.res, 200, result)
  }
  return false
}

function matchPattern(pattern, path) {
  const p = pattern.split('/')
  const parts = path.split('/')
  if (p.length !== parts.length) return null
  const params = {}
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(':')) {
      params[p[i].slice(1)] = decodeURIComponent(parts[i])
    } else if (p[i] !== parts[i]) {
      return null
    }
  }
  return params
}
