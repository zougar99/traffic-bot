const { Telegraf } = require('telegraf')
const { loadConfig, escapeHtml } = require('./telegramConfig')
const pkg = require('../package.json')

async function sendHtmlToAllowedChats(html) {
    const config = loadConfig()
    if (!config || !config.allowedChatIds.length) return
    const api = new Telegraf(config.token).telegram
    for (var i = 0; i < config.allowedChatIds.length; i++) {
        try {
            await api.sendMessage(config.allowedChatIds[i], html, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            })
        } catch (e) {
            console.error('[telegramNotify]', e && e.message ? e.message : e)
        }
    }
}

/**
 * Desktop app clicked Start — same chats as allowedChatIds in telegram.config.json
 */
async function notifyDesktopRunStart(opts) {
    var urls = opts.urls || []
    var lines = [
        '🖥 <b>WGTB</b>',
        '<i>Lancement depuis l’application</i>',
        '',
        '⚡ <b>Mode</b> — <code>' + escapeHtml(String(opts.option || '')) + '</code>',
        '🔢 <b>Sessions prévues</b> — <code>' + escapeHtml(String(opts.totalSessions || 0)) + '</code>',
        '📎 <b>URLs</b> — <code>' + escapeHtml(String(urls.length)) + '</code> × count <code>' + escapeHtml(String(opts.countPerUrl || 0)) + '</code>'
    ]
    var preview = urls.slice(0, 4)
    for (var u = 0; u < preview.length; u++) {
        lines.push('🔗 <code>' + escapeHtml(preview[u]) + '</code>')
    }
    if (urls.length > 4) lines.push('… <i>+' + (urls.length - 4) + ' URL(s)</i>')
    if (opts.keyboard) {
        lines.push('🔎 <b>Mot-clé</b> — ' + escapeHtml(String(opts.keyboard)))
    }
    var eg = opts.engage || {}
    if (eg.like) lines.push('👍 <b>Like</b> — oui')
    if (eg.comment && eg.commentText) {
        lines.push('💬 <b>Commentaire</b> — ' + escapeHtml(String(eg.commentText)))
    }
    lines.push('', '⏳ <i>Les sessions démarrent sur ce PC…</i>')
    if (pkg.developer && pkg.developer.name) {
        lines.push(
            '',
            '👤 <i>Dev — @' + escapeHtml(String(pkg.developer.name)) + '</i>'
        )
    }
    await sendHtmlToAllowedChats(lines.join('\n'))
}

async function notifyDesktopSessionOk(payload) {
    var lines = [
        '✅ <b>Session</b> <code>' + escapeHtml(String(payload.completed)) + '</code>/<code>' + escapeHtml(String(payload.totalSessions)) + '</code>',
        '⚡ <code>' + escapeHtml(String(payload.option || '')) + '</code>',
        '🔗 <code>' + escapeHtml(String(payload.url || '')) + '</code>'
    ]
    if (payload.proxy) lines.push('🌐 <b>Proxy</b> — <code>' + escapeHtml(String(payload.proxy)) + '</code>')
    if (payload.email) lines.push('📧 <b>Email</b> — <code>' + escapeHtml(String(payload.email)) + '</code>')
    await sendHtmlToAllowedChats(lines.join('\n'))
}

async function notifyDesktopSessionFail(payload) {
    var msg = payload.err && payload.err.message ? payload.err.message : String(payload.err || '')
    var lines = [
        '⚠️ <b>Session échouée</b> <code>' + escapeHtml(String(payload.sessionIndex)) + '</code>',
        '',
        escapeHtml(msg.slice(0, 800))
    ]
    if (payload.fatal) {
        lines.push('', '⛔ <b>Arrêt</b> — corrige ChromeDriver / Chrome puis relance.')
        if (/DevToolsActivePort|session not created/i.test(msg)) {
            lines.push(
                '',
                '💡 <i>DevToolsActivePort</i> : désactive <b>Headless</b>, ferme les Chrome en trop, mets Chrome à jour, ou redémarre le PC.'
            )
        }
    }
    await sendHtmlToAllowedChats(lines.join('\n'))
}

async function notifyDesktopRunDone(payload) {
    var lines = [
        '🏁 <b>Run terminé</b>',
        '',
        '✅ <b>Sessions OK</b> — <code>' + escapeHtml(String(payload.completed || 0)) + '</code>/<code>' + escapeHtml(String(payload.totalSessions || 0)) + '</code>'
    ]
    if (payload.aborted) {
        lines.push('', '⚠️ <i>Interrompu (erreur driver ou arrêt)</i>')
    }
    await sendHtmlToAllowedChats(lines.join('\n'))
}

async function notifyDesktopRunError(err) {
    var msg = err && err.message ? err.message : String(err || '')
    await sendHtmlToAllowedChats(['❌ <b>Erreur run</b>', '', escapeHtml(msg.slice(0, 1200))].join('\n'))
}

/** Même canal que les notifs « depuis l’app » — pour tester sans lancer Chrome */
async function notifyTestPing() {
    var text = [
        '🧪 <b>Test notification</b>',
        '',
        '✅ إلا وصلتك هاد الرسالة، <code>telegram.config.json</code> خدام.',
        'Les notifs du bouton <b>Start</b> (application) utilisent le même canal.',
        '',
        '<i>(npm run test:telegram)</i>'
    ].join('\n')
    await sendHtmlToAllowedChats(text)
}

module.exports = {
    notifyDesktopRunStart,
    notifyDesktopSessionOk,
    notifyDesktopSessionFail,
    notifyDesktopRunDone,
    notifyDesktopRunError,
    notifyTestPing
}
