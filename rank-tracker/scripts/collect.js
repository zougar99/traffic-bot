#!/usr/bin/env node
/**
 * Run a collection from the CLI (handy for cron / CI).
 *
 *   npm run collect
 *   npm run collect -- --site 1 --engines google,bing
 *   npm run collect -- --all
 */
import { migrate, all, get } from '../src/db.js'
import { collectSite } from '../src/lib/collector.js'

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (!cur.startsWith('--')) return acc
    const next = arr[i + 1]
    if (next && !next.startsWith('--')) acc.push([cur.slice(2), next])
    else acc.push([cur.slice(2), true])
    return acc
  }, [])
)

migrate()

const engines = args.engines ? String(args.engines).split(',').map((e) => e.trim()) : undefined
const targets = args.all
  ? all('SELECT id, domain FROM sites')
  : args.site
  ? [get('SELECT id, domain FROM sites WHERE id = ?', Number(args.site))].filter(Boolean)
  : []

if (!targets.length) {
  console.error('no site selected — use --site <id> or --all')
  process.exit(1)
}

let failures = 0
for (const site of targets) {
  const started = Date.now()
  const result = await collectSite(site.id, { engines, trigger: 'cli' })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(
    `${site.domain.padEnd(28)} ok=${String(result.ok).padStart(4)} errors=${String(result.errors).padStart(3)} alerts=${String(result.alerts.length).padStart(3)} provider=${result.provider} ${seconds}s`
  )
  if (result.errors && !result.ok) failures += 1
}
process.exit(failures ? 1 : 0)
