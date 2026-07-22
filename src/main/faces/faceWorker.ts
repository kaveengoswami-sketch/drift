import { parentPort } from 'worker_threads'
import sharp from 'sharp'
import type * as OrtType from 'onnxruntime-node'

sharp.cache(false)
sharp.concurrency(1)

let ortModule: typeof OrtType | null = null

async function getOrt(): Promise<typeof OrtType> {
  if (!ortModule) {
    ortModule = await import('onnxruntime-node')
  }
  return ortModule
}

export interface ScanJob {
  photoId: number
  filePath: string
  detectorPath: string
  recognizerPath: string
}

export interface DetectedFace {
  bboxX: number
  bboxY: number
  bboxW: number
  bboxH: number
  confidence: number
  detectionType: 'human'
  embedding: Uint8Array
}

export interface ScanResult {
  photoId: number
  ok: boolean
  faces: DetectedFace[]
  error?: string
}

let detectorSession: OrtType.InferenceSession | null = null
let recognizerSession: OrtType.InferenceSession | null = null
let loadedDetectorPath = ''
let loadedRecognizerPath = ''

async function getSessions(
  detectorPath: string,
  recognizerPath: string
): Promise<{ detector: OrtType.InferenceSession; recognizer: OrtType.InferenceSession }> {
  const ort = await getOrt()
  if (!detectorSession || loadedDetectorPath !== detectorPath) {
    detectorSession = await ort.InferenceSession.create(detectorPath, { executionProviders: ['cpu'] })
    loadedDetectorPath = detectorPath
  }
  if (!recognizerSession || loadedRecognizerPath !== recognizerPath) {
    recognizerSession = await ort.InferenceSession.create(recognizerPath, { executionProviders: ['cpu'] })
    loadedRecognizerPath = recognizerPath
  }
  return { detector: detectorSession, recognizer: recognizerSession }
}

function l2Normalize(arr: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] * arr[i]
  }
  const norm = Math.sqrt(sum)
  if (norm > 0) {
    for (let i = 0; i < arr.length; i++) {
      arr[i] /= norm
    }
  }
  return arr
}

export async function processPhoto(job: ScanJob): Promise<ScanResult> {
  try {
    const { detector, recognizer } = await getSessions(job.detectorPath, job.recognizerPath)
    const ort = await getOrt()

    const metadata = await sharp(job.filePath, { failOn: 'none' }).rotate().metadata()
    const origW = metadata.width || 0
    const origH = metadata.height || 0

    if (!origW || !origH) {
      return { photoId: job.photoId, ok: true, faces: [] }
    }

    const targetDim = 640
    const scale = Math.min(targetDim / origW, targetDim / origH, 1.0)
    const detW = Math.round(origW * scale)
    const detH = Math.round(origH * scale)

    const { data: rawBuf, info } = await sharp(job.filePath, { failOn: 'none' })
      .rotate()
      .resize(detW, detH, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const inputSize = 3 * info.height * info.width
    const floatData = new Float32Array(inputSize)
    const channelSize = info.height * info.width

    for (let i = 0; i < channelSize; i++) {
      const r = rawBuf[i * 3]
      const g = rawBuf[i * 3 + 1]
      const b = rawBuf[i * 3 + 2]
      floatData[i] = (r - 127.5) / 128.0
      floatData[channelSize + i] = (g - 127.5) / 128.0
      floatData[2 * channelSize + i] = (b - 127.5) / 128.0
    }

    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, info.height, info.width])
    const detectorInputName = detector.inputNames[0]
    const outputs = await detector.run({ [detectorInputName]: inputTensor })

    const detectedBoxes: Array<{ x: number; y: number; w: number; h: number; conf: number }> = []

    for (const name of detector.outputNames) {
      const tensor = outputs[name]
      if (!tensor) continue
      const data = tensor.data as Float32Array
      const dims = tensor.dims

      if (dims.length === 2 && dims[1] >= 4) {
        const numDets = dims[0]
        const stride = dims[1]
        for (let i = 0; i < numDets; i++) {
          const conf = stride >= 5 ? data[i * stride + 4] : 0.9
          if (conf >= 0.5) {
            let x1 = data[i * stride]
            let y1 = data[i * stride + 1]
            let x2 = data[i * stride + 2]
            let y2 = data[i * stride + 3]

            if (x2 <= 1.0 && y2 <= 1.0) {
              x1 *= info.width
              y1 *= info.height
              x2 *= info.width
              y2 *= info.height
            }

            const bw = Math.max(0, x2 - x1)
            const bh = Math.max(0, y2 - y1)
            if (bw > 10 && bh > 10) {
              detectedBoxes.push({
                x: x1 / info.width,
                y: y1 / info.height,
                w: bw / info.width,
                h: bh / info.height,
                conf
              })
            }
          }
        }
      }
    }

    const detectedFaces: DetectedFace[] = []

    for (const box of detectedBoxes.slice(0, 20)) {
      const marginX = box.w * 0.15
      const marginY = box.h * 0.15
      const left = Math.max(0, Math.floor((box.x - marginX) * origW))
      const top = Math.max(0, Math.floor((box.y - marginY) * origH))
      const cropW = Math.min(origW - left, Math.ceil((box.w + 2 * marginX) * origW))
      const cropH = Math.min(origH - top, Math.ceil((box.h + 2 * marginY) * origH))

      if (cropW < 10 || cropH < 10) continue

      const faceBuf = await sharp(job.filePath, { failOn: 'none' })
        .rotate()
        .extract({ left, top, width: cropW, height: cropH })
        .resize(112, 112, { fit: 'fill' })
        .removeAlpha()
        .raw()
        .toBuffer()

      const faceFloatData = new Float32Array(3 * 112 * 112)
      const faceChannelSize = 112 * 112

      for (let i = 0; i < faceChannelSize; i++) {
        const r = faceBuf[i * 3]
        const g = faceBuf[i * 3 + 1]
        const b = faceBuf[i * 3 + 2]
        faceFloatData[i] = (r - 127.5) / 128.0
        faceFloatData[faceChannelSize + i] = (g - 127.5) / 128.0
        faceFloatData[2 * faceChannelSize + i] = (b - 127.5) / 128.0
      }

      const faceTensor = new ort.Tensor('float32', faceFloatData, [1, 3, 112, 112])
      const recInputName = recognizer.inputNames[0]
      const recOutputs = await recognizer.run({ [recInputName]: faceTensor })

      const firstOutputName = recognizer.outputNames[0]
      const embTensor = recOutputs[firstOutputName]
      const rawEmb = embTensor.data as Float32Array

      const emb512 = new Float32Array(512)
      for (let i = 0; i < Math.min(rawEmb.length, 512); i++) {
        emb512[i] = rawEmb[i]
      }
      l2Normalize(emb512)

      const u8Buffer = new Uint8Array(emb512.buffer, emb512.byteOffset, emb512.byteLength)

      detectedFaces.push({
        bboxX: box.x,
        bboxY: box.y,
        bboxW: box.w,
        bboxH: box.h,
        confidence: box.conf,
        detectionType: 'human',
        embedding: Uint8Array.from(u8Buffer)
      })
    }

    return { photoId: job.photoId, ok: true, faces: detectedFaces }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return { photoId: job.photoId, ok: false, faces: [], error: errorMsg }
  }
}

if (parentPort) {
  parentPort.on('message', (job: ScanJob) => {
    processPhoto(job)
      .then((res) => parentPort!.postMessage(res))
      .catch((err) =>
        parentPort!.postMessage({
          photoId: job.photoId,
          ok: false,
          faces: [],
          error: String(err)
        } satisfies ScanResult)
      )
  })
}
