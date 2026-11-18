/**
 * Budget guard — hard limits so an automated run can never run away.
 *
 * Three independent caps, all configurable per user:
 *   · max keywords per run
 *   · max runtime per run  (ms)
 *   · max sessions / SERP calls per day
 *
 * `BudgetGuard` is used by the collector and by the traffic app's runner.
 */
import { all, get } from '../db.js'
import { config } from '../config.js'

export class BudgetError extends Error {
  constructor(message, code = 'budget') {
    super(message)
    this.code = code
    this.status = 429
  }
}

export function dailyUsage(userId, day = new Date().toISOString().slice(0, 10)) {
  const row = get(
    `SELECT COALESCE(SUM(keyword_count), 0) AS calls FROM runs
     WHERE user_id = ? AND date(started_at) = ?`,
    userId,
    day
  )
  return { calls: row?.calls || 0, limit: config.limits.maxSessionsPerDay }
}

export class BudgetGuard {
  /**
   * @param {{maxCalls:number, maxKeywords:number, maxRuntimeMs:number, userId?:number}} options
   */
  constructor({ maxCalls = config.limits.maxSessionsPerDay, maxKeywords = 200, maxRuntimeMs = 15 * 60_000, userId = null } = {}) {
    this.maxCalls = maxCalls
    this.maxKeywords = maxKeywords
    this.maxRuntimeMs = maxRuntimeMs
    this.userId = userId
    this.calls = 0
    this.startedAt = Date.now()
    this.stopped = false
    this.reason = ''
  }

  /** Throw if the next call would break a limit. */
  check(nextKeywords = 1) {
    if (this.stopped) throw new BudgetError(`run stopped: ${this.reason}`, 'stopped')
    if (Date.now() - this.startedAt > this.maxRuntimeMs) {
      this.stop('runtime limit reached')
      throw new BudgetError('runtime limit reached', 'runtime')
    }
    if (nextKeywords > this.maxKeywords) {
      this.stop(`keyword limit reached (${this.maxKeywords})`)
      throw new BudgetError(`keyword limit reached (${this.maxKeywords})`, 'keywords')
    }
    if (this.calls + nextKeywords > this.maxCalls) {
      this.stop(`daily call limit reached (${this.maxCalls})`)
      throw new BudgetError(`daily call limit reached (${this.maxCalls})`, 'calls')
    }
    if (this.userId) {
      const usage = dailyUsage(this.userId)
      if (usage.calls + nextKeywords > usage.limit) {
        this.stop(`daily quota reached (${usage.limit})`)
        throw new BudgetError(`daily quota reached (${usage.limit})`, 'quota')
      }
    }
    return true
  }

  /** Count consumed calls. */
  use(n = 1) {
    this.calls += n
    return this.calls
  }

  stop(reason = 'stopped by user') {
    this.stopped = true
    this.reason = reason
  }

  get state() {
    return {
      calls: this.calls,
      maxCalls: this.maxCalls,
      elapsedMs: Date.now() - this.startedAt,
      maxRuntimeMs: this.maxRuntimeMs,
      stopped: this.stopped,
      reason: this.reason,
      remaining: Math.max(0, this.maxCalls - this.calls)
    }
  }
}

/** Kill switch: any run marked running for longer than `minutes` is aborted. */
export function staleRuns(minutes = 60) {
  return all(
    `SELECT id, user_id, started_at FROM runs
     WHERE status = 'running' AND started_at < datetime('now', ?)`,
    `-${Number(minutes)} minutes`
  )
}
