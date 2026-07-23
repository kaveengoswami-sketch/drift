// One-time backfill: photos.width/height were stored PRE-EXIF-rotation, so every
// row whose file carries orientation >= 5 had its width and height transposed.
// (Root cause: exifr returns Orientation as a translated string like 'Rotate 270 CW'
// by default, so the numeric >= 5 swap in src/main/scanner/index.ts never fired.)
//
// Re-measures every image row with sharp, applies orientation, and rewrites any row
// that disagrees. Safe to re-run — it is a no-op once the DB is correct.
//
// Run with Drift CLOSED, from the repo root so `sharp` resolves:
//   node scripts/backfill-orientation-dims.mjs [--dry-run]
import { DatabaseSync } from 'node:sqlite'
import path from 'path'
import fs from 'fs'
import sharp from 'sharp'

sharp.cache(false)

const DRY = process.argv.includes('--dry-run')
const CONCURRENCY = 8
const dbPath = path.join(process.env.APPDATA, 'drift', 'drift.db')

if (!fs.existsSync(dbPath)) {
  console.error(`no database at ${dbPath}`)
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
db.exec('PRAGMA journal_mode = WAL')

const rows = db.prepare(`SELECT id, path, width, height FROM photos WHERE type = 'image'`).all()
console.log(`${DRY ? '[dry run] ' : ''}${rows.length} image rows in ${dbPath}`)

const update = db.prepare('UPDATE photos SET width = ?, height = ? WHERE id = ?')

const stats = { measured: 0, fixed: 0, missing: 0, undecodable: 0 }
const pending = []

async function measure(r) {
  if (!fs.existsSync(r.path)) {
    stats.missing++
    return
  }
  let meta
  try {
    meta = await sharp(r.path, { failOn: 'none' }).metadata()
  } catch {
    stats.undecodable++
    return
  }
  let w = meta.width ?? 0
  let h = meta.height ?? 0
  if (!w || !h) {
    stats.undecodable++
    return
  }
  if ((meta.orientation ?? 1) >= 5) [w, h] = [h, w]
  stats.measured++
  if (w !== r.width || h !== r.height) {
    stats.fixed++
    pending.push([w, h, r.id])
  }
}

function flush() {
  if (DRY || !pending.length) return
  db.exec('BEGIN')
  try {
    for (const args of pending) update.run(...args)
    db.exec('COMMIT')
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
  pending.length = 0
}

let next = 0
async function worker() {
  while (next < rows.length) {
    const r = rows[next++]
    await measure(r)
    if (pending.length >= 500) flush()
    if (next % 1000 === 0) console.log(`  ${next}/${rows.length}...`)
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
flush()

console.log(
  `measured ${stats.measured}, ${DRY ? 'would fix' : 'fixed'} ${stats.fixed}, ` +
    `${stats.missing} files missing on disk, ${stats.undecodable} undecodable`
)
db.close()
