/**
 * Synthetic monitoring for sites you own.
 *
 * Runs HTTP checks (status, latency, redirect chain, robots.txt, sitemap,
 * security headers, mixed content) and prints Core-Web-Vitals-style budgets.
 * It never posts to third parties and never pretends to be a browser.
 *
 * Used by:
 *   · the CLI smoke check  (npm run check:site -- --url https://your-site.com)
 *   · the API endpoint     GET /api/check?url=…
 */
import { config } from '../config.js'

const TIMEOUT = Number(process.env.CHECK_TIMEOUT_MS || 15000)

async function timed(url, options = {}) {
  const started = Date.now()
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT)
  try {
    const res = await fetch(url, {
      redirect: options.redirect || 'follow',
      headers: { 'user-agent': 'RankTrackerPro-Monitor/1.0 (+https://github.com/zougar99/traffic-bot)' },
      signal: ac.signal
    })
    const body = options.readBody ? await res.text() : ''
    return { ok: true, status: res.status, ms: Date.now() - started, headers: res.headers, body, url: res.url }
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - started, error: String(err.message || err) }
  } finally {
    clearTimeout(timer)
  }
}

/** @param {string} url  @returns {Promise<object>} */
export async function checkSite(url) {
  const target = normalize(url)
  if (!target) throw new Error('invalid url')

  const origin = new URL(target).origin
  const results = []

  const page = await timed(target, { readBody: true })
  results.push({ name: 'page', ...summarize(page), budget: page.ms < 800 })

  const robots = await timed(origin + '/robots.txt', { readBody: true })
  const sitemapLine = robots.ok ? (robots.body.match(/sitemap:\s*(\S+)/i) || [])[1] : null
  results.push({
    name: 'robots.txt',
    ...summarize(robots),
    sitemapDeclared: Boolean(sitemapLine),
    budget: robots.status === 200
  })

  const sitemapUrl = sitemapLine || origin + '/sitemap.xml'
  const sitemap = await timed(sitemapUrl, { readBody: true })
  results.push({
    name: 'sitemap',
    url: sitemapUrl,
    ...summarize(sitemap),
    urls: sitemap.ok ? (sitemap.body.match(/<loc>/gi) || []).length : 0,
    budget: sitemap.status === 200
  })

  const headers = page.headers || new Headers()
  const security = {
    hsts: headers.get('strict-transport-security'),
    csp: headers.get('content-security-policy'),
    xfo: headers.get('x-frame-options'),
    nosniff: headers.get('x-content-type-options'),
    referrer: headers.get('referrer-policy')
  }

  const html = page.body || ''
  const mixed = /src=["']http:\/\//i.test(html) || /href=["']http:\/\//i.test(html)
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || ''
  const description = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) || [])[1] || ''
  const h1s = (html.match(/<h1[\s>]/gi) || []).length

  return {
    url: target,
    checkedAt: new Date().toISOString(),
    provider: config.env,
    results,
    security,
    seo: {
      title,
      titleLength: title.length,
      description,
      descriptionLength: description.length,
      h1Count: h1s
    },
    issues: [
      page.status >= 400 ? `page returned ${page.status}` : null,
      !page.ok ? `page unreachable: ${page.error}` : null,
      robots.status !== 200 ? 'robots.txt missing' : null,
      sitemap.status !== 200 ? 'sitemap missing or unreachable' : null,
      !security.hsts ? 'no HSTS header' : null,
      !security.csp ? 'no CSP header' : null,
      !security.xfo ? 'no X-Frame-Options' : null,
      mixed ? 'mixed content (http:// assets on https page)' : null,
      title.length > 60 ? 'title longer than 60 chars' : null,
      description.length > 160 ? 'meta description longer than 160 chars' : null,
      h1s === 0 ? 'no H1' : h1s > 1 ? 'more than one H1' : null,
      page.ms > 1500 ? `slow response (${page.ms} ms)` : null
    ].filter(Boolean)
  }
}

function summarize(res) {
  return {
    status: res.status,
    ms: res.ms,
    ok: res.ok && res.status < 400,
    error: res.error || '',
    finalUrl: res.url || ''
  }
}

function normalize(input) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  try {
    const u = new URL(withScheme)
    if (!['http:', 'https:'].includes(u.protocol)) return ''
    return u.toString()
  } catch {
    return ''
  }
}
