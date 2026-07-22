import { app, BrowserWindow, protocol, net, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { pathToFileURL } from 'url'
import { getDb, getPhoto } from './database'
import { registerIpc } from './ipc'
import { scanAllFolders } from './scanner'
import { ensureCacheDirs, thumbPath, stopWorker } from './thumbnails'
import { THUMB_LADDER } from '@shared/types'

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
      // The preload only pulls contextBridge + ipcRenderer, both of which work
      // in a sandboxed preload — so there's no reason to hand the renderer a
      // Node-capable preload process.
      sandbox: true,
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

  // Both handlers are wrapped end-to-end: a throw here rejects the protocol
  // request in a way Chromium's network service handles poorly, and the grid
  // probes for thumbs that legitimately don't exist yet. Always answer with a
  // Response, never an exception.
  // thumb://<px>/<hash>  — URL host is the pixel bucket, pathname is /<hash>
  protocol.handle('thumb', (req) => {
    try {
      const u = new URL(req.url)
      // Bucket and hash both live in the PATH: thumb://t/<px>/<hash>.
      // 'thumb' is registered as a *standard* scheme, so Chromium canonicalises
      // the host — and a purely numeric host like "384" is rewritten as an IPv4
      // address ("0.0.1.128"). Putting the bucket in the host therefore failed
      // validation on every request and rendered a broken image. Node's URL
      // parser does not do this, so it only reproduces in the real app.
      const parts = u.pathname.split('/').filter(Boolean)
      const px = parseInt(parts[0] ?? '', 10)
      const hash = parts[1] ?? ''
      const validPx = (THUMB_LADDER as readonly number[]).includes(px)
      if (!validPx || !/^[a-f0-9]+$/.test(hash)) {
        return new Response('bad request', { status: 400 })
      }
      // thumbPath accepts a number as first arg (converted via String() internally)
      const p = thumbPath(px as (typeof THUMB_LADDER)[number], hash)
      if (fs.existsSync(p)) {
        return net.fetch(pathToFileURL(p).toString()).catch(() => new Response('unreadable', { status: 404 }))
      }
      // Fall back DOWNWARD to the largest bucket already on disk. A slightly
      // soft tile beats a blank one while the exact size is still queued, and
      // the tile upgrades itself when its thumb:done event arrives.
      //
      // Never fall back upward: decoding a 2048px file into a 200px tile is
      // precisely the full-resolution decode this cache exists to avoid.
      for (let i = (THUMB_LADDER as readonly number[]).indexOf(px) - 1; i >= 0; i--) {
        const alt = thumbPath(THUMB_LADDER[i], hash)
        if (fs.existsSync(alt)) {
          return net.fetch(pathToFileURL(alt).toString()).catch(() => new Response('unreadable', { status: 404 }))
        }
      }
      return new Response('not generated yet', { status: 404 })
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })

  protocol.handle('media', (req) => {
    try {
      const u = new URL(req.url)
      const id = parseInt(u.host, 10)
      const photo = Number.isFinite(id) ? getPhoto(id) : undefined
      if (!photo || !fs.existsSync(photo.path)) return new Response('not found', { status: 404 })
      return net
        .fetch(pathToFileURL(photo.path).toString(), {
          headers: req.headers // preserve Range for video seeking
        })
        .catch(() => new Response('unreadable', { status: 404 }))
    } catch {
      return new Response('not found', { status: 404 })
    }
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
