/**
 * Scheduled checks ("jobs").
 *
 * A job says: at HH:MM on these weekdays, collect this site.
 * The runner is a single interval that wakes up every minute and looks for jobs
 * whose local time has arrived — no external cron, no dependency.
 */
import { all, get, run } from '../db.js'
import { config } from '../config.js'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function listJobs(userId, { limit = 50 } = {}) {
  return all(
    `SELECT j.*, s.domain, s.label FROM jobs j
     JOIN sites s ON s.id = j.site_id
     WHERE j.user_id = ? ORDER BY j.hour, j.minute LIMIT ?`,
    userId,
    Number(limit)
  ).map((j) => ({ ...j, days: parseDays(j.days), dayNames: parseDays(j.days).map((d) => DAY_NAMES[d]) }))
}

function parseDays(csv) {
  return String(csv || '')
    .split(',')
    .map((d) => Number(d))
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
}

export function createJob(userId, { siteId, days, hour, minute = 0 }) {
  const csv = [...new Set(days.map(Number))]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort()
    .join(',')
  const result = run(
    `INSERT INTO jobs (user_id, site_id, days, hour, minute) VALUES (?, ?, ?, ?, ?)`,
    userId,
    siteId,
    csv,
    Number(hour),
    Number(minute)
  )
  return listJobs(userId).find((j) => j.id === Number(result.lastInsertRowid)) || null
}

export function deleteJob(userId, jobId) {
  const job = get('SELECT id FROM jobs WHERE id = ? AND user_id = ?', Number(jobId), userId)
  if (!job) return false
  run('DELETE FROM jobs WHERE id = ?', job.id)
  return true
}

/** Jobs whose time matches now (same hour+minute, day enabled) and that did
 *  not run yet today. `now` is injectable for tests. */
export function dueJobs(now = new Date()) {
  const day = now.getUTCDay()
  const hour = now.getUTCHours()
  const minute = now.getUTCMinutes()
  const today = now.toISOString().slice(0, 10)

  return all(
    `SELECT j.*, s.domain, s.user_id AS owner_id FROM jobs j
     JOIN sites s ON s.id = j.site_id
     WHERE j.enabled = 1 AND j.hour = ? AND j.minute = ?
       AND (',' || j.days || ',') LIKE ?
       AND (j.last_run_date IS NULL OR j.last_run_date <> ?)`,
    hour,
    minute,
    `%,${day},%`,
    today
  )
}

export function markJobRun(jobId, status = 'ok') {
  run(
    `UPDATE jobs SET last_run_date = date('now'), last_run_at = datetime('now'), last_status = ? WHERE id = ?`,
    status,
    Number(jobId)
  )
}

/**
 * Every minute: fire due jobs. `collect` is injected so tests do not need the SERP layer.
 * @param {(siteId:number, opts:object)=>Promise<any>} collect
 */
export function startJobRunner(collect, { intervalMs = 60_000, log = console } = {}) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const jobs = dueJobs(new Date())
      for (const job of jobs) {
        if (!config.scheduler.enabled) break
        try {
          log.info?.(`[jobs] running ${job.domain} (job #${job.id})`)
          await collect(job.site_id, { trigger: 'cron' })
          markJobRun(job.id, 'ok')
        } catch (err) {
          log.warn?.(`[jobs] ${job.domain} failed: ${err.message}`)
          markJobRun(job.id, 'failed')
        }
      }
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => tick().catch(() => {}), intervalMs)
  timer.unref?.()
  return { stop: () => clearInterval(timer), tick }
}
