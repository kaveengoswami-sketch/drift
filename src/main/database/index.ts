import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { Photo, SourceFolder, Album, Settings } from '@shared/types'
import { DEFAULT_SETTINGS } from '@shared/types'

let db: DatabaseSync

export function getDb(): DatabaseSync {
  if (!db) {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    db = new DatabaseSync(path.join(dir, 'drift.db'))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    migrate(db)
  }
  return db
}

/** Run fn inside a transaction (node:sqlite has no .transaction helper) */
function tx(fn: () => void): void {
  const d = getDb()
  d.exec('BEGIN')
  try {
    fn()
    d.exec('COMMIT')
  } catch (e) {
    d.exec('ROLLBACK')
    throw e
  }
}

function migrate(d: DatabaseSync): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      folderId INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      size INTEGER NOT NULL,
      width INTEGER NOT NULL DEFAULT 0,
      height INTEGER NOT NULL DEFAULT 0,
      type TEXT NOT NULL,
      dateTaken INTEGER NOT NULL,
      dateModified INTEGER NOT NULL,
      favorite INTEGER NOT NULL DEFAULT 0,
      trashedAt INTEGER,
      trashOriginalPath TEXT,
      duration REAL,
      hash TEXT NOT NULL,
      lastViewedAt INTEGER,
      addedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_photos_dateTaken ON photos(dateTaken DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_folder ON photos(folderId);
    CREATE INDEX IF NOT EXISTS idx_photos_trashed ON photos(trashedAt);
    CREATE INDEX IF NOT EXISTS idx_photos_addedAt ON photos(addedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_lastViewedAt ON photos(lastViewedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_photos_path ON photos(path);
    CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      coverPhotoId INTEGER,
      createdAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS album_photos (
      albumId INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      photoId INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (albumId, photoId)
    );
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS photo_tags (
      photoId INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (photoId, tagId)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

// ---------- settings ----------

export function getSettings(): Settings {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[]
  const s: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    // one corrupt row shouldn't take down every setting
    try {
      s[r.key] = JSON.parse(r.value)
    } catch {
      // keep the default for this key
    }
  }
  return s as unknown as Settings
}

export function setSetting(key: string, value: unknown): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value))
}

// ---------- folders ----------

export function listFolders(): SourceFolder[] {
  return getDb().prepare('SELECT * FROM folders ORDER BY name').all() as unknown as SourceFolder[]
}

export function addFolder(folderPath: string): SourceFolder {
  const name = path.basename(folderPath) || folderPath
  getDb().prepare('INSERT OR IGNORE INTO folders (path, name) VALUES (?, ?)').run(folderPath, name)
  return getDb().prepare('SELECT * FROM folders WHERE path = ?').get(folderPath) as unknown as SourceFolder
}

export function removeFolder(id: number): void {
  getDb().prepare('DELETE FROM folders WHERE id = ?').run(id)
}

// ---------- photos ----------

export interface PhotoUpsert {
  path: string
  filename: string
  folderId: number
  size: number
  width: number
  height: number
  type: string
  dateTaken: number
  dateModified: number
  duration: number | null
  hash: string
}

export function upsertPhotos(photos: PhotoUpsert[]): void {
  const stmt = getDb().prepare(`
    INSERT INTO photos (path, filename, folderId, size, width, height, type, dateTaken, dateModified, duration, hash, addedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      size = excluded.size, width = excluded.width, height = excluded.height,
      dateTaken = excluded.dateTaken, dateModified = excluded.dateModified,
      duration = excluded.duration, hash = excluded.hash
  `)
  const now = Date.now()
  tx(() => {
    for (const r of photos) {
      stmt.run(r.path, r.filename, r.folderId, r.size, r.width, r.height, r.type, r.dateTaken, r.dateModified, r.duration, r.hash, now)
    }
  })
}

/** Returns path -> {dateModified, size} for change detection during scan */
export function getIndexForFolder(folderId: number): Map<string, { dateModified: number; size: number }> {
  const rows = getDb()
    .prepare('SELECT path, dateModified, size FROM photos WHERE folderId = ? AND trashedAt IS NULL')
    .all(folderId) as unknown as { path: string; dateModified: number; size: number }[]
  return new Map(rows.map((r) => [r.path, { dateModified: r.dateModified, size: r.size }]))
}

