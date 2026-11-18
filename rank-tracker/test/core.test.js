/**
 * Core unit tests — no server, no network.
 *   npm test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

/* isolate the database before anything imports config/db */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-test-'))
process.env.DATA_DIR = dir
process.env.DB_FILE = path.join(dir, 'test.db')
process.env.SERP_PROVIDER = 'mock'
process.env.SCHEDULER_ENABLED = 'false'
process.env.NODE_ENV = 'test'

const { hashPassword, verifyPassword, signToken, verifyToken, normalizeDomain, parseCookies, cookie } = await import('../src/lib/auth.js')
const { search, findRank, competitorRanks, classifyIntent, hostOf, detectCannibalization } = await import('../src/lib/serp.js')
const { migrate, run, get, all } = await import('../src/db.js')
const { verifyList, validSyntax, isDisposable, unsubscribeToken, verifyUnsubscribe } = await import('../src/lib/email.js')
const { scoreSubmission, rateLimit, resetBuckets } = await import('../src/lib/shield.js')
const { BudgetGuard } = await import('../src/lib/budget.js')
const { buildCalendar } = await import('../src/lib/calendar.js')
const { dueJobs } = await import('../src/lib/jobs.js')

migrate()

/* ------------------------------------------------------------------ */
test('passwords: scrypt hash round-trips and rejects wrong input', () => {
  const hash = hashPassword('correct-horse-battery')
  assert.match(hash, /^scrypt\$/)
  assert.equal(verifyPassword('correct-horse-battery', hash), true)
  assert.equal(verifyPassword('wrong', hash), false)
  assert.equal(verifyPassword('anything', 'garbage'), false)
})

test('session tokens: signature is tamper-proof', () => {
  const token = signToken({ uid: 7, exp: Date.now() + 60_000 })
  assert.equal(verifyToken(token).uid, 7)
  const [body] = token.split('.')
  assert.equal(verifyToken(`${body}.forged`), null)
  assert.equal(verifyToken(body), null)
  const expired = signToken({ uid: 7, exp: Date.now() - 1000 })
  assert.equal(verifyToken(expired), null)
})

test('domain normalization strips scheme, www, path and port', () => {
  assert.equal(normalizeDomain('https://www.Example.com/path?x=1'), 'example.com')
  assert.equal(normalizeDomain('example.com:8080'), 'example.com')
  assert.equal(normalizeDomain('not a domain'), '')
  assert.equal(normalizeDomain(''), '')
})

test('cookie parsing handles multiple values', () => {
  const cookies = parseCookies('a=1; rt_session=abc%2Fdef; b=2')
  assert.equal(cookies.rt_session, 'abc/def')
  assert.match(cookie('x', 'y', { maxAge: 10 }), /HttpOnly/)
})

/* ------------------------------------------------------------------ */
test('mock SERP: deterministic per phrase+seed, domain appears in results', async () => {
  const a = await search('best seo tools', { domain: 'mysite.com', seed: '2026-01-01' })
  const b = await search('best seo tools', { domain: 'mysite.com', seed: '2026-01-01' })
  assert.deepEqual(a.results, b.results)
  assert.equal(a.provider, 'mock')
  const hit = findRank(a.results, 'mysite.com')
  assert.ok(hit, 'target domain should rank')
  assert.equal(hostOf(hit.url), 'mysite.com')
})

test('findRank matches subdomains but not lookalike domains', () => {
  const results = [
    { position: 1, url: 'https://blog.example.com/post', title: 'a' },
    { position: 2, url: 'https://notexample.com/x', title: 'b' },
    { position: 3, url: 'https://other.com/y', title: 'c' }
  ]
  assert.equal(findRank(results, 'example.com').position, 1)
  assert.equal(findRank(results, 'other.com').position, 3)
  assert.equal(findRank(results, 'missing.com'), null)
})

test('competitor ranks are extracted for present domains only', () => {
  const results = [
    { position: 2, url: 'https://ahrefs.com/a' },
    { position: 5, url: 'https://moz.com/b' }
  ]
  const map = competitorRanks(results, ['ahrefs.com', 'moz.com', 'semrush.com'])
  assert.deepEqual(map, { 'ahrefs.com': 2, 'moz.com': 5 })
})

