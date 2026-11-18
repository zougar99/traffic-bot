#!/usr/bin/env node
/**
 * Lightweight smoke test — no browser, no Electron, no network.
 * Run with: npm test
 *
 * 1. every JavaScript file in the project must parse
 * 2. the data loaders must return arrays
 * 3. the Telegram config diagnostics must fail gracefully when no config exists
 */
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const SKIP_DIRS = new Set(['node_modules', '.git', 'site', 'sessions'])
let failures = 0

function ok(label) {
    console.log('  ✓ ' + label)
}

function fail(label, detail) {
    failures += 1
    console.error('  ✗ ' + label + (detail ? '\n      ' + detail : ''))
}

let checked = 0
function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.') && entry.isDirectory()) continue
        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue
            walk(path.join(dir, entry.name))
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            const file = path.join(dir, entry.name)
            checked += 1
            try {
                execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
            } catch (err) {
                fail('syntax: ' + path.relative(root, file), String(err.stderr || err.message).trim())
            }
        }
    }
}

console.log('\n› syntax check')
walk(root)
ok(checked + ' JavaScript file(s) parsed')

console.log('\n› loaders')
async function loaders() {
    const proxy = require('../libs/proxy')
    const emails = require('../libs/email')
    const comments = require('../libs/comments')

    for (const [name, fn] of [
        ['proxy', proxy],
        ['email', emails],
        ['comments', comments]
    ]) {
        try {
            const list = await fn()
            if (Array.isArray(list)) ok(name + ' loader → ' + list.length + ' entries')
            else fail(name + ' loader did not return an array')
        } catch (err) {
            fail(name + ' loader threw', err.message)
        }
    }
}

console.log('\n› new modules')
function modules() {
    let health, budget, recorder
    try {
        health = require('../libs/proxyHealth')
        budget = require('../libs/budget')
        recorder = require('../libs/recorder')
    } catch (err) {
        return fail('module require', err.message)
    }

    const parsed = health.parseProxy('socks5://u:p@127.0.0.1:1080')
    if (parsed && parsed.protocol === 'socks5' && parsed.port === 1080) ok('proxyHealth parses socks5 + auth')
    else fail('proxyHealth could not parse socks5://u:p@host:1080')

    if (health.parseProxy('not a proxy') === null) ok('proxyHealth rejects garbage entries')
    else fail('proxyHealth accepted an invalid entry')

    if (health.scoreFor(120) === 100 && health.scoreFor(10_000) === 1) ok('proxyHealth score curve is sane')
    else fail('proxyHealth score curve out of range')

    const guard = new budget.BudgetGuard({ maxSessions: 2, maxRuntimeMs: 60_000 })
    guard.before()
    guard.onResult(true)
    guard.before()
    guard.onResult(false)
    let tripped = false
    try {
        guard.before()
    } catch (err) {
        tripped = err instanceof budget.BudgetExceeded && err.reason === 'sessions'
    }
    if (tripped) ok('BudgetGuard stops at the session limit')
    else fail('BudgetGuard let a run exceed maxSessions')

    const breaker = new budget.BudgetGuard({ maxSessions: 10, maxFailures: 2 })
    breaker.onResult(false)
    breaker.onResult(false)
    let broke = false
    try {
        breaker.before()
    } catch (err) {
        broke = err.reason === 'failures'
    }
    if (broke) ok('BudgetGuard circuit breaker trips on failures')
    else fail('BudgetGuard circuit breaker did not trip')

    const stopped = new budget.BudgetGuard({})
    stopped.abort('telegram /stop')
    let aborted = false
    try {
        stopped.before()
    } catch (err) {
        aborted = err.reason === 'aborted'
    }
    if (aborted) ok('BudgetGuard.abort() stops the next session')
    else fail('BudgetGuard.abort() did not stop the run')

    const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'tb-rec-'))
    const rec = new recorder.SessionRecorder({ root: dir, runId: 'smoke', index: 0 })
    rec.set({ url: 'https://example.com', mode: 'Direct' })
    rec.step('landed')
    const out = rec.finish(true)
    const files = require('fs').readdirSync(out)
    if (files.includes('meta.json') && files.includes('events.ndjson')) ok('SessionRecorder writes meta + events')
    else fail('SessionRecorder did not write its files', files.join(', '))
    require('fs').rmSync(dir, { recursive: true, force: true })
}

console.log('\n› telegram config')
function telegram() {
    try {
        const diag = require('../libs/telegramConfig').diagnoseTelegramConfig()
        if (diag && diag.ok) ok('telegram.config.json is valid')
        else if (diag && diag.code) ok('no config → graceful code "' + diag.code + '"')
        else fail('unexpected diagnostics shape')
    } catch (err) {
        fail('telegramConfig threw', err.message)
    }
}

loaders()
    .then(() => {
        modules()
        telegram()
        console.log('')
        if (failures) {
            console.error(failures + ' check(s) failed\n')
            process.exit(1)
        }
        console.log('All checks passed\n')
    })
    .catch((err) => {
        console.error(err)
        process.exit(1)
    })
