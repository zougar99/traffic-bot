$(document).ready(async function () {
    var LS_KEY = 'wgtb-ui-v2'
    $('#keyboard').hide()

    var porxylist = await window.wgtb.proxylist()
    $('#proxys').val(porxylist)

    var info = await window.wgtb.getAppInfo()
    $('#app-version').html(
        info.name +
            ' v' +
            info.version +
            ' · Electron ' +
            info.electron +
            (info.developerHandle
                ? ' · <span id="dev-tg-link" style="cursor:pointer;text-decoration:underline;color:#1a5fb4;">@' +
                  info.developerHandle +
                  '</span>'
                : '')
    )
    var devParts = []
    if (info.platform) devParts.push(info.platform + (info.arch ? ' ' + info.arch : ''))
    if (info.chrome) devParts.push('Chromium ' + info.chrome)
    $('#dev-summary').text(devParts.join(' · '))

    $('#dev-tg-link').on('click', async function (e) {
        e.preventDefault()
        if (info.developerTelegram) {
            var r = await window.wgtb.openExternalSafe(info.developerTelegram)
            if (!r.ok) alertbox(r.error || 'Open failed', 'danger', 4000)
        }
    })

    async function refreshCommentsUi() {
        var n = await window.wgtb.commentsCount()
        $('#comments-total').val(n)
    }
    await refreshCommentsUi()

    function isValidHttpUrl(s) {
        try {
            var u = new URL(s.trim())
            return u.protocol === 'http:' || u.protocol === 'https:'
        } catch (e) {
            return false
        }
    }

    function collectAllUrls() {
        var list = []
        var main = $('#url').val()
        if (String(main).trim()) list.push(String(main).trim())
        $('.extra-url-input').each(function () {
            var v = $(this).val()
            if (String(v).trim()) list.push(String(v).trim())
        })
        return list
    }

    function addExtraUrlRow(val) {
        var row = $(
            '<div class="input-group mb-1 extra-url-row">' +
                '<span class="input-group-text">+</span>' +
                '<input type="text" class="form-control extra-url-input" placeholder="https://…">' +
                '<button type="button" class="btn btn-outline-danger btn-sm btn-remove-extra">×</button>' +
                '</div>'
        )
        row.find('.extra-url-input').val(val ? String(val) : '')
        $('#extra-urls-list').append(row)
    }

    $('#btn-add-link').click(function () {
        addExtraUrlRow('')
    })
    $('#extra-urls-list').on('click', '.btn-remove-extra', function () {
        $(this).closest('.extra-url-row').remove()
        updateMainUrlBar()
    })

    function updateKeyboardVisibility() {
        var opt = $('#option').val()
        if (opt === 'Google' || opt === 'Proxy') $('#keyboard').show(200)
        else $('#keyboard').hide(200)
        updateMainUrlBar()
    }

    function faviconUrlForSite(urlStr) {
        try {
            var u = new URL(String(urlStr).trim())
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
            return 'https://www.google.com/s2/favicons?sz=48&domain=' + encodeURIComponent(u.hostname)
        } catch (e) {
            return ''
        }
    }

    function updateUrlFaviconPreview() {
        var raw = String($('#url').val() || '').trim()
        var wrap = $('#url-favicon-wrap')
        var img = $('#url-favicon')
        if (!isValidHttpUrl(raw)) {
            wrap.hide()
            img.attr('src', '')
            return
        }
        var src = faviconUrlForSite(raw)
        if (!src) {
            wrap.hide()
            return
        }
        img.off('error.wgtb').on('error.wgtb', function () {
            wrap.hide()
        })
        img.attr('src', src)
        wrap.css('display', 'flex')
    }

    function updateMainUrlBar() {
        var direct = $('#option').val() === 'Direct'
        $('#direct-url-hint').toggle(!!direct)
        var raw = String($('#url').val() || '').trim()
        $('#url-open-default-browser').toggle(!!direct && isValidHttpUrl(raw))
        updateUrlFaviconPreview()
    }

    function saveFormState() {
        try {
            var extraUrls = []
            $('.extra-url-input').each(function () {
                extraUrls.push(String($(this).val() || ''))
            })
            localStorage.setItem(
                LS_KEY,
                JSON.stringify({
                    url: $('#url').val(),
                    extraUrls: extraUrls,
                    keyboard: $('#keyboard-i').val(),
                    count: $('#count').val(),
                    option: $('#option').val(),
                    engageLike: $('#engage-like').prop('checked'),
                    engageComment: $('#engage-comment').prop('checked'),
                    engageCommentFile: $('#engage-comment-file').prop('checked'),
                    engageCommentText: $('#engage-comment-text').val(),
                    sessionHeadless: $('#session-headless').prop('checked'),
                    sessionEmailRotate: $('#session-email-rotate').prop('checked'),
                    sessionPause: $('#session-pause').val(),
                    sessionAfterLoad: $('#session-after-load').val(),
                    sessionDwell: $('#session-dwell').val()
                })
            )
        } catch (err) {}
    }

    var _saveTimer
    function saveFormDebounced() {
        clearTimeout(_saveTimer)
        _saveTimer = setTimeout(saveFormState, 450)
    }

    function loadFormState() {
        try {
            var raw = localStorage.getItem(LS_KEY)
            if (!raw) return
            var d = JSON.parse(raw)
            if (d.url) $('#url').val(d.url)
            if (d.extraUrls && d.extraUrls.length) {
                var k
                for (k = 0; k < d.extraUrls.length; k++) {
                    if (d.extraUrls[k] && String(d.extraUrls[k]).trim()) addExtraUrlRow(String(d.extraUrls[k]).trim())
                }
            }
            if (d.keyboard !== undefined) $('#keyboard-i').val(d.keyboard)
            if (d.count !== undefined && String(d.count).trim() !== '') $('#count').val(d.count)
            if (d.option) $('#option').val(d.option)
            if (d.engageLike !== undefined) $('#engage-like').prop('checked', !!d.engageLike)
            if (d.engageComment !== undefined) $('#engage-comment').prop('checked', !!d.engageComment)
            if (d.engageCommentFile !== undefined) $('#engage-comment-file').prop('checked', !!d.engageCommentFile)
            if (d.engageCommentText !== undefined) $('#engage-comment-text').val(d.engageCommentText)
            if (d.sessionHeadless !== undefined) $('#session-headless').prop('checked', !!d.sessionHeadless)
            if (d.sessionEmailRotate !== undefined) $('#session-email-rotate').prop('checked', !!d.sessionEmailRotate)
            if (d.sessionPause !== undefined) $('#session-pause').val(d.sessionPause)
            if (d.sessionAfterLoad !== undefined) $('#session-after-load').val(d.sessionAfterLoad)
            if (d.sessionDwell !== undefined) $('#session-dwell').val(d.sessionDwell)
            updateKeyboardVisibility()
        } catch (err) {}
    }
    loadFormState()
    updateMainUrlBar()
    $('#app-panel').on('input change', 'input, select, textarea', saveFormDebounced)

    var lastClass = ''
    function alertbox(message, type, timer) {
        $('#alert').hide().show(300).removeClass(lastClass).addClass('alert-' + type)
        lastClass = 'alert-' + type
        $('#alert').html(message)
        setTimeout(function () {
            $('#alert').hide(100)
        }, timer)
    }

    $('#option').change(updateKeyboardVisibility)
    $('#url').on('input blur', updateMainUrlBar)

    $('#url-open-default-browser').click(async function () {
        var raw = String($('#url').val() || '').trim()
        if (!isValidHttpUrl(raw)) return alertbox('Invalid URL.', 'danger', 4000)
        var r = await window.wgtb.openExternalSafe(raw)
        if (!r.ok) alertbox(r.error || 'Open failed', 'danger', 5000)
    })

    $('#start').click(async function () {
        var urls = collectAllUrls()
        var keyboard = $('#keyboard-i').val() || ''
        var option = $('#option').val()
        if (!urls.length) return alertbox('Add at least one URL.', 'danger', 5000)
        var ui
        for (ui = 0; ui < urls.length; ui++) {
            if (!isValidHttpUrl(urls[ui])) return alertbox('Invalid URL: ' + urls[ui], 'danger', 6000)
        }
        if ((option === 'Google' || option === 'Proxy') && !String(keyboard).trim()) {
            $('#keyboard').show(200)
            try {
                $('#keyboard-i').focus()
            } catch (e) {}
            return alertbox(
                '<b>KEYWORD required</b> for Google / Proxy.<br><span class="small">Use <b>Direct</b> to open URLs only.</span>',
                'danger',
                9000
            )
        }
        var runCount = Math.max(1, parseInt(String($('#count').val() || '1').trim(), 10) || 1)
        $('#count').val(String(runCount))

        var engageComment = $('#engage-comment').is(':checked')
        var useCommentFile = $('#engage-comment-file').is(':checked')
        var engageText = $('#engage-comment-text').val() || ''
        var nComments = await window.wgtb.commentsCount()
        if (engageComment && useCommentFile && nComments < 1)
            return alertbox('Add lines in comments/ or uncheck random.', 'warning', 6000)
        if (engageComment && !useCommentFile && !String(engageText).trim())
            return alertbox('Comment fallback required.', 'warning', 5000)

        var session = {
            headless: $('#session-headless').is(':checked'),
            useEmailRotate: $('#session-email-rotate').is(':checked'),
            pauseBetweenSec: parseFloat($('#session-pause').val()) || 0,
            afterLoadSec: parseFloat($('#session-after-load').val()) || 1,
            dwellBeforeEngageSec: parseFloat($('#session-dwell').val()) || 2.5,
            useCommentFile: useCommentFile
        }

        saveFormState()
        alertbox('Started — ' + urls.length + ' URL(s) × ' + runCount + '.', 'success', 12000)
        window.wgtb
            .start(
                urls,
                keyboard,
                runCount,
                option,
                {
                    like: $('#engage-like').is(':checked'),
                    comment: engageComment,
                    commentText: String(engageText).trim()
                },
                session
            )
            .catch(function (e) {
                alertbox(String(e && e.message ? e.message : e), 'danger', 10000)
            })
    })

    $('#stop').click(function () {
        window.wgtb.stop()
        alertbox('Stop requested.', 'danger', 3000)
    })

    $('#tool-refresh-proxy').click(async function () {
        var n = await window.wgtb.proxylist()
        $('#proxys').val(n)
        await refreshCommentsUi()
        alertbox('Refreshed.', 'success', 3000)
    })
    $('#tool-open-folder').click(async function () {
        var err = await window.wgtb.openProxyFolder()
        if (err) alertbox(err, 'danger', 5000)
    })
    $('#tool-open-comments').click(async function () {
        var err = await window.wgtb.openCommentsFolder()
        if (err) alertbox(err, 'danger', 5000)
    })
    $('#tool-clear').click(function () {
        $('#url').val('')
        $('#extra-urls-list').empty()
        $('#keyboard-i').val('')
        $('#count').val('1')
        $('#engage-like, #engage-comment, #engage-comment-file').prop('checked', false)
        $('#engage-comment-text').val('')
        $('#session-headless').prop('checked', false)
        $('#session-email-rotate').prop('checked', true)
        $('#session-pause').val('0')
        $('#session-after-load').val('1')
        $('#session-dwell').val('2.5')
        try {
            localStorage.removeItem(LS_KEY)
        } catch (e) {}
        updateMainUrlBar()
        alertbox('Cleared.', 'secondary', 2500)
    })
    $('#tool-check-driver').click(async function () {
        var r = await window.wgtb.checkChromeDriver()
        if (r.ok) alertbox('ChromeDriver OK.', 'success', 6000)
        else alertbox(r.error || 'Error', 'danger', 8000)
    })
    $('#tool-devtools').click(function () {
        window.wgtb.toggleDevTools()
    })

    $('#tool-dev-telegram').click(async function () {
        if (info.developerTelegram) {
            var r = await window.wgtb.openExternalSafe(info.developerTelegram)
            if (!r.ok) alertbox(r.error || 'Open failed', 'danger', 4000)
        }
    })
    $('#tool-dev-diagnostics').click(async function () {
        var fresh = await window.wgtb.getAppInfo()
        var paths = await window.wgtb.getPaths()
        var cd = await window.wgtb.checkChromeDriver()
        var payload = {
            app: fresh.name,
            version: fresh.version,
            electron: fresh.electron,
            node: fresh.node,
            chromium: fresh.chrome || '',
            platform: fresh.platform,
            arch: fresh.arch,
            paths: paths,
            chromedriver: cd.ok ? { ok: true, path: cd.path } : { ok: false, error: cd.error }
        }
        await window.wgtb.copyText(JSON.stringify(payload, null, 2))
        alertbox('Diagnostics copied.', 'success', 5000)
    })
    $('#tool-dev-userdata').click(async function () {
        var err = await window.wgtb.openUserDataFolder()
        if (err) alertbox(err, 'danger', 5000)
    })
    $('#tool-dev-reload').click(function () {
        window.wgtb.reloadWindow()
    })
})
