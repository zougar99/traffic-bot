const { Telegraf } = require('telegraf')
const seobot = require('./index')
const loadproxy = require('./proxy')
const { escapeHtml, loadConfig } = require('./telegramConfig')
const { notifyTestPing } = require('./telegramNotify')
const pkg = require('../package.json')

let botInstance = null

function replyHtml(ctx, lines) {
    const text = Array.isArray(lines) ? lines.join('\n') : lines
    return ctx.reply(text, {
        parse_mode: 'HTML',
        disable_web_page_preview: true
    })
}

function isAllowed(config, ctx) {
    const id = ctx.chat && ctx.chat.id
    if (id == null) return false
    if (!config.allowedChatIds.length) return false
    return config.allowedChatIds.includes(id)
}

function parseRunArgs(text) {
    const trimmed = text.replace(/^\/run(@\w+)?\s+/i, '').trim()
    const urlMatch = trimmed.match(/^(https?:\/\/\S+)/i)
    if (!urlMatch) return { error: 'Bad URL. Example:\n/run https://example.com 3 Direct' }
    const url = urlMatch[1]
    let afterUrl = trimmed.slice(url.length).trim()

    const like = /\s--like(?:\s|$)/i.test(afterUrl)
    let commentText = ''
    const cMatch = afterUrl.match(/\s--comment\s+(.+)$/is)
    if (cMatch) {
        commentText = cMatch[1].trim()
        afterUrl = afterUrl.slice(0, afterUrl.length - cMatch[0].length).trim()
    }
    afterUrl = afterUrl.replace(/\s--like(?:\s|$)/gi, ' ').replace(/\s+/g, ' ').trim()

    const parts = afterUrl.split(/\s+/).filter(Boolean)
    if (parts.length < 2) {
        return {
            error:
                'Missing count or mode.\nExample: /run https://example.com 5 Direct\nGoogle: /run https://example.com 2 Google keyword\nAdd: --like  and/or  --comment your text'
        }
    }
    const count = parseInt(parts[0], 10)
    if (!Number.isFinite(count) || count < 1) {
        return { error: 'Count must be a positive number.' }
    }
    const modeRaw = (parts[1] || '').trim()
    const modeMap = { direct: 'Direct', google: 'Google', proxy: 'Proxy' }
    const key = modeRaw.toLowerCase()
    const option = modeMap[key] || (['Direct', 'Google', 'Proxy'].includes(modeRaw) ? modeRaw : null)
    if (!option) {
        return { error: 'Mode must be Direct, Google, or Proxy.' }
    }
    const keyboard = parts.slice(2).join(' ').trim()
    if ((option === 'Google' || option === 'Proxy') && !keyboard) {
        return { error: 'Google and Proxy modes need a search keyword after the mode.' }
    }
    const engage = {
        like,
        comment: commentText.length > 0,
        commentText
    }
    return { url, count, option, keyboard, engage }
}

