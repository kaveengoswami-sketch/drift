import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import exifr from 'exifr'
import type { BrowserWindow } from 'electron'
import { IMAGE_EXTS, VIDEO_EXTS, RAW_EXTS } from '@shared/types'
import * as db from '../database'
import { enqueueThumbnails } from '../thumbnails'

let scanning = false

/**
 * Cheap content signature: size + mtime + first 64KB hash. Full-file hashing of a
 * 50K library would take too long on first scan.
 */
function quickHash(filePath: string, size: number, mtimeMs: number): string {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(Math.min(65536, size))
    fs.readSync(fd, buf, 0, buf.length, 0)
    fs.closeSync(fd)
    return crypto.createHash('sha1').update(buf).update(`${size}:${mtimeMs}`).digest('hex')
  } catch {
    return crypto.createHash('sha1').update(`${filePath}:${size}:${mtimeMs}`).digest('hex')
  }
}

/**
 * A scan can outlive the window that started it, and webContents.send() throws
 * on a destroyed window — which would surface as an unhandled rejection out of
 * the async scan loop. Every progress message goes through here.
 */
function send(win: BrowserWindow, channel: string, payload?: unknown): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  try {
    win.webContents.send(channel, payload)
  } catch {
    // window or render frame went away between the check and the send
  }
}

/**
 * Walks the tree yielding to the event loop periodically. The traversal itself
 * is sync (readdirSync is markedly faster than the promise API here), but on a
 * deep library the uninterrupted version stalled the UI for seconds.
 *
 * Note Dirent.isDirectory()/isFile() are both false for symlinks, so symlinked
 * entries are skipped — that also makes symlink loops impossible.
 */
async function walk(dir: string, out: string[], counter = { n: 0 }): Promise<void> {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '.drift-trash') continue
      await walk(full, out, counter)
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase()
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) out.push(full)
    }
    if (++counter.n % 500 === 0) await new Promise((r) => setImmediate(r))
  }
}

async function extractDateTaken(filePath: string, ext: string, fallback: number): Promise<{ date: number; width: number; height: number }> {
  // exifr handles JPEG/TIFF/HEIC/PNG and most RAW containers
  try {
    if (!VIDEO_EXTS.has(ext) && ext !== '.svg' && ext !== '.gif' && ext !== '.bmp' && ext !== '.ico') {
      const meta = await exifr.parse(filePath, {
        // translateValues: false is load-bearing. By default exifr maps Orientation
        // to a human string ('Rotate 270 CW'), so the numeric >= 5 test below silently
        // never fired and every rotated photo was stored with width/height transposed.
        // Dates are revived by reviveValues, which this does not affect.
        translateValues: false,
        pick: ['DateTimeOriginal', 'CreateDate', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight', 'Orientation']
      })
      if (meta) {
        const dt: Date | undefined = meta.DateTimeOriginal || meta.CreateDate
        let w = meta.ExifImageWidth || meta.ImageWidth || 0
        let h = meta.ExifImageHeight || meta.ImageHeight || 0
        // orientation 5-8 = rotated 90/270 -> swap, so stored dims are post-rotation
        if (typeof meta.Orientation === 'number' && meta.Orientation >= 5) [w, h] = [h, w]
        return { date: dt instanceof Date && !isNaN(dt.getTime()) ? dt.getTime() : fallback, width: w, height: h }
      }
    }
  } catch {
    // fall through to file dates
  }
  return { date: fallback, width: 0, height: 0 }
}

export interface SubfolderInfo {
  folderId: number
  path: string
  name: string
  depth: number
}

/** List direct subfolders (recursively, for sidebar nesting) that contain media */
export function discoverSubfolders(): SubfolderInfo[] {
  const result: SubfolderInfo[] = []
  for (const folder of db.listFolders()) {
    const seen = new Set<string>()
    const walkDirs = (dir: string, depth: number): void => {
      if (depth > 3) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const e of entries) {
        if (!e.isDirectory() || e.name.startsWith('.') || e.name === '.drift-trash') continue
        const full = path.join(dir, e.name)
        if (!seen.has(full)) {
          seen.add(full)
          result.push({ folderId: folder.id, path: full, name: e.name, depth })
          walkDirs(full, depth + 1)
        }
      }
    }
    walkDirs(folder.path, 1)
  }
  return result
}

export async function scanAllFolders(win: BrowserWindow): Promise<void> {
  if (scanning) return
  scanning = true
  try {
    const folders = db.listFolders()
    for (const folder of folders) {
      const files: string[] = []
      await walk(folder.path, files)
      const existing = db.getIndexForFolder(folder.id)
      const seen = new Set<string>()
      const toUpsert: db.PhotoUpsert[] = []
      let processed = 0

      send(win, 'scan:progress', { phase: 'scanning', scanned: 0, total: files.length })

      for (const filePath of files) {
        seen.add(filePath)
        processed++
        let stat: fs.Stats
        try {
          stat = fs.statSync(filePath)
        } catch {
          continue
        }
        const prev = existing.get(filePath)
        if (prev && prev.dateModified === Math.floor(stat.mtimeMs) && prev.size === stat.size) {
          continue // unchanged
        }
        const ext = path.extname(filePath).toLowerCase()
        const isVideo = VIDEO_EXTS.has(ext)
        const { date, width, height } = await extractDateTaken(filePath, ext, Math.floor(stat.birthtimeMs || stat.mtimeMs))
        let relPath = path.basename(filePath)
        if (filePath.startsWith(folder.path)) {
          relPath = filePath.slice(folder.path.length).replace(/^[/\\]+/, '')
        }
        toUpsert.push({
          path: filePath,
          filename: path.basename(filePath),
          relPath,
          folderId: folder.id,
          size: stat.size,
          width,
          height,
          type: isVideo ? 'video' : 'image',
          dateTaken: date,
          dateModified: Math.floor(stat.mtimeMs),
          duration: null,
          hash: quickHash(filePath, stat.size, stat.mtimeMs)
        })
        if (toUpsert.length >= 200) {
          db.upsertPhotos(toUpsert.splice(0))
          send(win, 'scan:progress', { phase: 'scanning', scanned: processed, total: files.length, currentFile: path.basename(filePath) })
        }
      }
      if (toUpsert.length) db.upsertPhotos(toUpsert)

      // deletions: indexed but no longer on disk
      const gone = [...existing.keys()].filter((p) => !seen.has(p))
      if (gone.length) db.deletePhotosByPaths(gone)

      send(win, 'scan:progress', { phase: 'scanning', scanned: files.length, total: files.length })
    }

    send(win, 'scan:progress', { phase: 'done', scanned: 0, total: 0 })
    send(win, 'library:changed')

    // queue thumbnail generation for anything missing thumbs
    enqueueThumbnails(win)

    // purge expired trash
    purgeExpiredTrash()
  } finally {
    scanning = false
  }
}

function purgeExpiredTrash(): void {
  const settings = db.getSettings()
  if (!settings.trashDays || settings.trashDays <= 0) return
  // Drop the files first, then retire all their rows in one transaction — a
  // row-at-a-time purge interrupted partway leaves rows pointing at files that
  // no longer exist, and trashed rows are skipped by the scan's reconciliation
  // pass so they'd never be cleaned up.
  const purged: number[] = []
  for (const p of db.getExpiredTrash(settings.trashDays)) {
    try {
      fs.rmSync(p.path, { force: true })
      purged.push(p.id)
    } catch {
      // still locked — leave the row and retry on the next scan
    }
  }
  db.deletePhotoRows(purged)
}

export { RAW_EXTS }
