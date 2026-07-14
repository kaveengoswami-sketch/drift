// Worker thread: generates thumbnails with sharp.
//
// Architecture notes (performance is the whole point here):
// - sharp.cache(false): libvips otherwise keeps decoded originals in RAM between jobs.
// - concurrency(1): one libvips thread — thumbnailing is a background task and must
//   never compete with the UI for cores.
// - Scan-time jobs generate ONLY the 200px "small" size. sharp resizes JPEGs with
//   shrink-on-load (scaled DCT decode), so a small thumb never fully decodes a 24MP
//   original. medium/large are produced lazily via "ensure" jobs when a photo is opened.
// - Falls back to the EXIF embedded preview for formats libvips can't decode (RAW, HEIC).
import { parentPort } from 'worker_threads'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import exifr from 'exifr'

sharp.cache(false)
sharp.concurrency(1)

const PX: Record<string, number> = { small: 200, medium: 600, large: 1200 }

interface ThumbJob {
  id: number
  filePath: string
  hash: string
  cacheDir: string
  /** which sizes to generate for this job */
  sizes: ('small' | 'medium' | 'large')[]
}

async function resolveInput(job: ThumbJob): Promise<Buffer | string | null> {
  try {
    await sharp(job.filePath, { failOn: 'none' }).metadata()
    return job.filePath
  } catch {
    // undecodable by sharp — try the embedded EXIF/RAW preview
    try {
      const preview = await exifr.thumbnail(job.filePath)
      return preview ? Buffer.from(preview) : null
    } catch {
      return null
    }
  }
}

async function generate(job: ThumbJob): Promise<{ id: number; ok: boolean; width?: number; height?: number }> {
  const missing = job.sizes.filter((s) => !fs.existsSync(path.join(job.cacheDir, s, `${job.hash}.webp`)))
  if (!missing.length) return { id: job.id, ok: true }

  const input = await resolveInput(job)
  if (input === null) return { id: job.id, ok: false }

  try {
    let w = 0
    let h = 0
    for (const size of missing) {
      const outPath = path.join(job.cacheDir, size, `${job.hash}.webp`)
      // each pipeline decodes with shrink-on-load at its own target — cheaper
      // than one full-res decode shared across sizes
      const info = await sharp(input, { failOn: 'none' })
        .rotate()
        .resize(PX[size], PX[size], { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: size === 'small' ? 78 : 84 })
        .toFile(outPath)
      if (info.width && !w) {
        // recover original dimensions from the resize ratio is lossy; read cheaply instead
        const meta = await sharp(input, { failOn: 'none' }).metadata()
        w = meta.width ?? 0
        h = meta.height ?? 0
        if (meta.orientation && meta.orientation >= 5) [w, h] = [h, w]
      }
    }
    return { id: job.id, ok: true, width: w, height: h }
  } catch {
    return { id: job.id, ok: false }
  }
}

parentPort!.on('message', (job: ThumbJob) => {
  generate(job).then((res) => parentPort!.postMessage(res))
})
