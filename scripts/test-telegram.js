/**
 * Test des notifications Telegram (même chemin que Start dans l’app).
 * Usage: npm run test:telegram
 */
const path = require('path')

process.chdir(path.join(__dirname, '..'))

const { CONFIG_PATH, diagnoseTelegramConfig } = require('../libs/telegramConfig')
const { notifyTestPing } = require('../libs/telegramNotify')

function printFixSteps() {
    var rel = path.relative(process.cwd(), CONFIG_PATH) || 'telegram.config.json'
    console.error('')
    console.error('─── خاصك دير هاد الخطوات ───')
    console.error('1) Telegram → @BotFather → /newbot → copie le TOKEN (format: 123456789:AA…)')
    console.error('2) Crée le fichier à la racine du projet :')
    console.error('   ' + rel)
    console.error('   (copie telegram.config.json.example puis modifie)')
    console.error('3) Remplace "token" par ton VRAI token — pas les chiffres/xxx de l’exemple.')
    console.error('4) Mets ton chat ID dans "allowedChatIds" :')
    console.error('   - Lance une fois: npm start')
    console.error('   - Envoie /myid à ton bot dans Telegram, copie le nombre dans le JSON.')
    console.error('')
}

function printDiagnosis(d) {
    if (d.code === 'missing_file') {
        console.error('Fichier introuvable:', d.detail)
        printFixSteps()
        return
    }
    if (d.code === 'bad_json') {
        console.error('JSON invalide dans telegram.config.json:', d.detail)
        printFixSteps()
        return
    }
    if (d.code === 'read_error') {
        console.error('Lecture impossible:', d.detail)
        return
    }
    if (d.code === 'no_token') {
        console.error('Clé "token" absente dans telegram.config.json.')
        printFixSteps()
        return
    }
    if (d.code === 'empty_token') {
        console.error('Le champ "token" est vide. Colle le token de @BotFather (format 123456789:AA…).')
        printFixSteps()
        return
    }
    if (d.code === 'placeholder_token') {
        console.error('Le token ressemble à un texte d’exemple (tutoriel), pas au token BotFather.')
        console.error('Ouvre telegram.config.json : une seule ligne "token": "123456789:AA…" (sans guillemets en trop, sans URL complète).')
        printFixSteps()
        return
    }
    if (d.code === 'invalid_token_format') {
        console.error('Format du token incorrect. Attendu: chiffres puis ":" puis ~35 caractères (ex. 123456789:AA…)')
        printFixSteps()
        return
    }
    if (d.code === 'no_allowed_chats') {
        console.error('allowedChatIds est vide ou absent.')
        console.error('Ajoute ton ID numérique (résultat de /myid avec le bot), ex: "allowedChatIds": [ 123456789 ]')
        printFixSteps()
        return
    }
}

async function main() {
    var d = diagnoseTelegramConfig()
    if (!d.ok) {
        console.error('[telegram] Configuration invalide.')
        printDiagnosis(d)
        process.exit(1)
    }

    await notifyTestPing()
    console.log('')
    console.log('OK — message envoyé vers chat ID(s):', d.config.allowedChatIds.join(', '))
    console.log('Ouvre Telegram (app ou web) sur ce(s) chat(s) et vérifie.')
}

main().catch(function (e) {
    console.error(e && e.message ? e.message : e)
    process.exit(1)
})
