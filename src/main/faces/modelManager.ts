import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import https from 'https'
import http from 'http'

export interface ModelPaths {
  detectorPath: string
  recognizerPath: string
}

const DETECTOR_FILENAME = 'scrfd_500m_kps.onnx'
const RECOGNIZER_FILENAME = 'w600k_r50.onnx'

// Detection stays SCRFD-500M from InsightFace "buffalo_s" (2.5MB) — it is fast
// and its box quality is not the bottleneck.
//
// Recognition is w600k_r50 from "buffalo_l" (ResNet50 ArcFace, ~166MB), not the
// w600k_mbf MobileFaceNet it replaced. MobileFaceNet's same-person and
// different-person score distributions overlap heavily on same-demographic,
// same-lighting subjects — a graduation shoot is close to its worst case — which
// caps how much a confirmed name can be trusted to find more of that person
// without dragging in strangers. Both emit 512-d embeddings and take the same
// 112x112 ArcFace preprocessing, so this is a drop-in swap.
//
// Both mirrored by the Immich project. The onnx-community/* URLs these replaced
// answered HTTP 401 — every scan died inside ensureModels() and the People view
// silently fell back to its empty state, which is why "Scan for People" looked
// like it did nothing at all.
const DETECTOR_URL = 'https://huggingface.co/immich-app/buffalo_s/resolve/main/detection/model.onnx'
const RECOGNIZER_URL = 'https://huggingface.co/immich-app/buffalo_l/resolve/main/recognition/model.onnx'

/** Sanity floor so a truncated download or HTML error body is never cached. */
const MIN_MODEL_BYTES = 1_000_000

export function getModelsDir(): string {
  return path.join(app.getPath('userData'), 'models', 'faces')
}

export function getModelPaths(): ModelPaths {
  const dir = getModelsDir()
  return {
    detectorPath: path.join(dir, DETECTOR_FILENAME),
    recognizerPath: path.join(dir, RECOGNIZER_FILENAME)
  }
}

export function hasModels(): boolean {
  const paths = getModelPaths()
  return fs.existsSync(paths.detectorPath) && fs.existsSync(paths.recognizerPath)
}

function downloadFile(url: string, destPath: string, onProgress?: (downloaded: number, total: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmpPath = `${destPath}.tmp`
    const request = (currentUrl: string, redirects = 0) => {
      if (redirects > 5) {
        return reject(new Error('Too many redirects'))
      }
      const client = currentUrl.startsWith('https') ? https : http
      client.get(currentUrl, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return request(res.headers.location, redirects + 1)
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to download model (HTTP ${res.statusCode})`))
        }

        const total = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0
        const fileStream = fs.createWriteStream(tmpPath)

        res.on('data', (chunk) => {
          downloaded += chunk.length
          if (onProgress) onProgress(downloaded, total)
        })

        res.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream.close(() => {
            try {
              const bytes = fs.statSync(tmpPath).size
              if (bytes < MIN_MODEL_BYTES) {
                fs.unlinkSync(tmpPath)
                reject(new Error(`Model download truncated (${bytes} bytes from ${currentUrl})`))
                return
              }
              fs.renameSync(tmpPath, destPath)
              resolve()
            } catch (err) {
              reject(err)
            }
          })
        })

        fileStream.on('error', (err) => {
          fs.unlink(tmpPath, () => {})
          reject(err)
        })
      }).on('error', (err) => {
        fs.unlink(tmpPath, () => {})
        reject(err)
      })
    }
    request(url)
  })
}

export async function ensureModels(onProgress?: (step: string, percent: number) => void): Promise<ModelPaths> {
  const dir = getModelsDir()
  fs.mkdirSync(dir, { recursive: true })
  const paths = getModelPaths()

  if (!fs.existsSync(paths.detectorPath)) {
    if (onProgress) onProgress('Downloading face detector...', 0)
    await downloadFile(DETECTOR_URL, paths.detectorPath, (dl, total) => {
      const pct = total > 0 ? Math.round((dl / total) * 50) : 25
      if (onProgress) onProgress('Downloading face detector...', pct)
    })
  }

  if (!fs.existsSync(paths.recognizerPath)) {
    if (onProgress) onProgress('Downloading face recognizer...', 50)
    await downloadFile(RECOGNIZER_URL, paths.recognizerPath, (dl, total) => {
      const pct = total > 0 ? 50 + Math.round((dl / total) * 50) : 75
      if (onProgress) onProgress('Downloading face recognizer...', pct)
    })
  }

  return paths
}