export function deletePhotosByPaths(paths: string[]): void {
  const stmt = getDb().prepare('DELETE FROM photos WHERE path = ?')
  tx(() => {
    for (const p of paths) stmt.run(p)
  })
}

export function getPhoto(id: number): Photo | undefined {
  return getDb().prepare('SELECT * FROM photos WHERE id = ?').get(id) as unknown as Photo | undefined
}

export function queryPhotos(q: {
  view: string
  albumId?: number
  folderId?: number
  folderPathPrefix?: string
  tag?: string
  search?: string
}): Photo[] {
  const d = getDb()
  const trimmedSearch = q.search ? q.search.trim() : ''
  const searchPattern = trimmedSearch ? '%' + trimmedSearch.replace(/([%_\\])/g, '\\$1') + '%' : null

  switch (q.view) {
    case 'favorites':
      if (searchPattern) {
        return d
          .prepare("SELECT * FROM photos WHERE favorite = 1 AND trashedAt IS NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY dateTaken DESC")
          .all(searchPattern, searchPattern) as unknown as Photo[]
      }
      return d.prepare('SELECT * FROM photos WHERE favorite = 1 AND trashedAt IS NULL ORDER BY dateTaken DESC').all() as unknown as Photo[]

    case 'recent-added':
      if (searchPattern) {
        return d
          .prepare("SELECT * FROM photos WHERE trashedAt IS NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY addedAt DESC, dateTaken DESC LIMIT 2000")
          .all(searchPattern, searchPattern) as unknown as Photo[]
      }
      return d.prepare('SELECT * FROM photos WHERE trashedAt IS NULL ORDER BY addedAt DESC, dateTaken DESC LIMIT 2000').all() as unknown as Photo[]

    case 'recent-viewed':
      if (searchPattern) {
        return d
          .prepare("SELECT * FROM photos WHERE lastViewedAt IS NOT NULL AND trashedAt IS NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY lastViewedAt DESC LIMIT 500")
          .all(searchPattern, searchPattern) as unknown as Photo[]
      }
      return d.prepare('SELECT * FROM photos WHERE lastViewedAt IS NOT NULL AND trashedAt IS NULL ORDER BY lastViewedAt DESC LIMIT 500').all() as unknown as Photo[]

    case 'videos':
      if (searchPattern) {
        return d
          .prepare("SELECT * FROM photos WHERE type = 'video' AND trashedAt IS NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY dateTaken DESC")
          .all(searchPattern, searchPattern) as unknown as Photo[]
      }
      return d.prepare("SELECT * FROM photos WHERE type = 'video' AND trashedAt IS NULL ORDER BY dateTaken DESC").all() as unknown as Photo[]

    case 'trash':
      if (searchPattern) {
        return d
          .prepare("SELECT * FROM photos WHERE trashedAt IS NOT NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY trashedAt DESC")
          .all(searchPattern, searchPattern) as unknown as Photo[]
      }
      return d.prepare('SELECT * FROM photos WHERE trashedAt IS NOT NULL ORDER BY trashedAt DESC').all() as unknown as Photo[]

    case 'album':
      if (searchPattern) {
        return d
          .prepare(
            `SELECT p.* FROM photos p JOIN album_photos ap ON ap.photoId = p.id
             WHERE ap.albumId = ? AND p.trashedAt IS NULL AND (p.filename LIKE ? ESCAPE '\\' OR p.path LIKE ? ESCAPE '\\') ORDER BY ap.sortOrder, p.dateTaken DESC`
          )
          .all(q.albumId!, searchPattern, searchPattern) as unknown as Photo[]
      }
      return d
        .prepare(
          `SELECT p.* FROM photos p JOIN album_photos ap ON ap.photoId = p.id
           WHERE ap.albumId = ? AND p.trashedAt IS NULL ORDER BY ap.sortOrder, p.dateTaken DESC`
        )
        .all(q.albumId!) as unknown as Photo[]

    case 'folder':
      if (q.folderPathPrefix) {
        const prefix = q.folderPathPrefix.replace(/([%_\\])/g, '\\$1') + '%'
        if (searchPattern) {
          return d
            .prepare("SELECT * FROM photos WHERE path LIKE ? ESCAPE '\\' AND trashedAt IS NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY dateTaken DESC")
            .all(prefix, searchPattern, searchPattern) as unknown as Photo[]
        }
        return d
          .prepare("SELECT * FROM photos WHERE path LIKE ? ESCAPE '\\' AND trashedAt IS NULL ORDER BY dateTaken DESC")
          .all(prefix) as unknown as Photo[]
      }
      if (searchPattern) {
        return d
          .prepare("SELECT * FROM photos WHERE folderId = ? AND trashedAt IS NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY dateTaken DESC")
          .all(q.folderId!, searchPattern, searchPattern) as unknown as Photo[]
      }
      return d.prepare('SELECT * FROM photos WHERE folderId = ? AND trashedAt IS NULL ORDER BY dateTaken DESC').all(q.folderId!) as unknown as Photo[]

    default: {
      if (q.tag) {
        if (searchPattern) {
          return d
            .prepare(
              `SELECT p.* FROM photos p
               JOIN photo_tags pt ON pt.photoId = p.id JOIN tags t ON t.id = pt.tagId
               WHERE t.name = ? AND p.trashedAt IS NULL AND (p.filename LIKE ? ESCAPE '\\' OR p.path LIKE ? ESCAPE '\\') ORDER BY p.dateTaken DESC`
            )
            .all(q.tag, searchPattern, searchPattern) as unknown as Photo[]
        }
        return d
          .prepare(
            `SELECT p.* FROM photos p
             JOIN photo_tags pt ON pt.photoId = p.id JOIN tags t ON t.id = pt.tagId
             WHERE t.name = ? AND p.trashedAt IS NULL ORDER BY p.dateTaken DESC`
          )
          .all(q.tag) as unknown as Photo[]
      }
      if (searchPattern) {
        return d
          .prepare("SELECT * FROM photos WHERE trashedAt IS NULL AND (filename LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\') ORDER BY dateTaken DESC")
          .all(searchPattern, searchPattern) as unknown as Photo[]
      }
      return d.prepare('SELECT * FROM photos WHERE trashedAt IS NULL ORDER BY dateTaken DESC').all() as unknown as Photo[]
    }
  }
}

