// Thumbnail queue manager for the Drift main process.
//
// Architecture:
//   - Two bands: VIEWPORT (highest priority) and BACKFILL.
//   - Viewport jobs run back-to-back with no pacing gap.
//   - Backfill jobs observe a 30 ms gap so a scan-time sweep never saturates
//     CPU/RAM while the user is actively browsing.
//   - clamp(cpus - 2, 1, 3) worker threads, each with sharp.cache(false) and
//     concurrency(1).
//   - A monotonically increasing generation counter.  When the viewport
//     changes, bump generation; queued (not in-flight) jobs from old
//     generations are discarded at the next drain.
//   - Cache layout: <userData>/cache/thumbnails/<px>/<hash>.webp
//   - Protocol: thumb://<px>/<hash>
//   - NEVER add a global timer/interval that retries or re-requests thumbnails.
//     Per-photo-id events only.
import { app, BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { getDb, getPhoto } from '../database'
import { THUMB_LADDER, type ThumbPx } from '@shared/types'
import type { ThumbJob } from './thumbWorker'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const JOB_GAP_MS = 30        // only applied between backfill jobs
const WORKER_RESTART_DELAY = 1000

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

const NUM_WORKERS = clamp(os.cpus().length - 2, 1, 3)

// ---------------------------------------------------------------------------
// Cache directory helpers
// ---------------------------------------------------------------------------

export function cacheDir(): string {
  return path.join(app.getPath('userData'), 'cache', 'thumbnails')
}

export function ensureCacheDirs(): void {
  for (const px of THUMB_LADDER) {
    fs.mkdirSync(path.join(cacheDir(), String(px)), { recursive: true })
  }
}

export function thumbPath(px: ThumbPx | string, hash: string): string {
  return path.join(cacheDir(), String(px), `${hash}.webp`)
}

export function clearCache(): void {
  viewportQueue = []
  backfillQueue = []
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
        try { total += fs.statSync(full).size } catch { /* skip */ }
      }
    }
  }
  walk(cacheDir())
  return total
}

// ---------------------------------------------------------------------------
// Queue state
// ---------------------------------------------------------------------------

interface QueuedJob {
  id: number
  filePath: string
  hash: string
  px: ThumbPx
  mode: 'shrink' | 'preview'
  generation: number
}

let viewportQueue: QueuedJob[] = []
let backfillQueue: QueuedJob[] = []

/** Set of photo IDs currently being processed by a worker. */
const inFlight = new Set<number>()

let generation = 0
let lastProgressSent = 0

// ---------------------------------------------------------------------------
// Worker pool
// ---------------------------------------------------------------------------

interface PoolWorker {
  worker: Worker
  busy: boolean
}

const pool: PoolWorker[] = []
let poolWin: BrowserWindow | null = null

function buildWorker(win: BrowserWindow): Worker {
  const w = new Worker(path.join(__dirname, 'thumbWorker.js'))
  w.on(
    'message',
    (res: { id: number; ok: boolean; mode: 'shrink' | 'preview'; width?: number; height?: number }) => {
      // Mark the slot free before doing anything else so a drain can fill it.
      const slot = pool.find((s) => s.worker === w)
      if (slot) slot.busy = false
      inFlight.delete(res.id)

      if (res.ok && res.width && res.height && res.mode === 'shrink') {
        try {
          // No `AND width = 0` guard: the worker measures the original with sharp and
          // applies EXIF orientation, so its numbers are authoritative and this
          // self-heals rows the EXIF path got wrong. The worker only reports dims when
          // it decoded the real file, never for the embedded-preview fallback.
          getDb()
            .prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?')
            .run(res.width, res.height, res.id)
        } catch { /* non-fatal */ }
      }

      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        try {
          if (res.ok) win.webContents.send('thumb:done', res.id)
          const now = Date.now()
          const total = viewportQueue.length + backfillQueue.length
          if (now - lastProgressSent > 400 || total === 0) {
            lastProgressSent = now
            win.webContents.send('scan:progress', {
              phase: total ? 'thumbnails' : 'done',
              scanned: 0,
              total
            })
          }
        } catch { /* frame went away mid-send */ }
      }

      // Viewport: drain immediately; backfill: honour the pacing gap.
      drainViewport(win)
      if (viewportQueue.length === 0) {
        setTimeout(() => drainBackfill(win), JOB_GAP_MS)
      }
    }
  )
  w.on('error', (err) => {
    console.error('thumb worker error, restarting:', err)
    const slot = pool.find((s) => s.worker === w)
    if (slot) {
      slot.busy = false
      // Replace the crashed worker after a short delay.
      setTimeout(() => {
        const idx = pool.indexOf(slot)
        if (idx !== -1) {
          pool[idx] = { worker: buildWorker(win), busy: false }
          if (!win.isDestroyed()) drainAll(win)
        }
      }, WORKER_RESTART_DELAY)
    }
  })
  return w
}

function ensurePool(win: BrowserWindow): void {
  poolWin = win
  while (pool.length < NUM_WORKERS) {
    pool.push({ worker: buildWorker(win), busy: false })
  }
}

function freeSlot(): PoolWorker | undefined {
  return pool.find((s) => !s.busy)
}

function dispatchJob(job: QueuedJob, slot: PoolWorker): void {
  slot.busy = true
  inFlight.add(job.id)
  const msg: ThumbJob = {
    id: job.id,
    filePath: job.filePath,
    hash: job.hash,
    px: job.px,
    cacheDir: cacheDir(),
    mode: job.mode,
    generation: job.generation
  }
  slot.worker.postMessage(msg)
}

// ---------------------------------------------------------------------------
// Drain functions
// ---------------------------------------------------------------------------

