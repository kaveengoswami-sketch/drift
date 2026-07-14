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

function walk(dir: string, out: string[]): void {
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
      walk(full, out)
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase()
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) out.push(full)
    }
  }
}

async function extractDateTaken(filePath: string, ext: string, fallback: number): Promise<{ date: number; width: number; height: number }> {
  // exifr handles JPEG/TIFF/HEIC/PNG and most RAW containers
  try {
    if (!VIDEO_EXTS.has(ext) && ext !== '.svg' && ext !== '.gif' && ext !== '.bmp' && ext !== '.ico') {
      const meta = await exifr.parse(filePath, {
        pick: ['DateTimeOriginal', 'CreateDate', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight', 'Orientation']
      })
      if (meta) {
        const dt: Date | undefined = meta.DateTimeOriginal || meta.CreateDate
        let w = meta.ExifImageWidth || meta.ImageWidth || 0
        let h = meta.ExifImageHeight || meta.ImageHeight || 0
        // orientation 5-8 = rotated 90/270 -> swap
        if (meta.Orientation && meta.Orientation >= 5) [w, h] = [h, w]
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
      walk(folder.path, files)
      const existing = db.getIndexForFolder(folder.id)
      const seen = new Set<string>()
      const toUpsert: db.PhotoUpsert[] = []
      let processed = 0

      win.webContents.send('scan:progress', { phase: 'scanning', scanned: 0, total: files.length })

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
        toUpsert.push({
          path: filePath,
          filename: path.basename(filePath),
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
          win.webContents.send('scan:progress', { phase: 'scanning', scanned: processed, total: files.length, currentFile: path.basename(filePath) })
        }
      }
      if (toUpsert.length) db.upsertPhotos(toUpsert)

      // deletions: indexed but no longer on disk
      const gone = [...existing.keys()].filter((p) => !seen.has(p))
      if (gone.length) db.deletePhotosByPaths(gone)

      win.webContents.send('scan:progress', { phase: 'scanning', scanned: files.length, total: files.length })
    }

    win.webContents.send('scan:progress', { phase: 'done', scanned: 0, total: 0 })
    win.webContents.send('library:changed')

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
  for (const p of db.getExpiredTrash(settings.trashDays)) {
    try {
      fs.rmSync(p.path, { force: true })
    } catch {
      // file already gone
    }
    db.deletePhotoRow(p.id)
  }
}

export { RAW_EXTS }