export function setFavorite(ids: number[], fav: boolean): void {
  const stmt = getDb().prepare('UPDATE photos SET favorite = ? WHERE id = ?')
  tx(() => {
    for (const id of ids) stmt.run(fav ? 1 : 0, id)
  })
}

export function markViewed(id: number): void {
  getDb().prepare('UPDATE photos SET lastViewedAt = ? WHERE id = ?').run(Date.now(), id)
}

// ---------- albums ----------

export function listAlbums(): Album[] {
  return getDb()
    .prepare(
      `SELECT a.*, (SELECT COUNT(*) FROM album_photos ap JOIN photos p ON p.id = ap.photoId
        WHERE ap.albumId = a.id AND p.trashedAt IS NULL) AS photoCount
       FROM albums a ORDER BY a.name`
    )
    .all() as unknown as Album[]
}

export function createAlbum(name: string): Album {
  const info = getDb().prepare('INSERT INTO albums (name, createdAt) VALUES (?, ?)').run(name, Date.now())
  return { id: Number(info.lastInsertRowid), name, coverPhotoId: null, createdAt: Date.now(), photoCount: 0 }
}

export function renameAlbum(id: number, name: string): void {
  getDb().prepare('UPDATE albums SET name = ? WHERE id = ?').run(name, id)
}

export function deleteAlbum(id: number): void {
  getDb().prepare('DELETE FROM albums WHERE id = ?').run(id)
}

export function setAlbumCover(albumId: number, photoId: number): void {
  getDb().prepare('UPDATE albums SET coverPhotoId = ? WHERE id = ?').run(photoId, albumId)
}

