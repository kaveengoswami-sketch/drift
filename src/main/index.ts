import { app, BrowserWindow, protocol, net, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getDb, getPhoto } from './database'
import { registerIpc } from './ipc'
import { scanAllFolders } from './scanner'
import { ensureCacheDirs, thumbPath, stopWorker } from './thumbnails'

// thumb://small/<hash> -> cached webp; media://<photoId> -> original file
protocol.registerSchemesAsPrivileged([
  { scheme: 'thumb', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#101014',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  registerIpc(mainWindow)

  // scan after the UI is up so startup stays fast
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(() => {
      if (mainWindow) scanAllFolders(mainWindow)
    }, 400)
  })
}

app.whenReady().then(() => {
  getDb()
  ensureCacheDirs()

  protocol.handle('thumb', (req) => {
    // thumb://small/<hash> — URL host is the size, pathname is /<hash>
    const u = new URL(req.url)
    const size = u.host
    const hash = u.pathname.replace(/^\//, '')
    if (!/^[a-f0-9]+$/.test(hash) || !['small', 'medium', 'large'].includes(size)) {
      return new Response('bad request', { status: 400 })
    }
    const p = thumbPath(size, hash)
    if (!fs.existsSync(p)) return new Response('not generated yet', { status: 404 })
    return net.fetch(pathToFileURL(p).toString())
  })

  protocol.handle('media', (req) => {
    const u = new URL(req.url)
    const id = parseInt(u.host, 10)
    const photo = Number.isFinite(id) ? getPhoto(id) : undefined
    if (!photo || !fs.existsSync(photo.path)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(photo.path).toString(), {
      headers: req.headers // preserve Range for video seeking
    })
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopWorker()
  app.quit()
})
