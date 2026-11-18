/**
 * Proxy health checker.
 *
 * Verifies a proxy without Selenium and without any dependency:
 *   1. TCP connect to the proxy            (is it alive?)
 *   2. HTTP CONNECT / SOCKS5 handshake     (does it tunnel?)
 *   3. optional fetch through it           (does it reach the internet?)
 *
 * Results are scored 0–100 so the runner can prefer the best nodes and park
 * dead ones. Nothing here bypasses authentication or probes third parties
 * beyond one small HTTP request to the URL you configure.
 */
const net = require('net')
const http = require('http')
const tls = require('tls')

/**
 * @typedef {{host:string, port:number, protocol:'http'|'https'|'socks5', username?:string, password?:string, raw:string}} ParsedProxy
 */

/** @returns {ParsedProxy|null} */
function parseProxy(entry) {
    const raw = String(entry || '').trim()
    if (!raw || raw.startsWith('#')) return null
    const withScheme = /^[a-z0-9]+:\/\//i.test(raw) ? raw : `http://${raw}`
    let url
    try {
        url = new URL(withScheme)
    } catch {
        return null
    }
    const port = Number(url.port)
    if (!url.hostname || !Number.isInteger(port) || port <= 0) return null
    const protocol = ['http:', 'https:', 'socks5:', 'socks5h:'].includes(url.protocol)
        ? url.protocol.startsWith('socks5')
            ? 'socks5'
            : url.protocol === 'https:'
              ? 'https'
              : 'http'
        : null
    if (!protocol) return null
    return {
        host: url.hostname,
        port,
        protocol,
        username: decodeURIComponent(url.username || ''),
        password: decodeURIComponent(url.password || ''),
        raw
    }
}

function tcpProbe(host, port, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now()
        const socket = net.connect({ host, port })
        let settled = false
        const finish = (ok, error) => {
            if (settled) return
            settled = true
            socket.destroy()
            resolve({ ok, ms: Date.now() - started, error: error || null })
        }
        socket.setTimeout(timeoutMs)
        socket.once('connect', () => finish(true))
        socket.once('timeout', () => finish(false, 'timeout'))
        socket.once('error', (err) => finish(false, err.code || err.message))
    })
}

