/**
 * Rank Tracker Pro — HTTP server.
 *
 *  · static dashboard in public/ (no bundler)
 *  · JSON API under /api (session cookie or Bearer API key)
 *  · optional cron collector (scheduler.enabled)
 *
 * Node 22 only, zero runtime dependencies.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.js'
import { migrate, get, run } from './db.js'
import { parseCookies, json, html, redirect, HttpError, clientIp } from './lib/auth.js'
import { sessionUser, loginPage, doLogin, doBootstrap, doLogout, changePassword } from './routes/auth.js'
import { handleApi } from './routes/api.js'
import * as repo from './lib/repo.js'
import { collectSite } from './lib/collector.js'
import { providerName } from './lib/serp.js'
import { startJobRunner } from './lib/jobs.js'

const PUBLIC_DIR = path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'public')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
}

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'same-origin',
  'permissions-policy': 'geolocation=(), microphone=(), camera=()'
}

export function createApp() {
  migrate()

  const server = http.createServer(async (req, res) => {
    const started = Date.now()
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
    const cookies = parseCookies(req.headers.cookie || '')

    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v)

    const ctx = {
      req,
      res,
      method: (req.method || 'GET').toUpperCase(),
      pathname: decodeURIComponent(url.pathname),
      query: url.searchParams,
      cookies,
      user: null,
      viaApi: false,
      params: {}
    }

    try {
      /* ---------- auth resolution ---------- */
      const header = req.headers.authorization || ''
      if (header.startsWith('Bearer ')) {
        const user = repo.userByApiKey(header.slice(7).trim())
        if (user) {
          ctx.user = user
          ctx.viaApi = true
        }
      }
      if (!ctx.user) ctx.user = sessionUser(cookies[config.cookieName])

      /* ---------- routes ---------- */
      if (ctx.pathname.startsWith('/api/')) {
        if (ctx.method === 'POST' && ctx.pathname === '/api/login') return await doLogin(ctx)
        if (ctx.method === 'POST' && ctx.pathname === '/api/bootstrap') return await doBootstrap(ctx)
        if (ctx.method === 'POST' && ctx.pathname === '/api/logout') return await doLogout(ctx)
        if (ctx.method === 'POST' && ctx.pathname === '/api/password') return await changePassword(ctx)

        const handled = await handleApi(ctx)
        if (handled === false) return json(res, 404, { error: 'not found' })
        return
      }

      if (ctx.pathname === '/login') return await loginPage(ctx)
      if (ctx.pathname === '/logout') {
        const sessionId = cookies[config.cookieName]
        run('DELETE FROM sessions WHERE id = ?', sessionId || '')
        res.setHeader('set-cookie', `${config.cookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`)
        return redirect(res, '/login')
      }
      if (ctx.pathname === '/healthz') return json(res, 200, { ok: true })

      /* ---------- dashboard (requires a session) ---------- */
      if (!ctx.user) return redirect(res, '/login')

      if (ctx.pathname === '/' || ctx.pathname === '/index.html') {
        return serveFile(ctx, path.join(PUBLIC_DIR, 'index.html'))
      }

      return serveStatic(ctx)
    } catch (err) {
      const status = err instanceof HttpError || err.status ? err.status || 400 : 500
      if (status >= 500) console.error('[error]', err)
      if (ctx.pathname.startsWith('/api/')) {
        return json(res, status, { error: err.message || 'server error' })
      }
      return html(
        res,
        status,
        `<!doctype html><meta charset="utf-8"><title>${status}</title><body style="font:16px/1.6 system-ui;padding:40px;background:#0b1220;color:#e6edf3"><h1>${status}</h1><p>${escape(err.message || 'Something went wrong')}</p><a style="color:#22d3ee" href="/">Back to dashboard</a>`
      )
    } finally {
      const ms = Date.now() - started
      if (config.env !== 'test') {
        const level = res.statusCode >= 500 ? 'error' : 'info'
        console[level](`${ctx.method} ${ctx.pathname} ${res.statusCode} ${ms}ms`)
      }
    }
  })

  return server
}

function serveFile(ctx, file) {
  if (!fs.existsSync(file)) throw new HttpError(404, 'not found')
  const ext = path.extname(file).toLowerCase()
  const body = fs.readFileSync(file)
  ctx.res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': body.length,
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300'
  })
  ctx.res.end(body)
}

function serveStatic(ctx) {
  const rel = ctx.pathname.replace(/^\/+/, '')
  if (!rel || rel.includes('..')) throw new HttpError(404, 'not found')
  const file = path.join(PUBLIC_DIR, rel)
  if (!file.startsWith(PUBLIC_DIR)) throw new HttpError(404, 'not found')
  return serveFile(ctx, file)
}

function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/* ------------------------------------------------------------------ *
 * Scheduler — collects every site when due (default: hourly).
 * ------------------------------------------------------------------ */
async function tickScheduler() {
  if (!config.scheduler.enabled) return
  const sites = get(
    `SELECT s.id, s.user_id, s.domain FROM sites s
     WHERE NOT EXISTS (
       SELECT 1 FROM runs r WHERE r.user_id = s.user_id
         AND r.started_at >= datetime('now', ?)
     ) LIMIT 25`,
    `-${Number(config.scheduler.intervalMinutes)} minutes`
  )
  const list = Array.isArray(sites) ? sites : sites ? [sites] : []
  for (const site of list) {
    try {
      const result = await collectSite(site.id, { trigger: 'cron' })
      console.log(`[cron] ${site.domain}: ${result.ok} readings, ${result.errors} errors`)
    } catch (err) {
      console.warn(`[cron] ${site.domain} failed: ${err.message}`)
    }
  }
}

/* ------------------------------------------------------------------ *
 * Boot
 * ------------------------------------------------------------------ */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isMain) {
  const server = createApp()
  server.listen(config.port, config.host, () => {
    console.log('')
    console.log('  Rank Tracker Pro')
    console.log('  ────────────────────────────────')
    console.log(`  url       http://localhost:${config.port}`)
    console.log(`  env       ${config.env}`)
    console.log(`  database  ${config.dbFile}`)
    console.log(`  provider  ${providerName()}${providerName() === 'mock' ? '  (no SERP key — demo data)' : ''}`)
    console.log(`  cron      ${config.scheduler.enabled ? `every ${config.scheduler.intervalMinutes} min` : 'disabled'}`)
    console.log('')
  })

  if (config.scheduler.enabled) {
    const interval = Math.max(5, config.scheduler.intervalMinutes) * 60_000
    setInterval(() => tickScheduler().catch(() => {}), interval).unref()
    if (config.scheduler.runOnBoot) setTimeout(() => tickScheduler().catch(() => {}), 5000).unref()

    // user-defined jobs ("every weekday at 09:00")
    const runner = startJobRunner((siteId, opts) => collectSite(siteId, opts))
    console.log(`  jobs      checking every 60s`)
    process.on('SIGTERM', () => runner.stop())
    process.on('SIGINT', () => runner.stop())
  }

  const shutdown = () => {
    console.log('\n[shutdown] closing…')
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

export { tickScheduler }