export function addToAlbum(albumId: number, photoIds: number[]): void {
  const d = getDb()
  const max = (d.prepare('SELECT COALESCE(MAX(sortOrder), 0) AS m FROM album_photos WHERE albumId = ?').get(albumId) as unknown as { m: number }).m
  const stmt = d.prepare('INSERT OR IGNORE INTO album_photos (albumId, photoId, sortOrder) VALUES (?, ?, ?)')
  tx(() => {
    photoIds.forEach((pid, i) => stmt.run(albumId, pid, max + i + 1))
  })
}

export function removeFromAlbum(albumId: number, photoIds: number[]): void {
  const stmt = getDb().prepare('DELETE FROM album_photos WHERE albumId = ? AND photoId = ?')
  tx(() => {
    for (const pid of photoIds) stmt.run(albumId, pid)
  })
}

export function reorderAlbum(albumId: number, orderedPhotoIds: number[]): void {
  const stmt = getDb().prepare('UPDATE album_photos SET sortOrder = ? WHERE albumId = ? AND photoId = ?')
  tx(() => {
    orderedPhotoIds.forEach((pid, i) => stmt.run(i, albumId, pid))
  })
}

// ---------- tags ----------

export function listTags(): string[] {
  return (getDb().prepare('SELECT name FROM tags ORDER BY name').all() as unknown as { name: string }[]).map((r) => r.name)
}

export function getPhotoTags(photoId: number): string[] {
  return (
    getDb()
      .prepare('SELECT t.name FROM tags t JOIN photo_tags pt ON pt.tagId = t.id WHERE pt.photoId = ?')
      .all(photoId) as unknown as { name: string }[]
  ).map((r) => r.name)
}

export function addTag(photoId: number, tagName: string): void {
  const d = getDb()
  d.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName)
  const tag = d.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as unknown as { id: number }
  d.prepare('INSERT OR IGNORE INTO photo_tags (photoId, tagId) VALUES (?, ?)').run(photoId, tag.id)
}

export function removeTag(photoId: number, tagName: string): void {
  const d = getDb()
  const tag = d.prepare('SELECT id FROM tags WHERE name = ?').get(tagName) as unknown as { id: number } | undefined
  if (tag) d.prepare('DELETE FROM photo_tags WHERE photoId = ? AND tagId = ?').run(photoId, tag.id)
}

export function getAlbumsForPhoto(photoId: number): { id: number; name: string }[] {
  return getDb()
    .prepare('SELECT a.id, a.name FROM albums a JOIN album_photos ap ON ap.albumId = a.id WHERE ap.photoId = ?')
    .all(photoId) as unknown as { id: number; name: string }[]
}

// ---------- trash ----------

export function markTrashed(id: number, newPath: string, originalPath: string): void {
  getDb()
    .prepare('UPDATE photos SET trashedAt = ?, path = ?, trashOriginalPath = ? WHERE id = ?')
    .run(Date.now(), newPath, originalPath, id)
}

export function markRestored(id: number, restoredPath: string): void {
  getDb()
    .prepare('UPDATE photos SET trashedAt = NULL, path = ?, trashOriginalPath = NULL WHERE id = ?')
    .run(restoredPath, id)
}

export function deletePhotoRow(id: number): void {
  getDb().prepare('DELETE FROM photos WHERE id = ?').run(id)
}

export function deletePhotoRows(ids: number[]): void {
  if (!ids.length) return
  const stmt = getDb().prepare('DELETE FROM photos WHERE id = ?')
  tx(() => {
    for (const id of ids) stmt.run(id)
  })
}

export function getExpiredTrash(days: number): Photo[] {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return getDb().prepare('SELECT * FROM photos WHERE trashedAt IS NOT NULL AND trashedAt < ?').all(cutoff) as unknown as Photo[]
}

export function updatePhotoPath(id: number, newPath: string, newFilename: string): void {
  getDb().prepare('UPDATE photos SET path = ?, filename = ? WHERE id = ?').run(newPath, newFilename, id)
}
