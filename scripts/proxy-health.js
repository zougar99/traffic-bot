#!/usr/bin/env node
/**
 * Test the proxy pool without launching a browser.
 *
 *   npm run proxies:health
 *   npm run proxies:health -- --file proxy/pool.txt --concurrency 20
 *   npm run proxies:health -- --json > report.json
 */
const fs = require('fs')
const path = require('path')
const loadProxy = require('../libs/proxy')
const { testPool, formatReport } = require('../libs/proxyHealth')

function arg(name, fallback) {
    const i = process.argv.indexOf('--' + name)
    if (i === -1) return fallback
    const next = process.argv[i + 1]
    return next && !next.startsWith('--') ? next : true
}

;(async () => {
    const file = arg('file', null)
    let entries
    if (file) {
        const full = path.resolve(process.cwd(), String(file))
        if (!fs.existsSync(full)) {
            console.error(`file not found: ${full}`)
            process.exit(1)
        }
        entries = fs.readFileSync(full, 'utf8').split(/\r?\n/)
    } else {
        entries = await loadProxy()
    }

    if (!entries.length) {
        console.error('no proxies found — add files under proxy/ or pass --file')
        process.exit(1)
    }

    const concurrency = Number(arg('concurrency', 10)) || 10
    const timeoutMs = Number(arg('timeout', 5000)) || 5000

    const started = Date.now()
    const report = await testPool(entries, { concurrency, timeoutMs })
    report.durationMs = Date.now() - started

    if (arg('json', false)) {
        console.log(JSON.stringify(report, null, 2))
    } else {
        console.log('')
        console.log(formatReport(report, { limit: Number(arg('limit', 40)) || 40 }))
        console.log('')
        console.log(`done in ${(report.durationMs / 1000).toFixed(1)}s (concurrency ${concurrency})`)
        const good = report.results.filter((r) => r.ok).map((r) => r.raw)
        if (arg('write-good', false)) {
            const out = path.resolve(process.cwd(), 'proxy/alive.txt')
            fs.mkdirSync(path.dirname(out), { recursive: true })
            fs.writeFileSync(out, good.join('\n') + '\n')
            console.log(`wrote ${good.length} alive proxies to proxy/alive.txt`)
        }
    }

    process.exit(report.alive ? 0 : 2)
})()
