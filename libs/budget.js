/**
 * Budget guard for a traffic run.
 *
 * A run can never exceed: max sessions, max wall-clock time, or an optional
 * max number of failed sessions (circuit breaker). The runner calls
 * `guard.before()` before each session and `guard.onResult(ok)` after it.
 *
 * The guard also exposes an abort signal so the UI "Stop" button and the
 * Telegram /stop command both work through the same path.
 */

class BudgetExceeded extends Error {
    constructor(reason, message) {
        super(message || `budget exceeded: ${reason}`)
        this.name = 'BudgetExceeded'
        this.reason = reason
    }
}

class BudgetGuard {
    /**
     * @param {object} options
     * @param {number} [options.maxSessions]      total sessions allowed
     * @param {number} [options.maxRuntimeMs]     wall-clock limit
     * @param {number} [options.maxFailures]      circuit breaker (0 = disabled)
     * @param {number} [options.maxFailRate]      0–1, requires minSample
     * @param {number} [options.minSample]        sessions before maxFailRate applies
     * @param {() => number} [options.now]
     */
    constructor(options = {}) {
        this.maxSessions = numberOr(options.maxSessions, Infinity)
        this.maxRuntimeMs = numberOr(options.maxRuntimeMs, Infinity)
        this.maxFailures = numberOr(options.maxFailures, 0)
        this.maxFailRate = numberOr(options.maxFailRate, 0)
        this.minSample = numberOr(options.minSample, 10)
        this.now = typeof options.now === 'function' ? options.now : () => Date.now()

        this.startedAt = this.now()
        this.sessions = 0
        this.ok = 0
        this.failed = 0
        this.aborted = false
        this.abortReason = ''
        this.listeners = new Set()
    }

    /** Abort the run (UI stop button, Telegram /stop, watchdog). */
    abort(reason = 'aborted') {
        if (this.aborted) return
        this.aborted = true
        this.abortReason = reason
        for (const listener of this.listeners) {
            try {
                listener(reason)
            } catch (e) {}
        }
    }

    onAbort(listener) {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
    }

    get elapsedMs() {
        return this.now() - this.startedAt
    }

    get remaining() {
        return this.maxSessions === Infinity ? Infinity : Math.max(0, this.maxSessions - this.sessions)
    }

    /**
     * Call before a session starts. Throws BudgetExceeded when the run must stop.
     */
    before() {
        if (this.aborted) throw new BudgetExceeded('aborted', `run aborted: ${this.abortReason}`)
        if (this.sessions >= this.maxSessions) {
            this.abort('max sessions reached')
            throw new BudgetExceeded('sessions', `session limit reached (${this.maxSessions})`)
        }
        if (this.elapsedMs >= this.maxRuntimeMs) {
            this.abort('runtime limit reached')
            throw new BudgetExceeded('runtime', `runtime limit reached (${Math.round(this.maxRuntimeMs / 1000)}s)`)
        }
        if (this.shouldTripBreaker()) {
            this.abort('failure circuit breaker')
            throw new BudgetExceeded('failures', `too many failures (${this.failed}/${this.sessions})`)
        }
        return true
    }

    /** Record the outcome of a session. */
    onResult(ok) {
        this.sessions += 1
        if (ok) this.ok += 1
        else this.failed += 1
        return this.state
    }

    shouldTripBreaker() {
        if (this.maxFailures > 0 && this.failed >= this.maxFailures) return true
        if (this.maxFailRate > 0 && this.sessions >= this.minSample) {
            return this.failed / this.sessions >= this.maxFailRate
        }
        return false
    }

    get state() {
        return {
            sessions: this.sessions,
            ok: this.ok,
            failed: this.failed,
            maxSessions: this.maxSessions === Infinity ? null : this.maxSessions,
            remaining: this.remaining === Infinity ? null : this.remaining,
            elapsedMs: this.elapsedMs,
            maxRuntimeMs: this.maxRuntimeMs === Infinity ? null : this.maxRuntimeMs,
            aborted: this.aborted,
            abortReason: this.abortReason
        }
    }

    summary() {
        const seconds = Math.round(this.elapsedMs / 1000)
        const rate = this.sessions ? Math.round((this.ok / this.sessions) * 100) : 0
        return (
            `sessions ${this.sessions}` +
            (this.maxSessions === Infinity ? '' : `/${this.maxSessions}`) +
            ` · ok ${this.ok} · failed ${this.failed} · ${rate}% · ${seconds}s` +
            (this.aborted ? ` · ${this.abortReason}` : '')
        )
    }
}

function numberOr(value, fallback) {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? n : fallback
}

/** Build a guard from the session config coming from the UI / Telegram. */
function fromSession(session, totalSessions) {
    const s = session && typeof session === 'object' ? session : {}
    return new BudgetGuard({
        maxSessions: Number.isFinite(Number(s.maxSessions)) ? Number(s.maxSessions) : totalSessions,
        maxRuntimeMs: Math.max(0, Number(s.maxRuntimeMin) || 120) * 60_000,
        maxFailures: Math.max(0, Number(s.maxFailures) || 0),
        maxFailRate: Math.max(0, Math.min(1, Number(s.maxFailRate) || 0)),
        minSample: Math.max(1, Number(s.minSample) || 10)
    })
}

module.exports = { BudgetGuard, BudgetExceeded, fromSession }
