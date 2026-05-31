const fs = require('fs')
const path = require('path')
const seobot = require('./libs/index')
const proxys = require('./libs/proxy')
const loadEmails = require('./libs/email')
const loadComments = require('./libs/comments')
const { app, BrowserWindow, ipcMain, shell, clipboard, Menu, dialog } = require('electron')

/** Peut réduire les erreurs cache GPU / disk sur certains Windows (Access denied). */
try {
    app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')
} catch (e) {}

function isValidEmailAddress(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim())
}

const pkg = require('./package.json')
const { startTelegramBot, stopTelegramBot } = require('./libs/telegram')

const APP_TITLE = pkg.productName || 'WGTB'
const ICON_PATH = path.join(__dirname, 'assets', 'wgtb-icon.png')

function buildAppMenu() {
    const template = [
        {
            label: 'File',
            submenu: [
                { role: 'quit', label: 'Quit' }
            ]
        },
        {
            label: 'View',
            submenu: [
                { role: 'reload', label: 'Reload' },
                { role: 'forceReload', label: 'Force reload' },
                { role: 'toggledevtools', label: 'Developer tools' },
                { type: 'separator' },
                { role: 'resetZoom', label: 'Actual size' },
                { role: 'zoomIn', label: 'Zoom in' },
                { role: 'zoomOut', label: 'Zoom out' }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About ' + APP_TITLE,
                    click: async () => {
                        await dialog.showMessageBox({
                            type: 'info',
                            title: APP_TITLE,
                            message: APP_TITLE + ' — Web Growth Traffic Bot',
                            detail:
                                'Version ' +
                                pkg.version +
                                '\nElectron ' +
                                process.versions.electron +
                                (pkg.developer && pkg.developer.name
                                    ? '\n\nDeveloper — Telegram @' + pkg.developer.name
                                    : '') +
                                '\n\nTraffic simulation lab — educational use only.'
                        })
                    }
                }
            ]
        }
    ]
    if (process.platform === 'darwin') {
        template.unshift({
            label: app.name,
            submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }]
        })
    }
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function createWindow() {
    const win = new BrowserWindow({
        width: 440,
        height: 920,
        minWidth: 380,
        minHeight: 520,
        show: false,
        title: APP_TITLE,
        autoHideMenuBar: false,
        icon: fs.existsSync(ICON_PATH) ? ICON_PATH : undefined,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    })
    win.once('ready-to-show', () => win.show())
    win.loadFile('index.html')
}

ipcMain.handle('start', async (event, urls, keyboard, count, option, engage, session) => {
    try {
        await seobot.main(urls, keyboard, count, option, engage || {}, session || {}, { notifyDesktop: true })
    } catch (err) {
        console.error('[start]', err && err.message ? err.message : err)
    }
})

ipcMain.handle('stop', async (event) => {
    seobot.stop()
})

ipcMain.handle('proxylist', async (event) => {
    var proxylist = await proxys()
    return proxylist.length
})

ipcMain.handle('emailList', async () => {
    const list = await loadEmails()
    return list
})

ipcMain.handle('commentsCount', async () => {
    const list = await loadComments()
    return list.length
})

ipcMain.handle('openCommentsFolder', async () => {
    const folderPath = path.join(__dirname, 'comments')
    await fs.promises.mkdir(folderPath, { recursive: true })
    const err = await shell.openPath(folderPath)
    return err || null
})

ipcMain.handle('getCommentsBreakdown', async () => {
    const dir = path.join(__dirname, 'comments')
    await fs.promises.mkdir(dir, { recursive: true })
    let total = 0
    const files = []
    try {
        const names = await fs.promises.readdir(dir)
        for (const name of names) {
            const fp = path.join(dir, name)
            const st = await fs.promises.stat(fp).catch(() => null)
            if (!st || !st.isFile()) continue
            const data = await fs.promises.readFile(fp, 'utf8')
            const lines = data
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean).length
            files.push({ name, lines })
            total += lines
        }
    } catch (e) {
        return { ok: false, error: e.message || String(e), total: 0, files: [] }
    }
    return { ok: true, total, files }
})

ipcMain.handle('openEmailFolder', async () => {
    const folderPath = path.join(__dirname, 'email')
    await fs.promises.mkdir(folderPath, { recursive: true })
    const err = await shell.openPath(folderPath)
    return err || null
})

