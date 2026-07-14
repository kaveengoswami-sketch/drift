import { app, BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import path from 'path'
import fs from 'fs'
import { getDb, getPhoto } from '../database'

// Scan-time backfill generates ONLY small thumbs (cheap, shrink-on-load).
// medium/large are generated on demand when a photo is opened (ensureThumb).
// One worker, one job in flight, with a pacing gap so a big backfill never
// saturates CPU/RAM — the app must stay responsive during first import.
const JOB_GAP_MS = 30

type ThumbSize = 'small' | 'medium' | 'large'

interface Job {
  id: number
  filePath: string
  hash: string
  sizes: ThumbSize[]
}

export function cacheDir(): string {
  return path.join(app.getPath('userData'), 'cache', 'thumbnails')
}

export function ensureCacheDirs(): void {
  for (const s of ['small', 'medium', 'large']) {
    fs.mkdirSync(path.join(cacheDir(), s), { recursive: true })
  }
}

export function thumbPath(size: string, hash: string): string {
  return path.join(cacheDir(), size, `${hash}.webp`)
}

let worker: Worker | null = null
let queue: Job[] = []
let inFlight = false
let lastProgressSent = 0

function getWorker(win: BrowserWindow): Worker {
  if (!worker) {
    worker = new Worker(path.join(__dirname, 'thumbWorker.js'))
    worker.on('message', (res: { id: number; ok: boolean; width?: number; height?: number }) => {
      inFlight = false
      if (res.ok && res.width && res.height) {
        try {
          getDb().prepare('UPDATE photos SET width = ?, height = ? WHERE id = ? AND width = 0').run(res.width, res.height, res.id)
        } catch {
          // non-fatal
        }
      }
      if (!win.isDestroyed()) {
        if (res.ok) win.webContents.send('thumb:done', res.id)
        const now = Date.now()
        if (now - lastProgressSent > 400 || queue.length === 0) {
          lastProgressSent = now
          win.webContents.send('scan:progress', {
            phase: queue.length ? 'thumbnails' : 'done',
            scanned: 0,
            total: queue.length
          })
        }
      }
      setTimeout(() => pump(win), JOB_GAP_MS)
    })
    worker.on('error', (err) => {
      console.error('thumb worker error, restarting:', err)
      inFlight = false
      worker = null
      setTimeout(() => pump(win), 1000)
    })
  }
  return worker
}

function pump(win: BrowserWindow): void {
  if (inFlight) return
  const job = queue.shift()
  if (!job) return
  inFlight = true
  getWorker(win).postMessage({ ...job, cacheDir: cacheDir() })
}

/** Queue small-thumb generation for all images missing one */
export function enqueueThumbnails(win: BrowserWindow): void {
  ensureCacheDirs()
  const rows = getDb()
    .prepare("SELECT id, path, hash FROM photos WHERE type = 'image' AND trashedAt IS NULL")
    .all() as unknown as { id: number; path: string; hash: string }[]
  const queued = new Set(queue.map((j) => j.id))
  for (const r of rows) {
    if (!queued.has(r.id) && !fs.existsSync(thumbPath('small', r.hash))) {
      queue.push({ id: r.id, filePath: r.path, hash: r.hash, sizes: ['small'] })
    }
  }
  pump(win)
}

/** User opened a photo: jump the queue and generate the requested sizes now */
export function ensureThumb(photoId: number, sizes: ThumbSize[], win: BrowserWindow): void {
  const photo = getPhoto(photoId)
  if (!photo || photo.type !== 'image') return
  const missing = sizes.filter((s) => !fs.existsSync(thumbPath(s, photo.hash)))
  if (!missing.length) return
  // drop any queued job for this photo, then cut the line
  queue = queue.filter((j) => j.id !== photoId)
  queue.unshift({ id: photoId, filePath: photo.path, hash: photo.hash, sizes: missing })
  pump(win)
}

export function clearCache(): void {
  queue = []
  fs.rmSync(cacheDir(), { recursive: true, force: true })
  ensureCacheDirs()
}

export function cacheSizeBytes(): number {
  let total = 0
  const walk = (dir: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else {
        try {
          total += fs.statSync(full).size
        } catch {
          // skip
        }
      }
    }
  }
  walk(cacheDir())
  return total
}

export function stopWorker(): void {
  queue = []
  worker?.terminate()
  worker = null
}
