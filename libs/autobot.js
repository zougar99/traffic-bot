const { By } = require('selenium-webdriver')

function scroll() {
    return `
    var scrollHeight = 0
    var scrollDown = true
    var scrollValue = 200
    function random(min, max){
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1) + min);
    }
    setInterval(() => {
        var scrollLimit = document.body.offsetHeight - window.innerHeight;
        if (scrollDown){
            if (scrollHeight < scrollLimit)
                scrollHeight += random(50, scrollValue);
            else
                scrollDown = false;
        }else{
            if (scrollHeight > 0)
                scrollHeight -= random(50, scrollValue);
            else
                scrollDown = true;
        }
        window.scrollTo(0, (scrollHeight > scrollLimit ? scrollLimit : scrollHeight < 0 ? 0 : scrollHeight))
    }, 1000)
    `
}

/** Runs in page context (main document or iframe). */
function injectCommentOnly(commentStr) {
    if (!commentStr) return false
    function fireTextarea(el, val) {
        el.focus()
        el.value = val
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        try {
            el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: val }))
        } catch (e) {}
    }
    function fireContentEditable(el, val) {
        el.focus()
        el.textContent = val
        el.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }
    function clickSubmitInForm(form) {
        if (!form) return false
        var btns = form.querySelectorAll('button,[type="submit"],input[type="submit"]')
        var k
        for (k = 0; k < btns.length; k++) {
            var b = btns[k]
            var t = (b.textContent || b.getAttribute('aria-label') || b.value || '').toLowerCase()
            if (/post|send|submit|comment|reply|publish|publier|soumettre|publier/.test(t)) {
                b.click()
                return true
            }
        }
        return false
    }
    function scoreTextarea(el) {
        var hint =
            (el.getAttribute('placeholder') || '') +
            ' ' +
            (el.getAttribute('aria-label') || '') +
            ' ' +
            (el.name || '') +
            ' ' +
            (el.id || '') +
            ' ' +
            (el.className || '')
        var s = 0
        if (/comment|reply|message|respond|say|opinion|thought|write|post|avis|réagir/i.test(hint)) s += 10
        if (/blogger|blogspot|giscus|disqus|utteranc/i.test(hint)) s += 5
        var r = el.getBoundingClientRect()
        if (r.width > 80 && r.height > 40 && r.top < window.innerHeight && r.top > -20) s += 3
        return s
    }
    var textareas = document.querySelectorAll('textarea')
    var best = null
    var bestScore = -1
    var i
    for (i = 0; i < textareas.length; i++) {
        var el = textareas[i]
        var r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        var sc = scoreTextarea(el)
        if (sc > bestScore) {
            bestScore = sc
            best = el
        }
    }
    if (best && bestScore >= 3) {
        fireTextarea(best, commentStr)
        clickSubmitInForm(best.closest('form'))
        return true
    }
    if (best && textareas.length <= 12) {
        fireTextarea(best, commentStr)
        clickSubmitInForm(best.closest('form'))
        return true
    }
    var edits = document.querySelectorAll('[contenteditable="true"]')
    for (i = 0; i < edits.length; i++) {
        var ce = edits[i]
        var hint =
            (ce.getAttribute('placeholder') || '') +
            ' ' +
            (ce.getAttribute('aria-label') || '') +
            ' ' +
            (ce.className || '')
        var rr = ce.getBoundingClientRect()
        if (rr.width < 2 || rr.height < 2) continue
        if (/comment|reply|message|respond/i.test(hint) || edits.length <= 8) {
            fireContentEditable(ce, commentStr)
            clickSubmitInForm(ce.closest('form'))
            return true
        }
    }
    return false
}

function injectFillEmail(addr) {
    if (!addr) return
    var els = document.querySelectorAll(
        'input[type="email"],input[name*="email" i],input[id*="email" i],input[placeholder*="mail" i],input[autocomplete="email"]'
    )
    var i
    for (i = 0; i < els.length && i < 10; i++) {
        var el = els[i]
        var r = el.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) continue
        try {
            el.focus()
            el.value = addr
            el.dispatchEvent(new Event('input', { bubbles: true }))
            el.dispatchEvent(new Event('change', { bubbles: true }))
            return
        } catch (e) {}
    }
}

function injectLikeClick() {
    var patterns = [
        '[aria-label*="like" i]',
        '[aria-label*="Love" i]',
        '[data-testid*="like" i]',
        'button[title*="like" i]',
        '[role="button"][class*="like" i]',
        '[class*="LikeButton" i]',
        '[class*="like-button" i]'
    ]
    var p
    for (p = 0; p < patterns.length; p++) {
        var els = document.querySelectorAll(patterns[p])
        var i
        for (i = 0; i < els.length; i++) {
            var el = els[i]
            var r = el.getBoundingClientRect()
            if (r.width < 4 || r.height < 4 || r.bottom < 0) continue
            try {
                el.click()
                return
            } catch (e) {}
        }
    }
}

/**
 * @param {{ like?: boolean, comment?: boolean, commentText?: string }} opts
 * @param {string} [sessionEmail]
 */
async function runEngagement(driver, opts, sessionEmail) {
    const like = !!opts.like
    const text = String(opts.commentText || '').trim()
    const doComment = !!opts.comment && text.length > 0
    const emailAddr = String(sessionEmail || '').trim()
    const doFillEmail = emailAddr.length > 0
    if (!like && !doComment && !doFillEmail) return

    if (doFillEmail) {
        await driver.executeScript(injectFillEmail, emailAddr)
        await driver.sleep(400)
    }
    if (like) {
        await driver.executeScript(injectLikeClick)
        await driver.sleep(500)
    }
    if (doComment) {
        await driver.sleep(2200)
        await driver.executeScript(injectCommentOnly, text)
        var frames
        try {
            frames = await driver.findElements(By.css('iframe'))
        } catch (e) {
            frames = []
        }
        var fi
        for (fi = 0; fi < Math.min(frames.length, 35); fi++) {
            try {
                await driver.switchTo().frame(frames[fi])
                await driver.executeScript(injectCommentOnly, text)
                await driver.switchTo().defaultContent()
            } catch (e) {
                try {
                    await driver.switchTo().defaultContent()
                } catch (e2) {}
            }
        }
    }
}

module.exports = {
    scroll: scroll,
    runEngagement: runEngagement
}
