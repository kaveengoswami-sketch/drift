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

/**
 * Helper to parse a positive photo ID from a media:// URL.
 * Standard custom schemes with purely numeric hosts (e.g. media://123/) are canonicalized by
 * Chromium's URL parser into IPv4 dotted-quads (e.g. host "0.0.0.123").
 *
 * This function robustly extracts the photo ID from:
 * 1. IPv4 dotted-quad host form (e.g. "0.0.0.123" -> (0<<24) | (0<<16) | (0<<8) | 123 = 123)
 * 2. Alphanumeric suffixed host form (e.g. "123a" -> 123 via parseInt prefix matching)
 * 3. Plain numeric host form (e.g. "123" -> 123)
 * 4. Pathname segments (e.g. media:///123 or media://m/123 -> 123)
 */
function parsePhotoId(urlStr: string): number | null {
  try {
    const u = new URL(urlStr)
    const hostId = extractIdFromString(u.host)
    if (hostId !== null && hostId > 0) return hostId

    const parts = u.pathname.split('/').filter(Boolean)
    for (const part of parts) {
      const pathId = extractIdFromString(part)
      if (pathId !== null && pathId > 0) return pathId
    }
  } catch {
    return null
  }
  return null
}

function extractIdFromString(str: string): number | null {
  if (!str) return null
  const ipMatch = str.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipMatch) {
    const a = parseInt(ipMatch[1], 10)
    const b = parseInt(ipMatch[2], 10)
    const c = parseInt(ipMatch[3], 10)
    const d = parseInt(ipMatch[4], 10)
    if (a <= 255 && b <= 255 && c <= 255 && d <= 255) {
      const ipVal = ((a << 24) >>> 0) + (b << 16) + (c << 8) + d
      if (Number.isFinite(ipVal) && ipVal > 0) {
        return ipVal
      }
    }
  }

  const parsed = parseInt(str, 10)
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed
  }

  return null
}

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
      // media:// scheme is registered as standard: true.
      // Chromium URL parser canonicalizes pure-numeric hosts as IPv4 dotted-quad addresses
      // (e.g. media://123/ becomes host "0.0.0.123", where parseInt("0.0.0.123") -> 0).
      // Robustly recover the photo ID from:
      // - IPv4 dotted-quad host (0.0.0.123 -> (0<<24)+(0<<16)+(0<<8)+123 = 123)
      // - Suffix form like "123a" (parseInt prefix match)
      // - Plain numeric or pathname segment (e.g. media:///123)
      const id = parsePhotoId(req.url)
      const photo = id && id > 0 ? getPhoto(id) : undefined
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
