#!/usr/bin/env node
/**
 * Demo seed: an owner account, a site, keywords, competitors and 45 days of
 * history so the dashboard is not empty on first launch.
 *
 *   npm run seed
 *   npm run seed -- --email me@x.com --password 'super-secret-123' --site mysite.com
 *
 * Uses the mock SERP provider (no API key, no cost).
 */
import { migrate, run, get, close } from '../src/db.js'
import { hashPassword, randomId } from '../src/lib/auth.js'
import { normalizeDomain } from '../src/lib/auth.js'
import { collectSite } from '../src/lib/collector.js'
import { config } from '../src/config.js'

const args = parseArgs(process.argv.slice(2))
const email = (args.email || 'owner@localhost').toLowerCase()
const password = args.password || 'rank-tracker-demo'
const domain = normalizeDomain(args.site || 'demo-site.com')
const keywords = (
  args.keywords ||
  'best seo tools,how to rank on google,seo audit checklist,keyword research for beginners,local seo services,technical seo vs on page seo,google search console tutorial,bing webmaster tools,best rank tracker 2026,seo pricing'
)
  .split(',')
  .map((k) => k.trim())
  .filter(Boolean)

migrate()

let user = get('SELECT * FROM users WHERE email = ?', email)
if (!user) {
  const id = run(
    'INSERT INTO users (email, name, password_hash, role, api_key) VALUES (?, ?, ?, ?, ?)',
    email,
    'Demo Owner',
    hashPassword(password),
    'owner',
    'rt_' + randomId(24)
  ).lastInsertRowid
  user = get('SELECT * FROM users WHERE id = ?', id)
  console.log(`created user ${email} (password: ${password})`)
} else {
  console.log(`user ${email} already exists`)
}

let site = get('SELECT * FROM sites WHERE user_id = ? AND domain = ?', user.id, domain)
if (!site) {
  const id = run(
    'INSERT INTO sites (user_id, domain, label, country, language) VALUES (?, ?, ?, ?, ?)',
    user.id,
    domain,
    domain,
    'us',
    'en'
  ).lastInsertRowid
  site = get('SELECT * FROM sites WHERE id = ?', id)
  console.log(`created site ${domain}`)
}

for (const competitor of ['ahrefs.com', 'semrush.com', 'moz.com']) {
  run('INSERT OR IGNORE INTO competitors (site_id, domain) VALUES (?, ?)', site.id, competitor)
}

const { classifyIntent } = await import('../src/lib/serp.js')
const { clusterName } = await import('../src/lib/collector.js')

for (const phrase of keywords) {
  const intent = classifyIntent(phrase)
  run(
    `INSERT OR IGNORE INTO keywords (site_id, phrase, intent, cluster, engines)
     VALUES (?, ?, ?, ?, 'google,bing')`,
    site.id,
    phrase,
    intent,
    clusterName(phrase, intent)
  )
}
console.log(`keywords: ${keywords.length}`)

console.log(`collecting ${45} days of history (mock provider, no API calls)…`)
const days = Number(args.days || 45)
for (let i = days; i >= 0; i--) {
  const date = new Date()
  date.setDate(date.getDate() - i)
  const iso = date.toISOString().slice(0, 10)
  process.env.SERP_PROVIDER = 'mock'
  await collectSite(site.id, { engines: ['google', 'bing'], trigger: 'seed', date: iso, seed: iso })
  process.stdout.write(`\r  day ${days - i + 1}/${days + 1}`)
}
process.stdout.write('\n')

console.log(`
done — data written to ${config.dbFile}
start the app:  npm start
sign in with:   ${email} / ${password}
`)
close()

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) {
      out[key] = next
      i++
    } else {
      out[key] = true
    }
  }
  return out
}
