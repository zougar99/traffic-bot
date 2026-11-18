/**
 * Session recorder.
 *
 * Writes one folder per session under `sessions/<runId>/<n>/` with:
 *   · meta.json      — url, mode, proxy, timing, user agent, outcome
 *   · 01-landing.png — screenshot right after navigation (if enabled)
 *   · 02-final.png   — screenshot after dwell / engagement
 *   · events.ndjson  — append-only timeline (nav, scroll, click, engage, error)
 *   · har.json       — HTTP archive built from the Chrome performance log
 *
 * Nothing is uploaded anywhere: the folder is yours.
 */
const fs = require('fs')
const path = require('path')

function stamp(date = new Date()) {
    const pad = (n) => String(n).padStart(2, '0')
    return (
        `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    )
}

class SessionRecorder {
    /**
     * @param {object} options
     * @param {string} options.root        base folder (usually ./sessions)
     * @param {string} options.runId       run identifier
     * @param {number} options.index       session index
     * @param {boolean} [options.screenshots]
     * @param {boolean} [options.events]
     */
    constructor(options = {}) {
        this.root = options.root || path.join(process.cwd(), 'sessions')
        this.runId = options.runId || stamp()
        this.index = options.index ?? 0
        this.screenshots = options.screenshots !== false
        this.recordEvents = options.events !== false

        this.dir = path.join(this.root, this.runId, String(this.index).padStart(3, '0'))
        this.meta = {
            runId: this.runId,
            index: this.index,
            startedAt: new Date().toISOString(),
            url: '',
            mode: '',
            proxy: '',
            email: '',
            userAgent: '',
            viewport: '',
            headless: false,
            screenshots: 0,
            steps: [],
            ok: null,
            error: ''
        }
        this.finished = false
    }

    ensureDir() {
        fs.mkdirSync(this.dir, { recursive: true })
        return this.dir
    }

    set(fields) {
        Object.assign(this.meta, fields)
        return this
    }

    step(name, detail) {
        const entry = { t: new Date().toISOString(), name, detail: detail || '' }
        this.meta.steps.push(entry)
        if (this.recordEvents) {
            try {
                this.ensureDir()
                fs.appendFileSync(path.join(this.dir, 'events.ndjson'), JSON.stringify(entry) + '\n')
            } catch (e) {}
        }
        return entry
    }

    /**
     * @param {import('selenium-webdriver').WebDriver} driver
     * @param {string} label
     */
    async screenshot(driver, label) {
        if (!this.screenshots || !driver) return null
        try {
            const png = await driver.takeScreenshot()
            this.ensureDir()
            const name = `${String(this.meta.screenshots + 1).padStart(2, '0')}-${label || 'shot'}.png`
            const file = path.join(this.dir, name)
            fs.writeFileSync(file, Buffer.from(png, 'base64'))
            this.meta.screenshots += 1
            this.step('screenshot', name)
            return file
        } catch (err) {
            this.step('screenshot-failed', String(err && err.message ? err.message : err))
            return null
        }
    }

    /**
     * Turn the Chrome performance log into a minimal HAR 1.2 file.
     * @param {Array<{message:string}>} entries
     */
    async writeHar(entries) {
        if (!Array.isArray(entries) || !entries.length) return null
        const harEntries = []
        for (const entry of entries) {
            let evt
            try {
                evt = JSON.parse(entry.message)
            } catch (e) {
                continue
            }
            const message = evt.message || {}
            if (evt.message && evt.message.method === 'Network.responseReceived') {
                const response = message.params && message.params.response
                if (!response) continue
                harEntries.push({
                    startedDateTime: new Date().toISOString(),
                    time: 0,
                    request: {
                        method: 'GET',
                        url: response.url,
                        httpVersion: 'HTTP/1.1',
                        headers: [],
                        queryString: [],
                        cookies: [],
                        headersSize: -1,
                        bodySize: -1
                    },
                    response: {
                        status: response.status,
                        statusText: response.statusText || '',
                        httpVersion: 'HTTP/1.1',
                        headers: Object.entries(response.headers || {}).map(([name, value]) => ({ name, value: String(value) })),
                        cookies: [],
                        content: { size: 0, mimeType: response.mimeType || '', text: '' },
                        redirectURL: '',
                        headersSize: -1,
                        bodySize: -1
                    },
                    cache: {},
                    timings: { send: 0, wait: 0, receive: 0 }
                })
            }
        }
        const har = {
            log: {
                version: '1.2',
                creator: { name: 'traffic-bot', version: '1.0.0' },
                pages: [{ startedDateTime: this.meta.startedAt, id: 'page_1', title: this.meta.url, pageTimings: {} }],
                entries: harEntries
            }
        }
        try {
            this.ensureDir()
            fs.writeFileSync(path.join(this.dir, 'har.json'), JSON.stringify(har, null, 2))
            this.step('har', `${harEntries.length} responses`)
            return harEntries.length
        } catch (err) {
            this.step('har-failed', String(err && err.message ? err.message : err))
            return null
        }
    }

    finish(ok, error) {
        this.meta.ok = Boolean(ok)
        if (error) this.meta.error = String(error && error.message ? error.message : error)
        this.meta.finishedAt = new Date().toISOString()
        this.meta.durationMs = new Date(this.meta.finishedAt) - new Date(this.meta.startedAt)
        this.finished = true
        try {
            this.ensureDir()
            fs.writeFileSync(path.join(this.dir, 'meta.json'), JSON.stringify(this.meta, null, 2))
        } catch (e) {}
        return this.dir
    }
}

/** Best-effort user agent for the meta block. */
async function describeDriver(driver) {
    try {
        const ua = await driver.executeScript('return navigator.userAgent')
        const viewport = await driver.executeScript('return `${window.innerWidth}x${window.innerHeight}`')
        return { userAgent: ua, viewport }
    } catch (e) {
        return { userAgent: '', viewport: '' }
    }
}

/** Enable the Chrome performance log so HAR capture has data. */
function performanceLoggingOptions(prefs) {
    return {
        ...prefs,
        'goog:loggingPrefs': { performance: 'ALL', browser: 'ALL' }
    }
}

module.exports = { SessionRecorder, describeDriver, performanceLoggingOptions, stamp }
