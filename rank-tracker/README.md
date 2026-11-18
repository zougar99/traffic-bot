# Rank Tracker Pro

Private SEO rank tracker that runs on one small server — no SaaS subscription,
no external database, **zero npm dependencies**.

Track your positions on Google, Bing, Yahoo and DuckDuckGo, watch competitors,
get alerted the moment something moves, and export everything to Sheets or
email.

```bash
cd rank-tracker
npm start          # http://localhost:4170
```

With no `.env` it boots in **demo mode**: a deterministic mock SERP provider, so
the dashboard, charts, alerts and reports are all live without any API key.

---

## What it does

| Feature | Detail |
| --- | --- |
| **Multi-engine tracking** | Google, Bing, Yahoo, DuckDuckGo — per keyword |
| **Daily history** | every check stored, so deltas are real numbers |
| **Competitors** | add domains, see their positions next to yours |
| **Share of voice** | your visibility vs the competitive set |
| **SERP features** | featured snippet, PAA, image pack, video, local pack |
| **Movers** | biggest risers and fallers over 1/7/28 days |
| **Alerts** | drop, gain, lost, new, cannibalization, content decay |
| **Cannibalization** | two URLs of yours competing for one phrase |
| **Keywords clusters** | grouped by intent so the calendar is not random |
| **Content calendar** | week-by-week plan, CSV/ICS friendly |
| **Brief generator** | headings, questions, related terms per target phrase |
| **Email list hygiene** | syntax, disposable, role accounts, DNS MX, dedupe |
| **Anti-spam scoring** | honeypot, timing, link density, spam words → 0–100 |
| **Site check** | page/robots/sitemap latency, headers, on-page SEO fields |
| **Budget guard** | hard caps on keywords, sites, sessions |
| **Schedules** | per-site jobs (day-of-week + hour), background runner |

## Quick start

```bash
# 1. run it
cd rank-tracker
npm start

# 2. open http://localhost:4170 — the first account you create is the owner

# 3. optional: demo content (a site, 3 competitors, 10 keywords, 46 days of history)
npm run seed
# → owner@example.com / demo1234 (change it in Settings)

# 4. optional: real SERP data
cp .env.example .env     # then set SERPER_API_KEY
```

### Accounts

```bash
npm run create-user -- you@example.com 'a-long-password' --name "You"
```

Bootstrap (the setup form on the login screen) is only available while the
`users` table is empty. After that, accounts are created by the owner or the CLI.

### Collect manually

```bash
npm run collect -- --site 1                 # all enabled keywords
npm run collect -- --site 1 --date 2026-01-01   # backfill one day
```

The scheduler does the same on a timer once `SCHEDULER_ENABLED=true`.

## Architecture

```
src/
  server.js        HTTP server, router, static files, session cookie
  config.js        env config with safe defaults, .env loader
  db.js            node:sqlite schema + migrations + indexes
  routes/
    auth.js        login, logout, bootstrap, password change
    api.js         every JSON endpoint
  lib/
    auth.js        scrypt hashing, signed tokens, API keys, cookies
    serp.js        providers (serper, serpapi, mock) + result parsing
    collector.js   one check = N engines × M keywords, stored + diffed
    repo.js        queries: sites, keywords, positions, overview, movers
    notify.js      alerts + Telegram / Sheets / email delivery
    jobs.js        per-site schedules, due detection, runner
    calendar.js    content calendar generation
    email.js       list verification, unsubscribe HMAC, transactional send
    shield.js      spam scoring, rate limiting, reputation, blocklist
    synthetic.js   own-site health check (page, robots, sitemap, headers)
    budget.js      per-run hard limits
public/            the dashboard (vanilla JS, no build step)
scripts/           seed, create-user, collect
test/              node:test suite — no browser, no network
```

**Storage**: `node:sqlite` (built into Node ≥ 22.5) — a single file in
`data/`. **Auth**: scrypt password hashes, HMAC-signed session cookie,
`rt_`-prefixed API keys. **Zero dependencies**: `npm install` installs nothing,
`npm audit` has nothing to report.

## API

All routes are JSON. Authenticate with the session cookie *or*
`Authorization: Bearer rt_…`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | version, engines, active provider |
| `GET` | `/api/me` | current user, `bootstrap` flag |
| `POST` | `/api/bootstrap` | create the first owner |
| `POST` | `/api/login` · `/api/logout` | session |
| `POST` | `/api/password` | change password |
| `GET`/`POST` | `/api/sites` | list / add a site |
| `PATCH`/`DELETE` | `/api/sites/:id` | edit / remove |
| `GET`/`POST` | `/api/sites/:id/keywords` | list / bulk add (`phrases`, `engines`) |
| `PATCH`/`DELETE` | `/api/keywords/:id` | toggle engines / remove |
| `POST` | `/api/sites/:id/cluster` | auto-group keywords by intent |
| `GET`/`POST` | `/api/sites/:id/competitors` | list / add competitor |
| `POST` | `/api/sites/:id/collect` | run a check now |
| `GET` | `/api/sites/:id/positions?days=30` | table + share of voice |
| `GET` | `/api/sites/:id/calendar?perWeek=2` | content calendar (+`csv`) |
| `GET` | `/api/sites/:id/decay` | content decay signals |
| `GET` | `/api/overview` | KPIs, movers, features, cannibalization |
| `GET` | `/api/brief?phrase=…` | content brief |
| `GET` | `/api/alerts` · `POST /api/alerts/:id/read` | alerts |
| `POST` | `/api/alerts/test` | test delivery channels |
| `GET`/`POST` | `/api/jobs` · `DELETE /api/jobs/:id` | schedules |
| `POST` | `/api/email/verify` | clean/verify an email list |
| `POST` | `/api/email/preview` · `/api/email/send` | newsletter (needs `confirmed:true`) |
| `POST` | `/api/shield/score` | score a form submission |
| `GET` | `/api/shield/blocklist` | recent blocked IPs |
| `GET` | `/api/check?url=…` | on-page/robots/sitemap health of **your** site |
| `GET` | `/api/budget` | current budget state |
| `GET` | `/api/keys` · `POST /api/keys/rotate` | API keys |

```bash
curl -s localhost:4170/api/health
curl -s -H "Authorization: Bearer rt_xxx" localhost:4170/api/sites/1/positions?days=7
```

## Scope and ethics

This tool reads public search results for sites **you own** and reports what it
finds. It does not post comments, click ads, generate traffic to third-party
sites, or hide from anyone. The email tools verify **opt-in** lists and the
send endpoint refuses to run without an explicit `confirmed: true`. The
anti-spam module protects your own forms. See `../README.md` for the full
statement.

## Docs

- [`docs/deploy.md`](docs/deploy.md) — VPS, Docker, systemd, HTTPS, backups, Sheets webhook
- [`docs/email.md`](docs/email.md) — verification pipeline, unsubscribe, sending
- [`docs/shield.md`](docs/shield.md) — spam scoring, rate limits, blocklist
- [`.env.example`](.env.example) — every setting

## Tests

```bash
npm test     # 18 tests, node:test, offline, ~0.4 s
```

Covers auth hashing/tokens, mock SERP determinism, position diffing, competitor
math, intent classification, cannibalization, collector inserts, email
verification, unsubscribe HMAC, spam scoring, rate limiting, budget guards,
calendar spreading and job due-detection.

MIT licensed.