function drainViewport(win: BrowserWindow): void {
  ensurePool(win)
  let slot: PoolWorker | undefined
  while ((slot = freeSlot()) && viewportQueue.length > 0) {
    // Discard stale generations before picking the next job.
    while (viewportQueue.length > 0 && viewportQueue[0].generation < generation) {
      viewportQueue.shift()
    }
    const job = viewportQueue.shift()
    if (!job) break
    if (inFlight.has(job.id)) continue  // already being processed
    dispatchJob(job, slot)
  }
}

function drainBackfill(win: BrowserWindow): void {
  ensurePool(win)
  // Only run backfill when there are no viewport jobs waiting.
  if (viewportQueue.length > 0) return
  const slot = freeSlot()
  if (!slot || backfillQueue.length === 0) return
  // NOTE: deliberately no generation check here. `generation` tracks which
  // viewport report a job belongs to, and it is bumped on every scroll — so
  // applying it to backfill would discard the entire backfill queue the first
  // time the user scrolls. Backfill entries never go stale; they are only
  // dropped once their file exists or the cache is cleared.
  const job = backfillQueue.shift()
  if (!job) return
  if (inFlight.has(job.id)) {
    // Skip silently; schedule another attempt after the gap.
    setTimeout(() => drainBackfill(win), JOB_GAP_MS)
    return
  }
  dispatchJob(job, slot)
}

function drainAll(win: BrowserWindow): void {
  drainViewport(win)
  if (viewportQueue.length === 0) drainBackfill(win)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Viewport-priority request from the renderer.
 * `ids` are photo IDs ordered nearest-to-viewport-centre first.
 * Bumps the generation counter so queued (not in-flight) jobs from the
 * previous generation are skipped.
 */
export function setViewport(win: BrowserWindow, ids: number[], px: ThumbPx): void {
  // Bump generation: old viewport jobs that haven't started yet are now stale.
  generation++

  // Rebuild the viewport queue in the order the renderer specified.
  // In-flight jobs are left alone (they will post a result; we just ignore
  // results for IDs that are no longer interesting — the renderer deduplicates).
  viewportQueue = []
  if (!ids.length) return

  // ONE batched lookup instead of a getPhoto() per id. The renderer reports its
  // full visible set on every frame the set changes, and node:sqlite is
  // synchronous *on the main thread* — running N separate statements here would
  // stall the UI during exactly the fast scroll this queue exists to serve.
  const rows = getDb()
    .prepare(`SELECT id, path, hash, type FROM photos WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as unknown as { id: number; path: string; hash: string; type: string }[]
  const byId = new Map(rows.map((r) => [r.id, r]))

  for (const id of ids) {
    if (inFlight.has(id)) continue
    const photo = byId.get(id)
    if (!photo || photo.type !== 'image') continue
    const dest = thumbPath(px, photo.hash)
    if (fs.existsSync(dest)) continue  // already cached
    viewportQueue.push({ id, filePath: photo.path, hash: photo.hash, px, mode: 'shrink', generation })
  }

  drainViewport(win)
}

/**
 * Queue small-thumb backfill for all images that are missing a thumbnail at
 * the default ladder rung (256 px).  Demoted to BACKFILL band so it never
 * preempts viewport requests.
 */
export function enqueueThumbnails(win: BrowserWindow): void {
  ensureCacheDirs()
  const DEFAULT_PX: ThumbPx = 256
  const rows = getDb()
    .prepare("SELECT id, path, hash FROM photos WHERE type = 'image' AND trashedAt IS NULL")
    .all() as unknown as { id: number; path: string; hash: string }[]

  // One directory listing instead of per-row existsSync syscall.
  let cached: Set<string>
  try {
    cached = new Set(fs.readdirSync(path.join(cacheDir(), String(DEFAULT_PX))))
  } catch {
    cached = new Set()
  }

  const queuedIds = new Set([...backfillQueue.map((j) => j.id), ...viewportQueue.map((j) => j.id)])

  for (const r of rows) {
    if (!queuedIds.has(r.id) && !inFlight.has(r.id) && !cached.has(`${r.hash}.webp`)) {
      backfillQueue.push({ id: r.id, filePath: r.path, hash: r.hash, px: DEFAULT_PX, mode: 'shrink', generation })
    }
  }

  drainAll(win)
}

/**
 * A photo was opened: ensure the requested pixel bucket exists immediately.
 * Jumps the queue by promoting to VIEWPORT band at current generation.
 */
export function ensureThumb(photoId: number, sizes: string[], win: BrowserWindow): void {
  const photo = getPhoto(photoId)
  if (!photo || photo.type !== 'image') return

  // Map old 'small'/'medium'/'large' strings to the closest bucket for
  // backward compatibility with any callers that still use the old API.
  const legacyMap: Record<string, ThumbPx> = { small: 256, medium: 512, large: 1024 }

  for (const s of sizes) {
    const px: ThumbPx = (THUMB_LADDER as readonly number[]).includes(Number(s))
      ? (Number(s) as ThumbPx)
      : (legacyMap[s] ?? 256)
    if (fs.existsSync(thumbPath(px, photo.hash))) continue
    // Remove any existing queued entry for this photo+px then push to front.
    viewportQueue = viewportQueue.filter((j) => !(j.id === photoId && j.px === px))
    viewportQueue.unshift({ id: photoId, filePath: photo.path, hash: photo.hash, px, mode: 'shrink', generation: Number.MAX_SAFE_INTEGER })
  }
  drainViewport(win)
}

export function stopWorker(): void {
  viewportQueue = []
  backfillQueue = []
  for (const slot of pool) {
    try { slot.worker.terminate() } catch { /* ignore */ }
  }
  pool.length = 0
  inFlight.clear()
  poolWin = null
}
