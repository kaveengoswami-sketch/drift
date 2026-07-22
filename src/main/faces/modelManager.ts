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
const RECOGNIZER_FILENAME = 'w600k_mbf.onnx'

// Direct model URLs (Hugging Face / GitHub releases)
const DETECTOR_URL = 'https://huggingface.co/onnx-community/scrfd_500m_kps/resolve/main/onnx/model.onnx'
const RECOGNIZER_URL = 'https://huggingface.co/onnx-community/w600k_mbf/resolve/main/onnx/model.onnx'

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
