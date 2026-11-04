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