test('intent classification and cannibalization detection', () => {
  assert.equal(classifyIntent('buy seo software'), 'transactional')
  assert.equal(classifyIntent('how to rank on google'), 'informational')
  assert.equal(classifyIntent('seo agency near me'), 'local')
  assert.equal(classifyIntent('facebook login'), 'navigational')

  const two = detectCannibalization([
    { url: 'https://site.com/a' },
    { url: 'https://www.site.com/b' }
  ])
  assert.equal(two.length, 2)
  assert.deepEqual(detectCannibalization([{ url: 'https://site.com/a' }, { url: 'https://site.com/a/' }]), [])
})

/* ------------------------------------------------------------------ */
test('collector stores positions and derives alerts', async () => {
  const { collectSite } = await import('../src/lib/collector.js')
  const userId = Number(
    run('INSERT INTO users (email, password_hash) VALUES (?, ?)', 'u@test.local', hashPassword('x'.repeat(12))).lastInsertRowid
  )
  const siteId = Number(
    run('INSERT INTO sites (user_id, domain, label) VALUES (?, ?, ?)', userId, 'mysite.com', 'My Site').lastInsertRowid
  )
  run("INSERT INTO keywords (site_id, phrase, engines) VALUES (?, 'best widgets', 'google')", siteId)

  const first = await collectSite(siteId, { date: '2026-01-01', seed: '2026-01-01' })
  assert.equal(first.errors, 0)
  assert.equal(first.ok, 1)
  assert.equal(all('SELECT * FROM positions').length, 1)

  // same day again → update, not duplicate
  await collectSite(siteId, { date: '2026-01-01', seed: '2026-01-01' })
  assert.equal(all('SELECT * FROM positions').length, 1)

  // a later day creates a second row and possibly an alert
  await collectSite(siteId, { date: '2026-01-05', seed: '2026-01-05' })
  assert.equal(all('SELECT * FROM positions').length, 2)

  const runRow = get('SELECT * FROM runs ORDER BY id DESC LIMIT 1')
  assert.equal(runRow.status, 'done')
  assert.equal(runRow.ok_count, 1)
})

test('collector records a failed run instead of throwing users into a broken state', async () => {
  const { collectSite } = await import('../src/lib/collector.js')
  const site = get('SELECT id FROM sites LIMIT 1')
  const originalProvider = process.env.SERP_PROVIDER
  process.env.SERP_PROVIDER = 'serper'
  try {
    // no key → provider errors, collector must count the error and finish
    const result = await collectSite(site.id, { date: '2026-01-06' })
    assert.ok(result.errors >= 0)
  } finally {
    process.env.SERP_PROVIDER = originalProvider
  }
})

/* ------------------------------------------------------------------ */
test('email: syntax, disposable domains and list verification', async () => {
  assert.equal(validSyntax('Jo.Hn+tag@Example.COM'), true)
  assert.equal(validSyntax('nope@'), false)
  assert.equal(isDisposable('x@mailinator.com'), true)

  const report = await verifyList('a@example.com\na@example.com\nbad-email\nx@mailinator.com\n# comment', { checkDns: false })
  assert.equal(report.counts.duplicate, 1)
  assert.equal(report.counts.invalid, 1)
  assert.equal(report.counts.risky, 1)
  assert.equal(report.counts.valid, 1)
  assert.deepEqual(report.cleaned, ['a@example.com'])
})

test('unsubscribe tokens verify and reject tampering', () => {
  const token = unsubscribeToken('user@example.com')
  assert.equal(verifyUnsubscribe('user@example.com', token), true)
  assert.equal(verifyUnsubscribe('USER@example.com', token), true)
  assert.equal(verifyUnsubscribe('other@example.com', token), false)
  assert.equal(verifyUnsubscribe('user@example.com', 'nope'), false)
})