ipcMain.handle('openProxyFolder', async () => {
    const folderPath = path.join(__dirname, 'proxy')
    await fs.promises.mkdir(folderPath, { recursive: true })
    const err = await shell.openPath(folderPath)
    return err || null
})

ipcMain.handle('toggleDevTools', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.webContents.toggleDevTools()
})

ipcMain.handle('copyText', (event, text) => {
    clipboard.writeText(String(text || ''))
})

ipcMain.handle('getAppInfo', () => ({
    name: pkg.productName || pkg.name,
    version: pkg.version,
    description: pkg.description ? String(pkg.description) : '',
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome || '',
    platform: process.platform,
    arch: process.arch,
    developerHandle: pkg.developer && pkg.developer.name ? String(pkg.developer.name) : '',
    developerTelegram: pkg.developer && pkg.developer.telegram ? String(pkg.developer.telegram) : ''
}))

ipcMain.handle('checkChromeDriver', async () => {
    try {
        const chromedriver = require('chromedriver')
        const driverPath = chromedriver.path
        await fs.promises.access(driverPath, fs.constants.F_OK)
        return { ok: true, path: driverPath }
    } catch (e) {
        return { ok: false, error: e.message || String(e) }
    }
})

ipcMain.handle('reloadWindow', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) win.reload()
})

ipcMain.handle('getPaths', () => ({
    userData: app.getPath('userData'),
    appPath: app.getAppPath()
}))

ipcMain.handle('openUserDataFolder', async () => {
    const folderPath = app.getPath('userData')
    await fs.promises.mkdir(folderPath, { recursive: true })
    const err = await shell.openPath(folderPath)
    return err || null
})

ipcMain.handle('openMailto', async (event, email, subject, body) => {
    const addr = String(email || '').trim()
    if (!isValidEmailAddress(addr)) return { ok: false, error: 'Invalid email address' }
    const parts = []
    if (subject) parts.push('subject=' + encodeURIComponent(String(subject)))
    if (body) parts.push('body=' + encodeURIComponent(String(body)))
    const href = 'mailto:' + addr + (parts.length ? '?' + parts.join('&') : '')
    await shell.openExternal(href)
    return { ok: true }
})

ipcMain.handle('readClipboardText', () => clipboard.readText())

ipcMain.handle('openProjectRoot', async () => {
    const err = await shell.openPath(__dirname)
    return err || null
})

ipcMain.handle('openExternalSafe', async (event, url) => {
    try {
        const u = new URL(String(url || '').trim())
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'Only http(s) URLs' }
        await shell.openExternal(u.href)
        return { ok: true }
    } catch (e) {
        return { ok: false, error: e.message || String(e) }
    }
})

ipcMain.handle('getProxyBreakdown', async () => {
    const dir = path.join(__dirname, 'proxy')
    await fs.promises.mkdir(dir, { recursive: true })
    let total = 0
    const files = []
    try {
        const names = await fs.promises.readdir(dir)
        for (const name of names) {
            const fp = path.join(dir, name)
            const st = await fs.promises.stat(fp).catch(() => null)
            if (!st || !st.isFile()) continue
            const data = await fs.promises.readFile(fp, 'utf8')
            const lines = data
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter(Boolean).length
            files.push({ name, lines })
            total += lines
        }
    } catch (e) {
        return { ok: false, error: e.message || String(e), total: 0, files: [] }
    }
    return { ok: true, total, files }
})

ipcMain.handle('getEmailBreakdown', async () => {
    const dir = path.join(__dirname, 'email')
    await fs.promises.mkdir(dir, { recursive: true })
    let total = 0
    const files = []
    const isEmail = loadEmails.isEmailLine
    try {
        const names = await fs.promises.readdir(dir)
        for (const name of names) {
            const fp = path.join(dir, name)
            const st = await fs.promises.stat(fp).catch(() => null)
            if (!st || !st.isFile()) continue
            const data = await fs.promises.readFile(fp, 'utf8')
            const lines = data
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l && isEmail(l)).length
            files.push({ name, lines })
            total += lines
        }
    } catch (e) {
        return { ok: false, error: e.message || String(e), total: 0, files: [] }
    }
    return { ok: true, total, files }
})

app.whenReady().then(() => {
    app.setName(APP_TITLE)
    buildAppMenu()
    createWindow()
    startTelegramBot()
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow()
        }
    })
})

app.on('before-quit', () => {
    stopTelegramBot()
})

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
})