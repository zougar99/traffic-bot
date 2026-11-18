/**
 * Configuration — every value has a safe default so the app boots with
 * zero setup. Override with environment variables (see .env.example).
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

/** Minimal .env loader (no dependency). Lines: KEY=value, # comments. */
function loadDotEnv(file = path.join(ROOT, '.env')) {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = val
  }
}

loadDotEnv()

const dataDir = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'))
fs.mkdirSync(dataDir, { recursive: true })

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function num(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** Secrets live in data/ so a fresh clone works without setup. */
function persistentSecret(name) {
  const envValue = process.env[name]
  if (envValue) return envValue
  const file = path.join(dataDir, '.secret')
  let secret = ''
  if (fs.existsSync(file)) secret = fs.readFileSync(file, 'utf8').trim()
  if (!secret) {
    secret = crypto.randomBytes(32).toString('base64url')
    fs.writeFileSync(file, secret, { mode: 0o600 })
  }
  return crypto.createHash('sha256').update(name + ':' + secret).digest('base64url')
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 4170),
  host: process.env.HOST || '0.0.0.0',

  dataDir,
  dbFile: path.resolve(process.env.DB_FILE || path.join(dataDir, 'rank-tracker.db')),

  sessionSecret: persistentSecret('SESSION_SECRET'),
  sessionDays: num(process.env.SESSION_DAYS, 14),
  cookieName: process.env.COOKIE_NAME || 'rt_session',
  secureCookies: bool(process.env.COOKIE_SECURE, false),

  /** first-run account creation is allowed only while no user exists */
  allowBootstrap: bool(process.env.ALLOW_BOOTSTRAP, true),

  serp: {
    provider: process.env.SERP_PROVIDER || 'auto', // auto | mock | serper | serpapi
    serperKey: process.env.SERPER_API_KEY || '',
    serpapiKey: process.env.SERPAPI_API_KEY || '',
    timeoutMs: num(process.env.SERP_TIMEOUT_MS, 20000),
    languages: { google: 'en', bing: 'en', yahoo: 'en', duckduckgo: 'en' }
  },

  alerts: {
    telegram: {
      enabled: bool(process.env.TELEGRAM_ENABLED, false),
      token: process.env.TELEGRAM_BOT_TOKEN || '',
      chatId: process.env.TELEGRAM_CHAT_ID || ''
    },
    sheets: {
      enabled: bool(process.env.GOOGLE_SHEETS_ENABLED, false),
      scriptUrl: process.env.GOOGLE_SHEETS_WEBHOOK_URL || '',
      sheetId: process.env.GOOGLE_SHEETS_ID || '',
      token: process.env.GOOGLE_SHEETS_TOKEN || ''
    },
    email: {
      enabled: bool(process.env.EMAIL_ALERTS_ENABLED, false),
      webhookUrl: process.env.EMAIL_WEBHOOK_URL || '',
      to: process.env.EMAIL_ALERT_TO || '',
      token: process.env.EMAIL_WEBHOOK_TOKEN || ''
    }
  },

  integrations: {
    searchConsole: {
      enabled: bool(process.env.GSC_ENABLED, false),
      property: process.env.GSC_PROPERTY || '',
      clientEmail: process.env.GSC_CLIENT_EMAIL || '',
      privateKey: (process.env.GSC_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    },
    ga4: {
      enabled: bool(process.env.GA4_ENABLED, false),
      propertyId: process.env.GA4_PROPERTY_ID || '',
      clientEmail: process.env.GA4_CLIENT_EMAIL || '',
      privateKey: (process.env.GA4_PRIVATE_KEY || '').replace(/\\n/g, '\n')
    },
    crux: { enabled: bool(process.env.CRUX_ENABLED, false), apiKey: process.env.CRUX_API_KEY || '' }
  },

  scheduler: {
    enabled: bool(process.env.SCHEDULER_ENABLED, true),
    intervalMinutes: num(process.env.SCHEDULER_INTERVAL_MINUTES, 60),
    runOnBoot: bool(process.env.SCHEDULER_RUN_ON_BOOT, false)
  },

  limits: {
    maxKeywordsPerUser: num(process.env.MAX_KEYWORDS, 500),
    maxSitesPerUser: num(process.env.MAX_SITES, 20),
    maxSessionsPerDay: num(process.env.MAX_SESSIONS_PER_DAY, 5000)
  }
}

/** true when at least one real SERP provider key is configured */
export const hasSerpKey = Boolean(config.serp.serperKey || config.serp.serpapiKey)
