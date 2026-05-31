const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('wgtb', {
    start: (urls, keyboard, count, option, engage, session) =>
        ipcRenderer.invoke('start', urls, keyboard, count, option, engage || {}, session || {}),
    stop: () => ipcRenderer.invoke('stop'),
    proxylist: () => ipcRenderer.invoke('proxylist'),
    openProxyFolder: () => ipcRenderer.invoke('openProxyFolder'),
    toggleDevTools: () => ipcRenderer.invoke('toggleDevTools'),
    copyText: (text) => ipcRenderer.invoke('copyText', text),
    getAppInfo: () => ipcRenderer.invoke('getAppInfo'),
    checkChromeDriver: () => ipcRenderer.invoke('checkChromeDriver'),
    reloadWindow: () => ipcRenderer.invoke('reloadWindow'),
    getPaths: () => ipcRenderer.invoke('getPaths'),
    openUserDataFolder: () => ipcRenderer.invoke('openUserDataFolder'),
    openMailto: (email, subject, body) => ipcRenderer.invoke('openMailto', email, subject, body),
    readClipboardText: () => ipcRenderer.invoke('readClipboardText'),
    openProjectRoot: () => ipcRenderer.invoke('openProjectRoot'),
    openExternalSafe: (url) => ipcRenderer.invoke('openExternalSafe', url),
    getProxyBreakdown: () => ipcRenderer.invoke('getProxyBreakdown'),
    emailList: () => ipcRenderer.invoke('emailList'),
    openEmailFolder: () => ipcRenderer.invoke('openEmailFolder'),
    getEmailBreakdown: () => ipcRenderer.invoke('getEmailBreakdown'),
    commentsCount: () => ipcRenderer.invoke('commentsCount'),
    openCommentsFolder: () => ipcRenderer.invoke('openCommentsFolder'),
    getCommentsBreakdown: () => ipcRenderer.invoke('getCommentsBreakdown')
})