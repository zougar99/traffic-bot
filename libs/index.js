const webDriver = require('selenium-webdriver')
const chrome = require('selenium-webdriver/chrome')
const chromedriver = new chrome.ServiceBuilder(require('chromedriver').path)

const auto = require('./autobot')
const loadproxy = require('./proxy')
const loadEmails = require('./email')
const loadComments = require('./comments')
const spoofing = require('./spoofing')
const tg = require('./telegramNotify')
const { BudgetGuard, BudgetExceeded, fromSession } = require('./budget')
const { SessionRecorder, describeDriver, performanceLoggingOptions } = require('./recorder')

function normalizeEngage(e) {
    if (!e || typeof e !== 'object') return { like: false, comment: false, commentText: '' }
    return {
        like: !!e.like,
        comment: !!e.comment,
        commentText: String(e.commentText || '').trim()
    }
}

function pickRoundRobin(list, idx) {
    if (!list || !list.length) return ''
    return list[idx % list.length]
}

/**
 * Proxy entries may be written as "host:port", "user:pass@host:port",
 * "http://host:port" or "socks5://host:port". Normalise to a URL Chrome accepts.
 */
function normalizeProxy(entry) {
    var raw = String(entry || '').trim()
    if (!raw || raw.charAt(0) === '#') return ''
    if (!/^[a-z0-9]+:\/\//i.test(raw)) raw = 'http://' + raw
    try {
        var u = new URL(raw)
        if (!u.hostname || !u.port) return ''
        return (
            u.protocol +
            '//' +
            (u.username ? u.username + (u.password ? ':' + u.password : '') + '@' : '') +
            u.hostname +
            ':' +
            u.port
        )
    } catch (e) {
        return ''
    }
}

function makeEngage(base, comments, sessionOpts, sessionIndex) {
    var text = String(base.commentText || '').trim()
    if (base.comment && sessionOpts.useCommentFile && comments.length) {
        text = comments[Math.floor(Math.random() * comments.length)]
    }
    return {
        like: base.like,
        comment: base.comment,
        commentText: text
    }
}

function applyChromeLaunchArgs(options, headless) {
    var base = [
        '--mute-audio',
        '--disable-logging',
        '--disable-infobars',
        '--disable-dev-shm-usage',
        '--window-size=1366,768'
    ]
    for (var i = 0; i < base.length; i++) options.addArguments(base[i])
    if (headless) options.addArguments('--headless=new')
}

function delay(time) {
    return new Promise(function (resolve) {
        setTimeout(resolve, time)
    })
}

function normalizeUrlList(urlInput) {
    if (urlInput == null) return []
    if (Array.isArray(urlInput)) {
        return urlInput
            .map(function (u) {
                return String(u || '').trim()
            })
            .filter(Boolean)
    }
    if (typeof urlInput === 'object') {
        var keys = Object.keys(urlInput).filter(function (k) {
            return /^\d+$/.test(k)
        })
        keys.sort(function (a, b) {
            return Number(a) - Number(b)
        })
        if (keys.length) {
            return keys
                .map(function (k) {
                    return String(urlInput[k] || '').trim()
                })
                .filter(Boolean)
        }
    }
    var s = String(urlInput || '').trim()
    return s ? [s] : []
}

function safeRunCount(count) {
    var n = parseInt(String(count == null ? '' : count).trim(), 10)
    if (!Number.isFinite(n) || n < 1) n = 1
    return n
}

function Stealth(driver) {
    return new Promise(async function (resolve) {
        try {
            var connection = await driver.createCDPConnection('page')
            await connection.execute('Runtime.enable', {}, null)
            await connection.execute('Page.enable', {}, null)
            await connection.execute(
                'Page.addScriptToEvaluateOnNewDocument',
                { source: spoofing() },
                null
            )
        } catch (e) {}
        resolve(true)
    })
}

function googleSearchResultsUrl(keyword) {
    var q = String(keyword || '').trim()
    return 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&hl=en&gl=us&num=100&pws=0'
}

function unwrapGoogleSearchHref(href) {
    if (!href) return ''
    var h = String(href).trim()
    try {
        if (!/google\.com\/url\?/i.test(h)) return h
        var u = new URL(h)
        var q = u.searchParams.get('q') || u.searchParams.get('url')
        if (q) {
            var dec = decodeURIComponent(q.replace(/\+/g, ' '))
            if (/^https?:\/\//i.test(dec)) return dec
        }
    } catch (e) {}
    return h
}

function hrefLooksLikeTarget(href, targetUrl) {
    if (!href || !targetUrl) return false
    var t = String(targetUrl).trim()
    var h = String(href)
    if (h.indexOf(t) !== -1) return true
    try {
        var want = new URL(t)
        var got = new URL(h)
        var wh = want.hostname.replace(/^www\./, '')
        var gh = got.hostname.replace(/^www\./, '')
        if (gh !== wh) return false
        if (!want.pathname || want.pathname === '/') return true
        var wp = want.pathname.replace(/\/$/, '')
        return got.pathname.indexOf(wp) === 0
    } catch (e) {
        return h.indexOf(t) !== -1
    }
}

async function getSerpAnchors(Driver) {
    var selectors = [
        '#search .yuRUbf > a',
        '#rso .yuRUbf > a',
        '#rso h3 a[href]',
        '#rso div.g a[href^="http"]',
        '#search a[data-ved][href^="http"]'
    ]
    var s
    for (s = 0; s < selectors.length; s++) {
        var els = await Driver.findElements(webDriver.By.css(selectors[s]))
        if (!els.length) continue
        var out = []
        var i
        for (i = 0; i < els.length; i++) {
            try {
                var u = await els[i].getAttribute('href')
                if (!u || !/^https?:\/\//i.test(u)) continue
                if (/google\.com\/search\?/i.test(u)) continue
                if (/google\.com\/maps/i.test(u)) continue
                out.push(els[i])
            } catch (e) {}
        }
        if (out.length) return out
    }
    return []
}

function findSiteUrl(Driver, url) {
    return new Promise(async function (r) {
        var anchors = await getSerpAnchors(Driver)
        var i
        for (i = 0; i < anchors.length; i++) {
            try {
                var href = await anchors[i].getAttribute('href')
                var real = unwrapGoogleSearchHref(href) || href
                if (hrefLooksLikeTarget(real, url)) return r(i)
            } catch (e) {}
        }
        r(-1)
    })
}

function nextPage(Driver, url) {
    return new Promise(async function (r) {
        var pages = await Driver.findElements(
            webDriver.By.css('a#pnnext, td.d6cvqb a#pnnext, a[aria-label="Next Page"], a[aria-label="Page suivante"]')
        )
        if (pages[0]) await pages[0].click()
        else await Driver.executeScript('window.scrollBy(0, 800)')
        await delay(1500)
        var findURL = await findSiteUrl(Driver, url)
        await delay(2000)
        if (findURL == -1) await nextPage(Driver, url)
        else r(findURL)
    })
}

function clickPage(Driver, targetSiteUrl, pageId) {
    return new Promise(async function (r) {
        try {
            var anchors = await getSerpAnchors(Driver)
            var el = null
            var j
            for (j = 0; j < anchors.length; j++) {
                try {
                    var h = await anchors[j].getAttribute('href')
                    var real = unwrapGoogleSearchHref(h) || h
                    if (hrefLooksLikeTarget(real, targetSiteUrl)) {
                        el = anchors[j]
                        break
                    }
                } catch (e) {}
            }
            if (!el && pageId >= 0 && pageId < anchors.length) el = anchors[pageId]
            if (!el) return r(false)
            await Driver.executeScript('arguments[0].scrollIntoView({block:"center"})', el)
            await delay(400)
            try {
                await el.click()
            } catch (e1) {
                var fb = unwrapGoogleSearchHref(await el.getAttribute('href')) || ''
                if (fb && /^https?:\/\//i.test(fb) && !/google\.com\/search/i.test(fb)) await Driver.get(fb)
                else throw e1
            }
            await delay(1000)
            await Driver.executeScript(auto.scroll())
            r(true)
        } catch (e) {
            r(false)
        }
    })
}

/**
 * Wrap a session function so it can be recorded and budgeted.
 * Returns { recorderDir } for logging.
 */
function makeRecorder(sessionOpts, runId, index, url, mode, proxy) {
    if (!sessionOpts.record) return null
    var rec = new SessionRecorder({
        root: sessionOpts.recordDir || undefined,
        runId: runId,
        index: index,
        screenshots: sessionOpts.screenshots !== false,
        events: true
    })
    rec.set({ url: url || '', mode: mode || '', proxy: String(proxy || ''), headless: !!sessionOpts.headless })
    return rec
}

async function finishRecording(rec, driver, ok, error) {
    if (!rec) return
    try {
        if (driver) {
            var info = await describeDriver(driver)
            rec.set(info)
            try {
                var log = await driver.manage().logs().get('performance')
                await rec.writeHar(log)
            } catch (e) {}
        }
    } catch (e) {}
    rec.finish(ok, error)
}

async function safeQuitDriver(driver) {
    if (!driver) return
    try {
        await driver.quit()
    } catch (e) {
        try {
            await driver.close()
        } catch (e2) {}
    }
    await delay(500)
}

async function Direct(url, proxy, headless, engage, timing, sessionEmail, recorder) {
    var driver
    var error = null
    try {
        var options = new chrome.Options()
        var px = normalizeProxy(proxy)
        if (px) options.addArguments('--proxy-server=' + px)
        applyChromeLaunchArgs(options, !!headless)
        options.excludeSwitches('enable-logging')
        if (recorder) options.setChromeLoggingPrefs(performanceLoggingOptions({}))
        driver = await new webDriver.Builder()
            .forBrowser('chrome')
            .setChromeService(chromedriver)
            .setChromeOptions(options)
            .build()
        await Stealth(driver)
        await driver.get(url).then(async function () {
            if (recorder) {
                recorder.step('landed', url)
                await recorder.screenshot(driver, 'landing')
            }
            await delay(timing.afterLoadMs)
            await driver.executeScript(auto.scroll())
            if (recorder) recorder.step('scroll')
            await delay(timing.dwellEngageMs)
            await auto.runEngagement(driver, engage, sessionEmail)
            if (recorder) {
                recorder.step('engaged', JSON.stringify(engage))
                await recorder.screenshot(driver, 'final')
            }
        })
    } catch (e) {
        error = e
        throw e
    } finally {
        await finishRecording(recorder, driver, !error, error)
        await safeQuitDriver(driver)
    }
}

async function googleSearch(url, keyboard, proxy, headless, engage, timing, sessionEmail, recorder) {
    var driver
    var error = null
    try {
        var options = new chrome.Options()
        var px = normalizeProxy(proxy)
        if (px) options.addArguments('--proxy-server=' + px)
        applyChromeLaunchArgs(options, !!headless)
        options.excludeSwitches('enable-logging')
        if (recorder) options.setChromeLoggingPrefs(performanceLoggingOptions({}))
        driver = await new webDriver.Builder()
            .forBrowser('chrome')
            .setChromeService(chromedriver)
            .setChromeOptions(options)
            .build()
        await Stealth(driver)
        await driver.get(googleSearchResultsUrl(keyboard)).then(async function () {
            if (recorder) {
                recorder.step('serp', googleSearchResultsUrl(keyboard))
                await recorder.screenshot(driver, 'serp')
            }
            await delay(2000)
            var pageId = await findSiteUrl(driver, url)
            if (recorder) recorder.step('found', 'position ' + pageId)
            await delay(2000)
            if (pageId == -1) pageId = await nextPage(driver, url)
            await delay(1000)
            if (pageId < 0) {
                if (recorder) recorder.step('not-found')
                return
            }
            var ok = await clickPage(driver, url, pageId)
            if (ok) {
                if (recorder) {
                    recorder.step('clicked', 'result #' + (pageId + 1))
                    await recorder.screenshot(driver, 'landing')
                }
                await delay(timing.dwellEngageMs)
                await auto.runEngagement(driver, engage, sessionEmail)
                if (recorder) {
                    recorder.step('engaged', JSON.stringify(engage))
                    await recorder.screenshot(driver, 'final')
                }
            }
        })
    } catch (e) {
        error = e
        throw e
    } finally {
        await finishRecording(recorder, driver, !error, error)
        await safeQuitDriver(driver)
    }
}

async function proxyServer(url, proxy, keyboard, headless, engage, timing, sessionEmail, recorder) {
    var driver
    var error = null
    try {
        var options = new chrome.Options()
        var px2 = normalizeProxy(proxy)
        if (px2) options.addArguments('--proxy-server=' + px2)
        applyChromeLaunchArgs(options, !!headless)
        options.excludeSwitches('enable-logging')
        if (recorder) options.setChromeLoggingPrefs(performanceLoggingOptions({}))
        driver = await new webDriver.Builder()
            .forBrowser('chrome')
            .setChromeService(chromedriver)
            .setChromeOptions(options)
            .build()
        await Stealth(driver)
        await driver.get('https://www.blockaway.net').then(async function () {
            await driver.findElement(webDriver.By.id('url')).sendKeys(googleSearchResultsUrl(keyboard))
            await driver.findElement(webDriver.By.id('requestSubmit')).click()
            await delay(12000)
            var pageId = await findSiteUrl(driver, url)
            await delay(2000)
            if (pageId == -1) pageId = await nextPage(driver, url)
            await delay(1000)
            if (pageId < 0) return
            var ok2 = await clickPage(driver, url, pageId)
            if (ok2) {
                if (recorder) {
                    recorder.step('clicked', url)
                    await recorder.screenshot(driver, 'landing')
                }
                await delay(timing.dwellEngageMs)
                await auto.runEngagement(driver, engage, sessionEmail)
                if (recorder) await recorder.screenshot(driver, 'final')
            }
        })
    } catch (e) {
        error = e
        throw e
    } finally {
        await finishRecording(recorder, driver, !error, error)
        await safeQuitDriver(driver)
    }
}

var usedDriver = 0
var mainRunBusy = false
var activeGuard = null

async function main(urlInput, keyboard, count, option, engage, session, extras) {
    if (mainRunBusy) {
        console.warn('[RUN] ignored — already running')
        return
    }
    mainRunBusy = true
    var notifyDesktop = !!(extras && extras.notifyDesktop)
    var sess = session && typeof session === 'object' ? session : {}
    var headless = sess.headless === true
    var pauseMs = Math.round(Math.max(0, parseFloat(sess.pauseBetweenSec) || 0) * 1000)
    var timing = {
        afterLoadMs: Math.max(500, Math.round((parseFloat(sess.afterLoadSec) || 1) * 1000)),
        dwellEngageMs: Math.round((parseFloat(sess.dwellBeforeEngageSec) || 2.5) * 1000)
    }
    var sessionOpts = {
        useCommentFile: !!sess.useCommentFile,
        useEmailRotate: sess.useEmailRotate !== false,
        record: sess.record === true,
        screenshots: sess.screenshots !== false,
        recordDir: sess.recordDir || undefined,
        headless: headless
    }
    var engageBase = normalizeEngage(engage)
    var urls = normalizeUrlList(urlInput)
    if (!urls.length) {
        mainRunBusy = false
        return
    }

    var runCount = safeRunCount(count)
    var proxy = await loadproxy()
    var emails = await loadEmails()
    var comments = await loadComments()
    usedDriver = 0

    var totalSessions = urls.length * runCount
    var guard = fromSession(
        {
            maxSessions: totalSessions,
            maxRuntimeMin: sess.maxRuntimeMin,
            maxFailures: sess.maxFailures,
            maxFailRate: sess.maxFailRate
        },
        totalSessions
    )
    activeGuard = guard
    var runId = sessionOpts.record ? String(sess.runId || totalSessions + '-' + Date.now()) : ''
    if (sessionOpts.record) console.log('[REC] writing sessions to', sessionOpts.recordDir || './sessions', 'run', runId)
    if (notifyDesktop) {
        try {
            await tg.notifyDesktopRunStart({
                option: option,
                urls: urls,
                keyboard: keyboard,
                countPerUrl: runCount,
                totalSessions: totalSessions,
                engage: engage || {}
            })
        } catch (e) {}
    }

    console.log(
        '[RUN] mode=' + option + ' COUNT per URL=' + runCount + ' urls=' + urls.length + ' headless=' + headless
    )

    try {
        if (urls.length <= 1) {
            await runOneUrlBatch(
                urls[0],
                keyboard,
                runCount,
                option,
                proxy,
                headless,
                engageBase,
                timing,
                sessionOpts,
                emails,
                comments,
                pauseMs,
                guard,
                runId
            )
        } else {
            var round
            var ui
            for (round = 0; round < runCount; round++) {
                for (ui = 0; ui < urls.length; ui++) {
                    await runOneUrlBatch(
                        urls[ui],
                        keyboard,
                        1,
                        option,
                        proxy,
                        headless,
                        engageBase,
                        timing,
                        sessionOpts,
                        emails,
                        comments,
                        pauseMs,
                        guard,
                        runId
                    )
                }
            }
        }
        if (notifyDesktop) {
            await tg.notifyDesktopRunDone({
                completed: usedDriver,
                totalSessions: totalSessions,
                aborted: false
            })
        }
        console.log('[RUN] done ·', guard.summary())
    } catch (err) {
        if (err instanceof BudgetExceeded) {
            console.warn('[RUN] stopped early ·', guard.summary())
        } else {
            if (notifyDesktop) await tg.notifyDesktopRunError(err)
            throw err
        }
    } finally {
        if (activeGuard === guard) activeGuard = null
        mainRunBusy = false
    }
}

async function runOneUrlBatch(
    url,
    keyboard,
    sessions,
    option,
    proxy,
    headless,
    engageBase,
    timing,
    sessionOpts,
    emails,
    comments,
    pauseMs,
    guard,
    runId
) {
    var end = usedDriver + sessions
    var pList = proxy && proxy.length ? proxy : []
    while (usedDriver < end) {
        if (guard) {
            try {
                guard.before()
            } catch (e) {
                if (e instanceof BudgetExceeded) {
                    console.warn('[RUN]', e.message)
                    break
                }
                throw e
            }
        }
        var p = pList.length ? pList[usedDriver % pList.length] : null
        var em = sessionOpts.useEmailRotate !== false && emails.length ? pickRoundRobin(emails, usedDriver) : ''
        var engage = makeEngage(engageBase, comments, sessionOpts, usedDriver)
        var recorder = makeRecorder(sessionOpts, runId, usedDriver, url, option, p)
        console.log(
            option === 'Direct' ? '[DIRECT]: ' + url : option === 'Google' ? '[SEARCH]: ' + url : '[PROXY]: ' + url
        )
        console.log(
            '[session]',
            usedDriver,
            'proxy=',
            p || '(none)',
            'visible=' + (!headless ? 'yes' : 'no'),
            'email=',
            em || '(none)',
            recorder ? 'rec=' + recorder.dir : ''
        )
        var sessionOk = true
        try {
            if (option === 'Direct') await Direct(url, p, headless, engage, timing, em, recorder)
            else if (option === 'Google') await googleSearch(url, keyboard, p, headless, engage, timing, em, recorder)
            else if (option === 'Proxy') await proxyServer(url, p, keyboard, headless, engage, timing, em, recorder)
        } catch (e) {
            sessionOk = false
            console.error('[session]', usedDriver, 'failed:', e && e.message ? e.message : e)
        }
        if (guard) guard.onResult(sessionOk)
        usedDriver += 1
        if (usedDriver < end && pauseMs > 0) await delay(pauseMs)
    }
}

async function stop() {
    if (activeGuard) activeGuard.abort('stopped by user')
}

module.exports = {
    main: main,
    stop: stop,
    isRunning: function () {
        return mainRunBusy
    }
}
