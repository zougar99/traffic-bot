/**
 * Tiny database layer on top of node:sqlite (built into Node 22.5+).
 * No native build, no dependency, real transactions and prepared statements.
 */
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'

const db = new DatabaseSync(config.dbFile)

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
`)

export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL DEFAULT '',
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'owner',      -- owner | editor | viewer
  plan          TEXT    NOT NULL DEFAULT 'free',
  api_key       TEXT    UNIQUE,
  timezone      TEXT    NOT NULL DEFAULT 'UTC',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,
  label       TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT 'us',
  language    TEXT NOT NULL DEFAULT 'en',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, domain)
);

CREATE TABLE IF NOT EXISTS competitors (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  domain  TEXT NOT NULL,
  UNIQUE (site_id, domain)
);

CREATE TABLE IF NOT EXISTS keywords (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  phrase          TEXT NOT NULL,
  intent          TEXT NOT NULL DEFAULT 'unknown',   -- informational | transactional | local | navigational | unknown
  cluster         TEXT NOT NULL DEFAULT '',
  engines         TEXT NOT NULL DEFAULT 'google',    -- csv
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, phrase)
);

CREATE TABLE IF NOT EXISTS positions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id     INTEGER NOT NULL REFERENCES keywords(id) ON DELETE CASCADE,
  engine         TEXT NOT NULL,
  position       INTEGER,                            -- NULL = not in top N
  url            TEXT,
  title          TEXT,
  serp_date      TEXT NOT NULL,                      -- YYYY-MM-DD
  features       TEXT NOT NULL DEFAULT '[]',         -- JSON array
  competitors    TEXT NOT NULL DEFAULT '{}',         -- JSON {domain: position}
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (keyword_id, engine, serp_date)
);

CREATE INDEX IF NOT EXISTS idx_positions_kw_date ON positions(keyword_id, serp_date);
CREATE INDEX IF NOT EXISTS idx_keywords_site     ON keywords(site_id);

CREATE TABLE IF NOT EXISTS alerts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  keyword_id INTEGER REFERENCES keywords(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                          -- drop | gain | cannibalization | decay | new | lost
  severity   TEXT NOT NULL DEFAULT 'info',           -- info | warning | critical
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  payload    TEXT NOT NULL DEFAULT '{}',
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts(user_id, created_at);

CREATE TABLE IF NOT EXISTS runs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  engine       TEXT NOT NULL DEFAULT 'all',
  keyword_count INTEGER NOT NULL DEFAULT 0,
  ok_count     INTEGER NOT NULL DEFAULT 0,
  error_count  INTEGER NOT NULL DEFAULT 0,
  provider     TEXT NOT NULL DEFAULT '',
  trigger      TEXT NOT NULL DEFAULT 'manual',       -- manual | cron | api
  status       TEXT NOT NULL DEFAULT 'running',      -- running | done | failed
  error        TEXT NOT NULL DEFAULT '',
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at  TEXT
);

CREATE TABLE IF NOT EXISTS deliveries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel    TEXT NOT NULL,                          -- telegram | sheets | email
  status     TEXT NOT NULL,                          -- ok | failed
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,                       -- YYYY-MM-DD
  source        TEXT NOT NULL,                       -- gsc | ga4 | crux
  payload       TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, day, source)
);


CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id       INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  days          TEXT NOT NULL DEFAULT '1,2,3,4,5',   -- 0=Sun … 6=Sat
  hour          INTEGER NOT NULL DEFAULT 9,
  minute        INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_run_date TEXT,
  last_run_at   TEXT,
  last_status   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(hour, minute, enabled);

CREATE TABLE IF NOT EXISTS audit_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`

export function migrate() {
  db.exec(schema)
  return db
}

/* ---------- helpers ---------- */
export function all(sql, ...params) {
  return db.prepare(sql).all(...params)
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params) ?? null
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params)
}

export function transaction(fn) {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    try { db.exec('ROLLBACK') } catch {}
    throw err
  }
}

export function close() {
  try { db.close() } catch {}
}

export default db
