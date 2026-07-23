import { DatabaseSync } from 'node:sqlite'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import type { Photo, SourceFolder, Album, Settings, Person, Face } from '@shared/types'
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

function hasColumn(d: DatabaseSync, table: string, column: string): boolean {
  try {
    const cols = d.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return cols.some((c) => c.name === column)
  } catch {
    return false
  }
}

function safeAddColumn(d: DatabaseSync, table: string, column: string, typeDef: string): void {
  if (!hasColumn(d, table, column)) {
    try {
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeDef}`)
    } catch (err: any) {
      if (err?.message?.includes('duplicate column name')) {
        return
      }
      console.error(`[DB Migration Failure] Failed to add column ${column} to table ${table}:`, err)
      throw err
    }
  }
}

function executeStatements(d: DatabaseSync, statements: string[]): void {
  for (const stmt of statements) {
    const trimmed = stmt.trim()
    if (!trimmed) continue
    try {
      d.exec(trimmed)
    } catch (err) {
      console.error(`[DB Migration Failure] Failed executing statement:\n${trimmed}\nError:`, err)
      throw err
    }
  }
}

function migrate(d: DatabaseSync): void {
  // 1. Base table definitions
  const baseTables = [
    `CREATE TABLE IF NOT EXISTS folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      relPath TEXT,
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
    );`,
    `CREATE TABLE IF NOT EXISTS albums (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      coverPhotoId INTEGER,
      createdAt INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS album_photos (
      albumId INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
      photoId INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      sortOrder INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (albumId, photoId)
    );`,
    `CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );`,
    `CREATE TABLE IF NOT EXISTS photo_tags (
      photoId INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      tagId INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (photoId, tagId)
    );`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS people (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      type TEXT CHECK(type IN ('human', 'pet')) DEFAULT 'human',
      coverFaceId INTEGER REFERENCES faces(id) ON DELETE SET NULL,
      isHidden INTEGER DEFAULT 0,
      createdAt INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS faces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      photoId INTEGER NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
      personId INTEGER REFERENCES people(id) ON DELETE SET NULL,
      bboxX REAL NOT NULL,
      bboxY REAL NOT NULL,
      bboxW REAL NOT NULL,
      bboxH REAL NOT NULL,
      embedding BLOB NOT NULL,
      confidence REAL NOT NULL,
      detectionType TEXT DEFAULT 'human',
      createdAt INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS photo_face_scanned (
      photoId INTEGER PRIMARY KEY REFERENCES photos(id) ON DELETE CASCADE,
      scannedAt INTEGER NOT NULL
    );`
  ]
  executeStatements(d, baseTables)

  // 2. Column additions
  safeAddColumn(d, 'photos', 'relPath', 'TEXT')

  // 3. Indexes (created after base tables and column migrations)
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_photos_dateTaken ON photos(dateTaken DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_photos_folder ON photos(folderId);`,
    `CREATE INDEX IF NOT EXISTS idx_photos_trashed ON photos(trashedAt);`,
    `CREATE INDEX IF NOT EXISTS idx_photos_addedAt ON photos(addedAt DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_photos_lastViewedAt ON photos(lastViewedAt DESC);`,
    `CREATE INDEX IF NOT EXISTS idx_photos_path ON photos(path);`,
    `CREATE INDEX IF NOT EXISTS idx_photos_relPath ON photos(relPath);`,
    `CREATE INDEX IF NOT EXISTS idx_faces_photoId ON faces(photoId);`,
    `CREATE INDEX IF NOT EXISTS idx_faces_personId ON faces(personId);`
  ]
  executeStatements(d, indexes)

  // 4. Backfill relPath for existing photos using folder paths
  const unpopulated = d.prepare(`
    SELECT p.id, p.path, f.path as folderPath
    FROM photos p
    JOIN folders f ON f.id = p.folderId
    WHERE p.relPath IS NULL
  `).all() as unknown as Array<{ id: number; path: string; folderPath: string }>

  if (unpopulated.length > 0) {
    const updateStmt = d.prepare('UPDATE photos SET relPath = ? WHERE id = ?')
    d.exec('BEGIN')
    try {
      for (const r of unpopulated) {
        let rel = r.path
        if (r.folderPath && r.path.startsWith(r.folderPath)) {
          rel = r.path.slice(r.folderPath.length).replace(/^[/\\]+/, '')
        }
        updateStmt.run(rel, r.id)
      }
      d.exec('COMMIT')
    } catch (e) {
      d.exec('ROLLBACK')
      throw e
    }
  }
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
  relPath: string
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
    INSERT INTO photos (path, filename, relPath, folderId, size, width, height, type, dateTaken, dateModified, duration, hash, addedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET
      filename = excluded.filename, relPath = excluded.relPath,
      size = excluded.size, width = excluded.width, height = excluded.height,
      dateTaken = excluded.dateTaken, dateModified = excluded.dateModified,
      duration = excluded.duration, hash = excluded.hash
  `)
  const now = Date.now()
  tx(() => {
    for (const r of photos) {
      stmt.run(r.path, r.filename, r.relPath, r.folderId, r.size, r.width, r.height, r.type, r.dateTaken, r.dateModified, r.duration, r.hash, now)
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
  const searchParams = searchPattern ? Array(5).fill(searchPattern) : []

  const SEARCH_MATCH_SQL = `(
    p.filename LIKE ? ESCAPE '\\' OR
    p.relPath LIKE ? ESCAPE '\\' OR
    REPLACE(p.relPath, '\\', '/') LIKE ? ESCAPE '\\' OR
    p.id IN (SELECT pt.photoId FROM photo_tags pt JOIN tags t ON t.id = pt.tagId WHERE t.name LIKE ? ESCAPE '\\') OR
    p.id IN (SELECT ap.photoId FROM album_photos ap JOIN albums a ON a.id = ap.albumId WHERE a.name LIKE ? ESCAPE '\\')
  )`

  switch (q.view) {
    case 'favorites':
      if (searchPattern) {
        return d
          .prepare(`SELECT p.* FROM photos p WHERE p.favorite = 1 AND p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.dateTaken DESC`)
          .all(...searchParams) as unknown as Photo[]
      }
      return d.prepare('SELECT p.* FROM photos p WHERE p.favorite = 1 AND p.trashedAt IS NULL ORDER BY p.dateTaken DESC').all() as unknown as Photo[]

    case 'recent-added':
      if (searchPattern) {
        return d
          .prepare(`SELECT p.* FROM photos p WHERE p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.addedAt DESC, p.dateTaken DESC LIMIT 2000`)
          .all(...searchParams) as unknown as Photo[]
      }
      return d.prepare('SELECT p.* FROM photos p WHERE p.trashedAt IS NULL ORDER BY p.addedAt DESC, p.dateTaken DESC LIMIT 2000').all() as unknown as Photo[]

    case 'recent-viewed':
      if (searchPattern) {
        return d
          .prepare(`SELECT p.* FROM photos p WHERE p.lastViewedAt IS NOT NULL AND p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.lastViewedAt DESC LIMIT 500`)
          .all(...searchParams) as unknown as Photo[]
      }
      return d.prepare('SELECT p.* FROM photos p WHERE p.lastViewedAt IS NOT NULL AND p.trashedAt IS NULL ORDER BY p.lastViewedAt DESC LIMIT 500').all() as unknown as Photo[]

    case 'videos':
      if (searchPattern) {
        return d
          .prepare(`SELECT p.* FROM photos p WHERE p.type = 'video' AND p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.dateTaken DESC`)
          .all(...searchParams) as unknown as Photo[]
      }
      return d.prepare("SELECT p.* FROM photos p WHERE p.type = 'video' AND p.trashedAt IS NULL ORDER BY p.dateTaken DESC").all() as unknown as Photo[]

    case 'trash':
      if (searchPattern) {
        return d
          .prepare(`SELECT p.* FROM photos p WHERE p.trashedAt IS NOT NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.trashedAt DESC`)
          .all(...searchParams) as unknown as Photo[]
      }
      return d.prepare('SELECT p.* FROM photos p WHERE p.trashedAt IS NOT NULL ORDER BY p.trashedAt DESC').all() as unknown as Photo[]

    case 'album':
      if (searchPattern) {
        return d
          .prepare(
            `SELECT p.* FROM photos p JOIN album_photos ap ON ap.photoId = p.id
             WHERE ap.albumId = ? AND p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY ap.sortOrder, p.dateTaken DESC`
          )
          .all(q.albumId!, ...searchParams) as unknown as Photo[]
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
            .prepare(`SELECT p.* FROM photos p WHERE p.path LIKE ? ESCAPE '\\' AND p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.dateTaken DESC`)
            .all(prefix, ...searchParams) as unknown as Photo[]
        }
        return d
          .prepare("SELECT p.* FROM photos p WHERE p.path LIKE ? ESCAPE '\\' AND p.trashedAt IS NULL ORDER BY p.dateTaken DESC")
          .all(prefix) as unknown as Photo[]
      }
      if (searchPattern) {
        return d
          .prepare(`SELECT p.* FROM photos p WHERE p.folderId = ? AND p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.dateTaken DESC`)
          .all(q.folderId!, ...searchParams) as unknown as Photo[]
      }
      return d.prepare('SELECT p.* FROM photos p WHERE p.folderId = ? AND p.trashedAt IS NULL ORDER BY p.dateTaken DESC').all(q.folderId!) as unknown as Photo[]

    default: {
      if (q.tag) {
        if (searchPattern) {
          return d
            .prepare(
              `SELECT p.* FROM photos p
               JOIN photo_tags pt ON pt.photoId = p.id JOIN tags t ON t.id = pt.tagId
               WHERE t.name = ? AND p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.dateTaken DESC`
            )
            .all(q.tag, ...searchParams) as unknown as Photo[]
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
          .prepare(`SELECT p.* FROM photos p WHERE p.trashedAt IS NULL AND ${SEARCH_MATCH_SQL} ORDER BY p.dateTaken DESC`)
          .all(...searchParams) as unknown as Photo[]
      }
      return d.prepare('SELECT p.* FROM photos p WHERE p.trashedAt IS NULL ORDER BY p.dateTaken DESC').all() as unknown as Photo[]
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
  const d = getDb()
  const photo = getPhoto(id)
  let relPath = newFilename
  if (photo) {
    const folder = d.prepare('SELECT path FROM folders WHERE id = ?').get(photo.folderId) as unknown as { path: string } | undefined
    if (folder && newPath.startsWith(folder.path)) {
      relPath = newPath.slice(folder.path.length).replace(/^[/\\]+/, '')
    }
  }
  d.prepare('UPDATE photos SET path = ?, filename = ?, relPath = ? WHERE id = ?').run(newPath, newFilename, relPath, id)
}

// ---------- faces & people ----------

export function listPeople(): Person[] {
  const d = getDb()
  const rows = d.prepare(`
    SELECT
      p.id, p.name, p.type, p.coverFaceId, p.isHidden, p.createdAt,
      COUNT(f.id) as faceCount,
      ph.path as coverPhotoPath,
      cf.bboxX as coverBboxX, cf.bboxY as coverBboxY, cf.bboxW as coverBboxW, cf.bboxH as coverBboxH
    FROM people p
    LEFT JOIN faces f ON f.personId = p.id
    LEFT JOIN faces cf ON cf.id = p.coverFaceId
    LEFT JOIN photos ph ON ph.id = cf.photoId
    WHERE p.isHidden = 0
    GROUP BY p.id
    ORDER BY p.name IS NULL ASC, p.name ASC, faceCount DESC
  `).all() as unknown as Array<{
    id: number
    name: string | null
    type: 'human' | 'pet'
    coverFaceId: number | null
    isHidden: number
    createdAt: number
    faceCount: number
    coverPhotoPath?: string | null
    coverBboxX?: number | null
    coverBboxY?: number | null
    coverBboxW?: number | null
    coverBboxH?: number | null
  }>

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    coverFaceId: r.coverFaceId,
    isHidden: r.isHidden,
    createdAt: r.createdAt,
    faceCount: r.faceCount,
    coverPhotoPath: r.coverPhotoPath || null,
    coverBbox: r.coverBboxX != null ? { x: r.coverBboxX, y: r.coverBboxY!, w: r.coverBboxW!, h: r.coverBboxH! } : null
  }))
}

export function getPerson(id: number): Person | undefined {
  const d = getDb()
  const r = d.prepare(`
    SELECT
      p.id, p.name, p.type, p.coverFaceId, p.isHidden, p.createdAt,
      (SELECT COUNT(*) FROM faces WHERE personId = p.id) as faceCount,
      ph.path as coverPhotoPath,
      cf.bboxX as coverBboxX, cf.bboxY as coverBboxY, cf.bboxW as coverBboxW, cf.bboxH as coverBboxH
    FROM people p
    LEFT JOIN faces cf ON cf.id = p.coverFaceId
    LEFT JOIN photos ph ON ph.id = cf.photoId
    WHERE p.id = ?
  `).get(id) as unknown as {
    id: number
    name: string | null
    type: 'human' | 'pet'
    coverFaceId: number | null
    isHidden: number
    createdAt: number
    faceCount: number
    coverPhotoPath?: string | null
    coverBboxX?: number | null
    coverBboxY?: number | null
    coverBboxW?: number | null
    coverBboxH?: number | null
  } | undefined

  if (!r) return undefined
  return {
    id: r.id,
    name: r.name,
    type: r.type,
    coverFaceId: r.coverFaceId,
    isHidden: r.isHidden,
    createdAt: r.createdAt,
    faceCount: r.faceCount,
    coverPhotoPath: r.coverPhotoPath || null,
    coverBbox: r.coverBboxX != null ? { x: r.coverBboxX, y: r.coverBboxY!, w: r.coverBboxW!, h: r.coverBboxH! } : null
  }
}

export function listFacesForPhoto(photoId: number): Face[] {
  const rows = getDb().prepare(`
    SELECT f.*, p.name as personName
    FROM faces f
    LEFT JOIN people p ON p.id = f.personId
    WHERE f.photoId = ?
  `).all(photoId) as unknown as (Face & { personName: string | null })[]
  return rows.map((r) => ({
    id: r.id,
    photoId: r.photoId,
    personId: r.personId,
    bboxX: r.bboxX,
    bboxY: r.bboxY,
    bboxW: r.bboxW,
    bboxH: r.bboxH,
    confidence: r.confidence,
    detectionType: (r.detectionType as 'human' | 'cat' | 'dog') || 'human',
    createdAt: r.createdAt,
    personName: r.personName
  }))
}

export function listPhotosForPerson(personId: number): Photo[] {
  return getDb().prepare(`
    SELECT DISTINCT p.*
    FROM photos p
    JOIN faces f ON f.photoId = p.id
    WHERE f.personId = ? AND p.trashedAt IS NULL
    ORDER BY p.dateTaken DESC
  `).all(personId) as unknown as Photo[]
}

export function namePerson(personId: number, name: string): void {
  const trimmed = name.trim()
  getDb().prepare('UPDATE people SET name = ? WHERE id = ?').run(trimmed.length > 0 ? trimmed : null, personId)
}

/** Case-insensitive lookup used to catch "same name, different cluster" before it becomes a duplicate. */
export function findPersonByName(name: string, excludeId?: number): { id: number } | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  return getDb()
    .prepare('SELECT id FROM people WHERE name IS NOT NULL AND lower(name) = lower(?) AND id != ? LIMIT 1')
    .get(trimmed, excludeId ?? -1) as unknown as { id: number } | undefined
}

export function deleteEmptyPeople(): void {
  getDb()
    .prepare('DELETE FROM people WHERE id NOT IN (SELECT DISTINCT personId FROM faces WHERE personId IS NOT NULL)')
    .run()
}

export function mergePeople(targetPersonId: number, sourcePersonId: number): void {
  if (targetPersonId === sourcePersonId) return
  tx(() => {
    const d = getDb()
    d.prepare('UPDATE faces SET personId = ? WHERE personId = ?').run(targetPersonId, sourcePersonId)
    d.prepare('DELETE FROM people WHERE id = ?').run(sourcePersonId)
    const target = d.prepare('SELECT coverFaceId FROM people WHERE id = ?').get(targetPersonId) as unknown as { coverFaceId: number | null } | undefined
    if (target && !target.coverFaceId) {
      const topFace = d.prepare('SELECT id FROM faces WHERE personId = ? ORDER BY bboxW * bboxH DESC LIMIT 1').get(targetPersonId) as unknown as { id: number } | undefined
      if (topFace) {
        d.prepare('UPDATE people SET coverFaceId = ? WHERE id = ?').run(topFace.id, targetPersonId)
      }
    }
  })
}

export function detachFace(faceId: number): void {
  getDb().prepare('UPDATE faces SET personId = NULL WHERE id = ?').run(faceId)
}

export function getUnscannedPhotos(): Array<{ id: number; path: string }> {
  return getDb().prepare(`
    SELECT id, path FROM photos
    WHERE type = 'image' AND trashedAt IS NULL
      AND id NOT IN (SELECT photoId FROM photo_face_scanned)
    ORDER BY dateTaken DESC
  `).all() as unknown as Array<{ id: number; path: string }>
}

export function recordFaceScanResult(
  photoId: number,
  faces: Array<{
    bboxX: number
    bboxY: number
    bboxW: number
    bboxH: number
    confidence: number
    detectionType: string
    embedding: Uint8Array
  }>
): void {
  const d = getDb()
  const now = Date.now()
  const insertFaceStmt = d.prepare(`
    INSERT INTO faces (photoId, personId, bboxX, bboxY, bboxW, bboxH, embedding, confidence, detectionType, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const markScannedStmt = d.prepare(`
    INSERT OR REPLACE INTO photo_face_scanned (photoId, scannedAt) VALUES (?, ?)
  `)
  const existingStmt = d.prepare(
    'SELECT id, personId, bboxX, bboxY, bboxW, bboxH FROM faces WHERE photoId = ? AND personId IS NOT NULL'
  )
  const clearStmt = d.prepare('DELETE FROM faces WHERE photoId = ?')

  // Re-scanning a photo used to append a second copy of every face. It now
  // replaces them — and carries any person assignment across by box overlap,
  // so a change that forces a re-embed (a new recognition model, or a change
  // to how faces are cropped) does not throw away names the user has entered.
  const prior = existingStmt.all(photoId) as unknown as Array<{
    id: number
    personId: number
    bboxX: number
    bboxY: number
    bboxW: number
    bboxH: number
  }>

  const claimed = new Set<number>()
  const carryOver = (f: { bboxX: number; bboxY: number; bboxW: number; bboxH: number }): number | null => {
    let bestId: number | null = null
    let bestIou = 0.5 // below this the boxes are not the same face
    for (const old of prior) {
      if (claimed.has(old.id)) continue
      const ix = Math.max(0, Math.min(f.bboxX + f.bboxW, old.bboxX + old.bboxW) - Math.max(f.bboxX, old.bboxX))
      const iy = Math.max(0, Math.min(f.bboxY + f.bboxH, old.bboxY + old.bboxH) - Math.max(f.bboxY, old.bboxY))
      const inter = ix * iy
      const union = f.bboxW * f.bboxH + old.bboxW * old.bboxH - inter
      const iou = union > 0 ? inter / union : 0
      if (iou > bestIou) {
        bestIou = iou
        bestId = old.id
      }
    }
    if (bestId !== null) claimed.add(bestId)
    return bestId === null ? null : (prior.find((o) => o.id === bestId) as { personId: number }).personId
  }

  tx(() => {
    clearStmt.run(photoId)
    for (const f of faces) {
      insertFaceStmt.run(
        photoId,
        carryOver(f),
        f.bboxX,
        f.bboxY,
        f.bboxW,
        f.bboxH,
        Buffer.from(f.embedding),
        f.confidence,
        f.detectionType,
        now
      )
    }
    markScannedStmt.run(photoId, now)
  })
}

/**
 * Bumped whenever stored embeddings stop being comparable with freshly
 * computed ones — a different recognition model, or a change to how the face
 * is cropped before it reaches the model. Both happened at version 2:
 * w600k_mbf -> w600k_r50, and box-crop -> 5-point landmark alignment.
 */
export const FACE_EMBED_VERSION = 2

/**
 * Clear the scanned marker for every photo so the next scan re-embeds the
 * whole library. Face rows are left alone — recordFaceScanResult replaces
 * them per photo and carries person assignments across.
 */
export function invalidateFaceEmbeddings(): void {
  getDb().prepare('DELETE FROM photo_face_scanned').run()
}

/** 512 float32 values. Anything else is a truncated or failed embedding. */
export const EMBEDDING_BYTES = 512 * 4

export interface FaceEmbeddingRow {
  id: number
  photoId: number
  personId: number | null
  embedding: Buffer
  personName: string | null
}

export function getAllFaceEmbeddings(): FaceEmbeddingRow[] {
  // A face whose embedding is missing or the wrong size cannot be compared
  // with anything, and handing one to the clusterer crashes it on `.buffer`.
  // EMBEDDING_BYTES is 512 float32s.
  return getDb().prepare(`
    SELECT f.id, f.photoId, f.personId, f.embedding, p.name as personName
    FROM faces f
    LEFT JOIN people p ON p.id = f.personId
    WHERE f.embedding IS NOT NULL AND length(f.embedding) = ${EMBEDDING_BYTES}
  `).all() as unknown as FaceEmbeddingRow[]
}

export function createPerson(name: string | null = null, type: 'human' | 'pet' = 'human'): number {
  const info = getDb().prepare('INSERT INTO people (name, type, createdAt) VALUES (?, ?, ?)').run(name, type, Date.now())
  return Number(info.lastInsertRowid)
}

export function assignFaceToPerson(faceId: number, personId: number | null): void {
  getDb().prepare('UPDATE faces SET personId = ? WHERE id = ?').run(personId, faceId)
}

export function updatePersonCoverFace(personId: number, coverFaceId: number | null): void {
  getDb().prepare('UPDATE people SET coverFaceId = ? WHERE id = ?').run(coverFaceId, personId)
}

