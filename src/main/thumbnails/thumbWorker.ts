// Worker thread: generates thumbnails with sharp.
//
// Architecture notes (performance is the whole point here):
// - sharp.cache(false): libvips otherwise keeps decoded originals in RAM between jobs.
// - concurrency(1): one libvips thread per worker — thumbnailing is a background task
//   and must never compete with the UI for cores.
// - Each job targets a single pixel-bucket size from THUMB_LADDER.
//   sharp resizes JPEGs with shrink-on-load (scaled DCT decode), so a small thumb
//   never fully decodes a 24MP original.  DO NOT share a single full-res decode
//   across sizes — that would defeat the whole performance model.
// - 'preview' mode: extracts the embedded EXIF thumbnail via exifr for instant first
//   paint.  No full-image decode; takes roughly a millisecond per file.
// - 'shrink' mode (default): one sharp() pipeline resizing straight from the source
//   file to the target bucket size.  Falls back to the EXIF preview if sharp cannot
//   decode the file.
import { parentPort } from 'worker_threads'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import exifr from 'exifr'
import { THUMB_LADDER, type ThumbPx } from '@shared/types'

sharp.cache(false)
sharp.concurrency(1)

/** The valid bucket set as a plain JS Set for O(1) membership checks. */
const VALID_BUCKETS = new Set<number>(THUMB_LADDER)

export interface ThumbJob {
  id: number
  filePath: string
  hash: string
  /** Pixel bucket — must be a member of THUMB_LADDER */
  px: ThumbPx
  /** Base directory for the thumbnail cache, passed from the parent */
  cacheDir: string
  /**
   * 'shrink' (default): generate a real thumbnail at the given px bucket.
   * 'preview': extract only the embedded EXIF thumbnail; no sharp decode.
   */
  mode?: 'shrink' | 'preview'
  generation: number
}

interface ThumbResult {
  id: number
  ok: boolean
  mode: 'shrink' | 'preview'
  width?: number
  height?: number
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function outPath(job: ThumbJob): string {
  return path.join(job.cacheDir, String(job.px), `${job.hash}.webp`)
}

/** Validate that px is a known bucket. */
function validPx(px: unknown): px is ThumbPx {
  return typeof px === 'number' && VALID_BUCKETS.has(px)
}

// --------------------------------------------------------------------------
// Preview mode: extract the embedded EXIF thumbnail (no full decode)
// --------------------------------------------------------------------------

async function generatePreview(job: ThumbJob): Promise<ThumbResult> {
  // Previews live in their OWN namespace, never in a pixel bucket. Writing a
  // ~160px embedded preview to e.g. the 384 bucket would make generateShrink's
  // existsSync check below treat that slot as done, permanently pinning the
  // photo to the low-res preview. The protocol serves this dir as a last
  // resort, after every real bucket has been tried.
  const dest = path.join(job.cacheDir, 'preview', `${job.hash}.webp`)
  if (fs.existsSync(dest)) return { id: job.id, ok: true, mode: 'preview' }

  try {
    const preview = await exifr.thumbnail(job.filePath)
    if (!preview || !preview.length) return { id: job.id, ok: false, mode: 'preview' }
    // Write the raw embedded JPEG as a WebP so the cache layout stays uniform.
    // The embedded preview is typically 160-320px, which is fine for initial display.
    await sharp(Buffer.from(preview), { failOn: 'none' })
      .rotate()
      .resize(job.px, job.px, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(dest)
    return { id: job.id, ok: true, mode: 'preview' }
  } catch {
    return { id: job.id, ok: false, mode: 'preview' }
  }
}

// --------------------------------------------------------------------------
// Shrink mode: one pipeline per target size, shrink-on-load from source
// --------------------------------------------------------------------------

async function resolveInput(filePath: string): Promise<Buffer | string | null> {
  try {
    // A cheap metadata probe tells us whether sharp can decode the file at all.
    await sharp(filePath, { failOn: 'none' }).metadata()
    return filePath
  } catch {
    // Undecodable by sharp (some RAW dialects, corrupt files) — try the embedded
    // EXIF/RAW preview as a fallback so the tile isn't permanently blank.
    try {
      const preview = await exifr.thumbnail(filePath)
      return preview ? Buffer.from(preview) : null
    } catch {
      return null
    }
  }
}

async function generateShrink(job: ThumbJob): Promise<ThumbResult> {
  const dest = outPath(job)
  if (fs.existsSync(dest)) return { id: job.id, ok: true, mode: 'shrink' }

  const input = await resolveInput(job.filePath)
  if (input === null) return { id: job.id, ok: false, mode: 'shrink' }

  try {
    // One pipeline per target size.  sharp shrinks JPEGs via scaled DCT decode so
    // this never fully decodes a 24 MP original for a small thumbnail.
    const quality = job.px <= 256 ? 78 : 84
    const info = await sharp(input, { failOn: 'none' })
      .rotate()
      .resize(job.px, job.px, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toFile(dest)

    let w = 0
    let h = 0
    // Only report dimensions when we decoded the ORIGINAL file. If resolveInput
    // fell back to the embedded EXIF preview, `input` is a small buffer and its
    // metadata would describe the preview, not the photo — the parent stores
    // whatever we send here, so reporting those would corrupt photos.width/height.
    if (info.width && input === job.filePath) {
      const meta = await sharp(input, { failOn: 'none' }).metadata()
      w = meta.width ?? 0
      h = meta.height ?? 0
      // sharp reports pre-rotation dims whenever orientation >= 5; store post-rotation.
      if (meta.orientation && meta.orientation >= 5) [w, h] = [h, w]
    }
    return { id: job.id, ok: true, mode: 'shrink', width: w, height: h }
  } catch {
    return { id: job.id, ok: false, mode: 'shrink' }
  }
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

parentPort!.on('message', (job: ThumbJob) => {
  // CRITICAL: must always post a message back.  The parent holds inFlight = true
  // until it hears from us, so a dropped rejection permanently stalls the queue.
  if (!validPx(job.px)) {
    parentPort!.postMessage({ id: job.id, ok: false, mode: job.mode ?? 'shrink' } satisfies ThumbResult)
    return
  }

  const work = job.mode === 'preview' ? generatePreview(job) : generateShrink(job)
  work
    .then((res) => parentPort!.postMessage(res))
    .catch(() => parentPort!.postMessage({ id: job.id, ok: false, mode: job.mode ?? 'shrink' } satisfies ThumbResult))
})