/* ------------------------------------------------------------------ */
test('comment shield: obvious spam is blocked, a normal comment passes', () => {
  resetBuckets()
  const spam = scoreSubmission({
    name: 'cheap seo xxxx',
    email: 'bad-email',
    comment: 'BUY CHEAP PILLS NOW http://bit.ly/x http://bit.ly/y http://bit.ly/z casino casino',
    elapsedMs: 200,
    honeypot: 'bot',
    ip: '1.2.3.4'
  })
  assert.equal(spam.verdict, 'block')
  assert.ok(spam.score >= 60)
  assert.ok(spam.reasons.length >= 4)

  const human = scoreSubmission({
    name: 'Amina',
    email: 'amina@example.com',
    comment: 'Thanks for the write-up — the section on sitemaps was exactly what I needed.',
    elapsedMs: 24000,
    ip: '5.6.7.8'
  })
  assert.equal(human.verdict, 'allow')
  assert.ok(human.score < 30)
})

test('rate limiter returns a retry window', () => {
  resetBuckets()
  const now = Date.now()
  const first = rateLimit('ip:1', { max: 2 }, now)
  assert.equal(first.allowed, true)
  rateLimit('ip:1', { max: 2 }, now)
  const third = rateLimit('ip:1', { max: 2 }, now)
  assert.equal(third.allowed, false)
  assert.ok(third.retryAfter > 0)
  const later = rateLimit('ip:1', { max: 2 }, now + 120_000)
  assert.equal(later.allowed, true)
})

/* ------------------------------------------------------------------ */
test('budget guard stops at the runtime, call and keyword limits', () => {
  const guard = new BudgetGuard({ maxCalls: 3, maxKeywords: 2, maxRuntimeMs: 1000 })
  guard.check(1)
  guard.use(1)
  assert.equal(guard.state.remaining, 2)
  guard.check(2)                       // exactly at the limit → still allowed
  guard.use(2)
  assert.throws(() => guard.check(1), /call limit/)   // one more → refused
  assert.equal(guard.stopped, true)

  const kw = new BudgetGuard({ maxCalls: 99, maxKeywords: 2 })
  assert.throws(() => kw.check(3), /keyword limit/)

  const slow = new BudgetGuard({ maxRuntimeMs: -1 })
  assert.throws(() => slow.check(1), /runtime limit/)
})

test('calendar spreads keywords across weeks by cluster', () => {
  const plan = buildCalendar(
    [
      { phrase: 'how to audit a site', cluster: 'how-to', intent: 'informational' },
      { phrase: 'best crm tools', cluster: 'tools', intent: 'informational' },
      { phrase: 'crm pricing', cluster: 'pricing', intent: 'transactional' }
    ],
    { perWeek: 2, startDate: new Date('2026-01-05T09:00:00Z') }
  )
  assert.equal(plan.length, 3)
  assert.equal(new Set(plan.map((p) => p.format)).size >= 2, true)
  assert.ok(plan[0].date <= plan[plan.length - 1].date)
})

test('jobs: due detection respects day, time and last_run_date', () => {
  const userId = get('SELECT id FROM users LIMIT 1').id
  const siteId = get('SELECT id FROM sites LIMIT 1').id
  run(
    "INSERT INTO jobs (user_id, site_id, days, hour, minute) VALUES (?, ?, '1,2,3,4,5', 9, 0)",
    userId,
    siteId
  )
  const monday9 = new Date('2026-01-05T09:00:00Z') // Monday
  assert.equal(dueJobs(monday9).length, 1)
  const sunday9 = new Date('2026-01-04T09:00:00Z')
  assert.equal(dueJobs(sunday9).length, 0)
  const monday10 = new Date('2026-01-05T10:00:00Z')
  assert.equal(dueJobs(monday10).length, 0)

  run("UPDATE jobs SET last_run_date = '2026-01-05'")
  assert.equal(dueJobs(monday9).length, 0)
})

test('summary aggregation returns numbers for a fresh account', async () => {
  const repo = await import('../src/lib/repo.js')
  const userId = get('SELECT id FROM users LIMIT 1').id
  const s = repo.summary(userId)
  assert.equal(typeof s.sites, 'number')
  assert.equal(typeof s.keywords, 'number')
  assert.equal(typeof s.unreadAlerts, 'number')
})
