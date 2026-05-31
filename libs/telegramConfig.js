const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '..', 'telegram.config.json')

function escapeHtml(s) {
    return String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function normalizeTelegramToken(raw) {
    if (!raw || typeof raw !== 'string') return ''
    let t = raw.trim().replace(/\s+/g, '')
    const fromUrl = t.match(/telegram\.org\/bot([^/?#]+)/i)
    if (fromUrl) t = fromUrl[1]
    if (t.toLowerCase().startsWith('bot')) t = t.slice(3)
    return t.trim()
}

/** Reject only obvious tutorial / fake fillers — do not scan for substrings like "example" (false positives on real tokens). */
function looksLikePlaceholderToken(t) {
    if (!t) return true
    var lower = t.toLowerCase()
    var obvious = [
        'paste_your_token',
        'paste_token',
        'your_token_here',
        'replace_with',
        'colle_ici',
        'met_ton_token',
        'botfather_token',
        '123456789:aahxxxxxxxx'
    ]
    for (var o = 0; o < obvious.length; o++) {
        if (lower.indexOf(obvious[o]) !== -1) return true
    }
    // Ancien exemple: ID:AA + longue chaîne de x
    if (/^\d{6,12}:aa[h]?x{24,}$/i.test(t)) return true
    return false
}

function isValidBotToken(t) {
    if (!t || t.length < 35) return false
    const i = t.indexOf(':')
    if (i < 5) return false
    const botId = t.slice(0, i)
    const secret = t.slice(i + 1)
    if (!/^\d+$/.test(botId) || secret.length < 25) return false
    if (looksLikePlaceholderToken(t)) return false
    return true
}

function loadConfig() {
    if (!fs.existsSync(CONFIG_PATH)) return null
    try {
        const raw = fs.readFileSync(CONFIG_PATH, 'utf8')
        const cfg = JSON.parse(raw)
        if (!cfg.token || typeof cfg.token !== 'string') return null
        const token = normalizeTelegramToken(cfg.token)
        if (!token || looksLikePlaceholderToken(token)) {
            console.warn('[telegram] Replace placeholder token in telegram.config.json (BotFather → /newbot)')
            return null
        }
        if (!isValidBotToken(token)) {
            console.error(
                '[telegram] Token format invalid. Expected: 123456789:AA... from @BotFather (404 often = wrong token)'
            )
            return null
        }
        return {
            token,
            allowedChatIds: Array.isArray(cfg.allowedChatIds)
                ? cfg.allowedChatIds.map(Number).filter((n) => !Number.isNaN(n))
                : []
        }
    } catch (e) {
        console.error('[telegram] Invalid telegram.config.json:', e.message)
        return null
    }
}

/**
 * Pour scripts (test:telegram) — message clair si loadConfig() échoue.
 * @returns {{ ok: true, config: object } | { ok: false, code: string, detail?: string }}
 */
function diagnoseTelegramConfig() {
    if (!fs.existsSync(CONFIG_PATH)) {
        return {
            ok: false,
            code: 'missing_file',
            detail: CONFIG_PATH
        }
    }
    var rawText
    try {
        rawText = fs.readFileSync(CONFIG_PATH, 'utf8')
    } catch (e) {
        return { ok: false, code: 'read_error', detail: e.message }
    }
    var cfg
    try {
        cfg = JSON.parse(rawText)
    } catch (e) {
        return { ok: false, code: 'bad_json', detail: e.message }
    }
    if (!cfg.token || typeof cfg.token !== 'string') {
        return { ok: false, code: 'no_token' }
    }
    var token = normalizeTelegramToken(cfg.token)
    if (!token) {
        return { ok: false, code: 'empty_token' }
    }
    if (looksLikePlaceholderToken(token)) {
        return { ok: false, code: 'placeholder_token' }
    }
    if (!isValidBotToken(token)) {
        return { ok: false, code: 'invalid_token_format' }
    }
    var allowedChatIds = Array.isArray(cfg.allowedChatIds)
        ? cfg.allowedChatIds.map(Number).filter(function (n) {
              return !Number.isNaN(n)
          })
        : []
    if (!allowedChatIds.length) {
        return { ok: false, code: 'no_allowed_chats' }
    }
    return {
        ok: true,
        config: {
            token: token,
            allowedChatIds: allowedChatIds
        }
    }
}

module.exports = {
    CONFIG_PATH,
    escapeHtml,
    loadConfig,
    normalizeTelegramToken,
    isValidBotToken,
    looksLikePlaceholderToken,
    diagnoseTelegramConfig
}