function startTelegramBot() {
    const config = loadConfig()
    if (!config) {
        console.log('[telegram] No telegram.config.json — bot disabled. Copy telegram.config.json.example')
        return
    }
    if (!config.allowedChatIds.length) {
        console.warn('[telegram] allowedChatIds is empty — all /run and /stop denied. Edit telegram.config.json')
    }

    const bot = new Telegraf(config.token)

    bot.command('myid', (ctx) => {
        return replyHtml(ctx, [
            '🆔 <b>Chat ID</b>',
            '',
            `<code>${escapeHtml(String(ctx.chat.id))}</code>`,
            '',
            '📋 Copie ce numéro dans <code>allowedChatIds</code> (telegram.config.json).'
        ])
    })

    bot.start((ctx) => {
        var devLine =
            pkg.developer && pkg.developer.telegram && pkg.developer.name
                ? [
                      '👤 <b>Dev</b> — <a href="' +
                          escapeHtml(pkg.developer.telegram) +
                          '">' +
                          escapeHtml('@' + pkg.developer.name) +
                          '</a>',
                      ''
                  ]
                : []
        return replyHtml(ctx, [
            '🤖 <b>Traffic Bot</b>',
            '',
            ...devLine,
            '⚡ Commandes rapides :',
            '• /myid — ton chat ID',
            '• /help — aide détaillée',
            '• /status — nombre de proxies',
            '• /run … — lancer (chats autorisés)',
            '• /stop — arrêter',
            '• /testnotify — test notif (même canal que l’app)'
        ])
    })

    bot.help((ctx) => {
        var devHelp =
            pkg.developer && pkg.developer.telegram && pkg.developer.name
                ? [
                      '👤 <b>Dev</b> — <a href="' +
                          escapeHtml(pkg.developer.telegram) +
                          '">' +
                          escapeHtml('@' + pkg.developer.name) +
                          '</a>',
                      ''
                  ]
                : []
        return replyHtml(ctx, [
            '📖 <b>Aide</b>',
            '',
            ...devHelp,
            '<b>Commandes</b>',
            '/myid — ID Telegram → <code>allowedChatIds</code>',
            '/status — lignes proxy chargées',
            '/stop — arrêt des sessions',
            '/testnotify — envoie un message test (comme le bouton Start)',
            '',
            '<b>/run</b> <code>URL</code> <code>count</code> <code>Direct|Google|Proxy</code> <i>[mot-clé]</i>',
            '',
            '<b>Exemples</b>',
            '<code>/run https://a.com 3 Direct</code>',
            '<code>/run https://a.com 2 Google recherche</code>',
            '<code>/run https://a.com 1 Direct --like</code>',
            '<code>/run https://a.com 1 Direct --comment Super</code>'
        ])
    })

    bot.command('testnotify', async (ctx) => {
        if (!isAllowed(config, ctx)) {
            return replyHtml(ctx, ['⛔ <b>Accès refusé</b>', '', 'Ajoute ton chat ID dans <code>allowedChatIds</code>.'])
        }
        try {
            await notifyTestPing()
            return replyHtml(ctx, [
                '🧪 <b>Test envoyé</b>',
                '',
                'Vérifie Telegram : même canal que les notifs du <b>bouton Start</b> (tous les <code>allowedChatIds</code>).'
            ])
        } catch (e) {
            return replyHtml(ctx, ['❌ <b>Erreur</b>', '', escapeHtml(e.message || String(e))])
        }
    })

    bot.command('status', async (ctx) => {
        if (!isAllowed(config, ctx)) {
            return replyHtml(ctx, ['⛔ <b>Accès refusé</b>', '', 'Ajoute ton chat ID dans <code>allowedChatIds</code>.'])
        }
        try {
            const list = await loadproxy()
            const n = list.length
            return replyHtml(ctx, [
                '📊 <b>Proxies</b>',
                '',
                `✅ <b>${escapeHtml(String(n))}</b> lignes chargées dans le dossier <code>proxy/</code>`
            ])
        } catch (e) {
            return replyHtml(ctx, ['❌ <b>Erreur</b>', '', escapeHtml(e.message || String(e))])
        }
    })

    bot.command('run', async (ctx) => {
        if (!isAllowed(config, ctx)) {
            return replyHtml(ctx, ['⛔ <b>Accès refusé</b>', '', 'Ajoute ton chat ID dans <code>allowedChatIds</code>.'])
        }
        const parsed = parseRunArgs(ctx.message.text || '')
        if (parsed.error) {
            return replyHtml(ctx, ['⚠️ <b>Commande invalide</b>', '', escapeHtml(parsed.error)])
        }
        try {
            seobot.main([parsed.url], parsed.keyboard, parsed.count, parsed.option, parsed.engage, {})
            const lines = [
                '🚀 <b>Session lancée</b>',
                '',
                `📌 <b>Mode</b> — <code>${escapeHtml(parsed.option)}</code>`,
                `🔗 <b>URL</b> — <code>${escapeHtml(parsed.url)}</code>`,
                `🔢 <b>Count</b> — <code>${escapeHtml(String(parsed.count))}</code>`
            ]
            if (parsed.keyboard) {
                lines.push(`🔎 <b>Keyword</b> — ${escapeHtml(parsed.keyboard)}`)
            }
            if (parsed.engage && parsed.engage.like) {
                lines.push('👍 <b>Like</b> — activé')
            }
            if (parsed.engage && parsed.engage.comment && parsed.engage.commentText) {
                lines.push(`💬 <b>Comment</b> — ${escapeHtml(parsed.engage.commentText)}`)
            }
            lines.push('', '⏳ Les navigateurs démarrent sur cette machine…')
            return replyHtml(ctx, lines)
        } catch (e) {
            return replyHtml(ctx, ['❌ <b>Erreur</b>', '', escapeHtml(e.message || String(e))])
        }
    })

    bot.command('stop', async (ctx) => {
        if (!isAllowed(config, ctx)) {
            return replyHtml(ctx, ['⛔ <b>Accès refusé</b>', '', 'Ajoute ton chat ID dans <code>allowedChatIds</code>.'])
        }
        try {
            seobot.stop()
            return replyHtml(ctx, [
                '🛑 <b>Arrêt demandé</b>',
                '',
                'Les sessions vont se fermer (quelques secondes).'
            ])
        } catch (e) {
            return replyHtml(ctx, ['❌ <b>Erreur</b>', '', escapeHtml(e.message || String(e))])
        }
    })

    bot.catch((err, ctx) => {
        console.error('[telegram]', err)
        if (ctx && ctx.reply) {
            replyHtml(ctx, ['❌ <b>Erreur bot</b>', '', escapeHtml(err.message || String(err))]).catch(
                () => {}
            )
        }
    })

    bot
        .launch()
        .then(() => {
            botInstance = bot
            console.log('[telegram] Bot running')
        })
        .catch((err) => {
            const msg = err && err.message ? err.message : String(err)
            console.error('[telegram] Failed to start:', msg)
            if (/404|Not Found/i.test(msg)) {
                console.error(
                    '[telegram] → Open @BotFather → /mybots → your bot → API Token → copy full token into telegram.config.json'
                )
            }
            if (/401|Unauthorized/i.test(msg)) {
                console.error('[telegram] → Token revoked or wrong. Generate a new token in BotFather.')
            }
            botInstance = null
        })
}

function stopTelegramBot() {
    if (!botInstance) return
    try {
        botInstance.stop('SIGTERM')
    } catch (e) {
        const m = e && e.message ? e.message : String(e)
        if (!/not running/i.test(m)) console.error('[telegram] stop:', m)
    }
    botInstance = null
}

module.exports = { startTelegramBot, stopTelegramBot }