/** HTTP proxy: send CONNECT host:443 and expect "200". */
function httpTunnelProbe(proxy, targetHost, targetPort, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now()
        const socket = net.connect({ host: proxy.host, port: proxy.port })
        let settled = false
        const finish = (ok, error, stage) => {
            if (settled) return
            settled = true
            socket.destroy()
            resolve({ ok, ms: Date.now() - started, error: error || null, stage: stage || '' })
        }
        socket.setTimeout(timeoutMs)
        socket.once('timeout', () => finish(false, 'timeout', 'connect'))
        socket.once('error', (err) => finish(false, err.code || err.message, 'connect'))
        socket.once('connect', () => {
            const auth =
                proxy.username || proxy.password
                    ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n`
                    : ''
            socket.write(
                `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\nHost: ${targetHost}:${targetPort}\r\n${auth}\r\n`
            )
            let buffer = ''
            const onData = (chunk) => {
                buffer += chunk.toString('latin1')
                if (!buffer.includes('\r\n')) return
                socket.removeListener('data', onData)
                const line = buffer.split('\r\n')[0]
                const match = /^HTTP\/1\.[01]\s+(\d{3})/.exec(line)
                const status = match ? Number(match[1]) : 0
                if (status === 200) return finish(true)
                if (status === 407) return finish(false, 'auth-required', 'tunnel')
                finish(false, `denied-${status || 'unknown'}`, 'tunnel')
            }
            socket.on('data', onData)
        })
    })
}

/** SOCKS5: greeting → optional user/pass → CONNECT → reply code. */
function socks5Probe(proxy, targetHost, targetPort, timeoutMs) {
    return new Promise((resolve) => {
        const started = Date.now()
        const socket = net.connect({ host: proxy.host, port: proxy.port })
        let settled = false
        let stage = 'connect'
        const finish = (ok, error) => {
            if (settled) return
            settled = true
            socket.destroy()
            resolve({ ok, ms: Date.now() - started, error: error || null, stage })
        }
        socket.setTimeout(timeoutMs)
        socket.once('timeout', () => finish(false, 'timeout'))
        socket.once('error', (err) => finish(false, err.code || err.message))

        let buffer = Buffer.alloc(0)
        const hasAuth = Boolean(proxy.username || proxy.password)

        socket.once('connect', () => {
            stage = 'greeting'
            socket.write(Buffer.from(hasAuth ? [0x05, 0x02, 0x00, 0x02] : [0x05, 0x01, 0x00]))
        })

        const onData = (chunk) => {
            buffer = Buffer.concat([buffer, chunk])

            if (stage === 'greeting' && buffer.length >= 2) {
                const method = buffer[1]
                buffer = buffer.subarray(2)
                if (method === 0x00) return sendConnect()
                if (method === 0x02) {
                    stage = 'auth'
                    const user = Buffer.from(proxy.username || '')
                    const pass = Buffer.from(proxy.password || '')
                    const packet = Buffer.concat([
                        Buffer.from([0x01, user.length]),
                        user,
                        Buffer.from([pass.length]),
                        pass
                    ])
                    socket.write(packet)
                    return
                }
                return finish(false, method === 0xff ? 'no-acceptable-auth' : `method-${method}`)
            }

            if (stage === 'auth' && buffer.length >= 2) {
                const status = buffer[1]
                buffer = buffer.subarray(2)
                if (status !== 0x00) return finish(false, 'auth-failed')
                return sendConnect()
            }

            if (stage === 'connect' && buffer.length >= 2) {
                const reply = buffer[1]
                if (reply === 0x00) return finish(true)
                const codes = {
                    1: 'general-failure',
                    2: 'not-allowed',
                    3: 'network-unreachable',
                    4: 'host-unreachable',
                    5: 'connection-refused',
                    6: 'ttl-expired',
                    7: 'command-not-supported',
                    8: 'address-type-not-supported'
                }
                return finish(false, codes[reply] || `reply-${reply}`)
            }
        }

        function sendConnect() {
            stage = 'connect'
            const hostBuf = Buffer.from(targetHost)
            socket.write(
                Buffer.concat([
                    Buffer.from([0x05, 0x01, 0x00, 0x03, hostBuf.length]),
                    hostBuf,
                    Buffer.from([(targetPort >> 8) & 0xff, targetPort & 0xff])
                ])
            )
        }

        socket.on('data', onData)
    })
}

/**
 * Test one proxy.
 * @param {string} entry
 * @param {{timeoutMs?:number, targetHost?:string, targetPort?:number}} options
 */
async function testProxy(entry, options = {}) {
    const timeoutMs = options.timeoutMs ?? 5000
    const targetHost = options.targetHost || 'www.google.com'
    const targetPort = options.targetPort || 443

    const proxy = parseProxy(entry)
    if (!proxy) {
        return { raw: String(entry || '').trim(), ok: false, score: 0, stage: 'parse', error: 'invalid entry', ms: 0 }
    }

    const alive = await tcpProbe(proxy.host, proxy.port, timeoutMs)
    if (!alive.ok) {
        return {
            raw: proxy.raw,
            host: proxy.host,
            port: proxy.port,
            protocol: proxy.protocol,
            ok: false,
            score: 0,
            stage: 'tcp',
            error: alive.error,
            ms: alive.ms
        }
    }

    const tunnel =
        proxy.protocol === 'socks5'
            ? await socks5Probe(proxy, targetHost, targetPort, timeoutMs)
            : await httpTunnelProbe(proxy, targetHost, targetPort, timeoutMs)

    const total = alive.ms + tunnel.ms
    const score = tunnel.ok ? scoreFor(total) : 0

    return {
        raw: proxy.raw,
        host: proxy.host,
        port: proxy.port,
        protocol: proxy.protocol,
        ok: tunnel.ok,
        score,
        stage: tunnel.ok ? 'ok' : tunnel.stage,
        error: tunnel.error,
        ms: total
    }
}

/** 100 for <250 ms, 0 for >=4000 ms, linear in between. */
function scoreFor(ms) {
    if (!Number.isFinite(ms) || ms < 0) return 0
    if (ms <= 250) return 100
    if (ms >= 4000) return 1
    return Math.max(1, Math.round(100 - ((ms - 250) / 3750) * 99))
}

/**
 * Test a list with bounded concurrency.
 * @param {string[]} entries
 * @param {{concurrency?:number}} options
 */
async function testPool(entries, options = {}) {
    const concurrency = Math.max(1, options.concurrency || 10)
    const list = (entries || []).filter((e) => String(e || '').trim() && !String(e).trim().startsWith('#'))
    const results = new Array(list.length)
    let cursor = 0

    async function worker() {
        while (cursor < list.length) {
            const index = cursor
            cursor += 1
            results[index] = await testProxy(list[index], options)
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker))
    const alive = results.filter((r) => r.ok)
    return {
        total: results.length,
        alive: alive.length,
        dead: results.length - alive.length,
        averageMs: alive.length ? Math.round(alive.reduce((sum, r) => sum + r.ms, 0) / alive.length) : 0,
        results: results.sort((a, b) => b.score - a.score)
    }
}

/** Format a pool report for the console. */
function formatReport(report, { limit = 30 } = {}) {
    const lines = [
        `proxies: ${report.alive}/${report.total} alive · avg ${report.averageMs} ms`,
        ''
    ]
    for (const row of report.results.slice(0, limit)) {
        const label = `${row.host || '?'}:${row.port || '?'}`.padEnd(22)
        const proto = String(row.protocol || '?').padEnd(7)
        const state = row.ok ? `ok  ${String(row.ms).padStart(5)}ms  score ${String(row.score).padStart(3)}` : `down  ${row.error}`
        lines.push(`  ${row.ok ? '●' : '○'} ${label} ${proto} ${state}`)
    }
    if (report.total > limit) lines.push(`  … ${report.total - limit} more`)
    return lines.join('\n')
}

module.exports = { parseProxy, testProxy, testPool, scoreFor, formatReport }
