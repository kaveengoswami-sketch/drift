import { parentPort } from 'worker_threads'
import sharp from 'sharp'
import type * as OrtType from 'onnxruntime-node'
import { similarityTransform, warpToTemplate, ALIGN_SIZE } from './align'

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

/** SCRFD-500M topology: square input, 3 FPN strides, 2 anchors per cell. */
const DET_INPUT = 640
const DET_STRIDES = [8, 16, 32]
const DET_ANCHORS = 2
const DET_CONF = 0.65
const DET_NMS_IOU = 0.4

interface RawBox {
  x1: number
  y1: number
  x2: number
  y2: number
  conf: number
  /** 5 landmarks (eyes, nose, mouth corners) in detector-input pixels. */
  kps: Array<[number, number]>
}


/** Greedy non-maximum suppression — every stride fires on the same face. */
function nms(boxes: RawBox[]): RawBox[] {
  boxes.sort((a, b) => b.conf - a.conf)
  const keep: RawBox[] = []
  for (const b of boxes) {
    let overlaps = false
    for (const k of keep) {
      const iw = Math.max(0, Math.min(b.x2, k.x2) - Math.max(b.x1, k.x1))
      const ih = Math.max(0, Math.min(b.y2, k.y2) - Math.max(b.y1, k.y1))
      const inter = iw * ih
      const union = (b.x2 - b.x1) * (b.y2 - b.y1) + (k.x2 - k.x1) * (k.y2 - k.y1) - inter
      if (union > 0 && inter / union > DET_NMS_IOU) {
        overlaps = true
        break
      }
    }
    if (!overlaps) keep.push(b)
  }
  return keep
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

    // sharp's metadata() reports the file's stored dimensions, which for an
    // EXIF-rotated portrait shot are the *pre*-rotation ones. Using them
    // unswapped makes every later coordinate mapping wrong, so swap here.
    const metadata = await sharp(job.filePath, { failOn: 'none' }).metadata()
    const swapped = (metadata.orientation || 1) >= 5
    const origW = (swapped ? metadata.height : metadata.width) || 0
    const origH = (swapped ? metadata.width : metadata.height) || 0

    if (!origW || !origH) {
      return { photoId: job.photoId, ok: true, faces: [] }
    }

    const { data: rawBuf, info } = await sharp(job.filePath, { failOn: 'none' })
      .rotate()
      .resize(DET_INPUT, DET_INPUT, { fit: 'inside' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })

    // SCRFD's anchor grid is derived from a fixed DET_INPUT square, so the
    // resized image is letterboxed into the top-left of one here rather than
    // fed at its own dimensions.
    const channelSize = DET_INPUT * DET_INPUT
    const floatData = new Float32Array(3 * channelSize)
    floatData.fill((0 - 127.5) / 128.0)
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        const s = (y * info.width + x) * 3
        const d = y * DET_INPUT + x
        floatData[d] = (rawBuf[s] - 127.5) / 128.0
        floatData[channelSize + d] = (rawBuf[s + 1] - 127.5) / 128.0
        floatData[2 * channelSize + d] = (rawBuf[s + 2] - 127.5) / 128.0
      }
    }
    const detScale = info.width / origW

    const inputTensor = new ort.Tensor('float32', floatData, [1, 3, DET_INPUT, DET_INPUT])
    const detectorInputName = detector.inputNames[0]
    const outputs = await detector.run({ [detectorInputName]: inputTensor })

    // SCRFD emits 9 tensors in a fixed order: scores for strides 8/16/32,
    // then bbox distances, then keypoints. The bbox values are per-anchor
    // distances in stride units from the anchor centre — not absolute
    // coordinates — so they mean nothing without this decode plus NMS.
    const names = detector.outputNames
    const raw: RawBox[] = []
    for (let si = 0; si < DET_STRIDES.length; si++) {
      const stride = DET_STRIDES[si]
      const scores = outputs[names[si]]?.data as Float32Array | undefined
      const deltas = outputs[names[si + DET_STRIDES.length]]?.data as Float32Array | undefined
      const kpsOut = outputs[names[si + DET_STRIDES.length * 2]]?.data as Float32Array | undefined
      if (!scores || !deltas) continue

      const grid = DET_INPUT / stride
      for (let row = 0; row < grid; row++) {
        for (let col = 0; col < grid; col++) {
          for (let a = 0; a < DET_ANCHORS; a++) {
            const idx = (row * grid + col) * DET_ANCHORS + a
            const conf = scores[idx]
            if (!(conf >= DET_CONF)) continue
            const cx = col * stride
            const cy = row * stride
            const o = idx * 4
            // Landmarks are per-anchor offsets from the same anchor centre,
            // in stride units, exactly like the box distances.
            const kps: Array<[number, number]> = []
            if (kpsOut) {
              const k = idx * 10
              for (let pt = 0; pt < 5; pt++) {
                kps.push([cx + kpsOut[k + pt * 2] * stride, cy + kpsOut[k + pt * 2 + 1] * stride])
              }
            }
            raw.push({
              x1: cx - deltas[o] * stride,
              y1: cy - deltas[o + 1] * stride,
              x2: cx + deltas[o + 2] * stride,
              y2: cy + deltas[o + 3] * stride,
              conf,
              kps
            })
          }
        }
      }
    }

    const detectedBoxes: Array<{ x: number; y: number; w: number; h: number; conf: number; kps: Array<[number, number]> }> = []
    for (const b of nms(raw)) {
      // Back to full-resolution pixels, then to 0..1 fractions for storage.
      const x = Math.max(0, b.x1 / detScale)
      const y = Math.max(0, b.y1 / detScale)
      const w = Math.min(origW - x, (b.x2 - b.x1) / detScale)
      const h = Math.min(origH - y, (b.y2 - b.y1) / detScale)
      if (!Number.isFinite(x) || !Number.isFinite(y) || w < 16 || h < 16) continue
      const aspectRatio = w / h
      if (aspectRatio < 0.4 || aspectRatio > 1.5) continue
      // Landmarks back to full-resolution pixels for the alignment transform.
      const kps = b.kps.map(([kx, ky]) => [kx / detScale, ky / detScale] as [number, number])
      detectedBoxes.push({ x: x / origW, y: y / origH, w: w / origW, h: h / origH, conf: b.conf, kps })
    }

    const detectedFaces: DetectedFace[] = []

    // One full-resolution decode for the whole photo. The previous code ran a
    // fresh sharp pipeline per face, re-decoding the JPEG every time, so this
    // is also less work despite holding the raw buffer.
    let fullRaw: { data: Buffer; width: number; height: number; channels: number } | null = null
    if (detectedBoxes.length > 0) {
      const decoded = await sharp(job.filePath, { failOn: 'none' })
        .rotate()
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      fullRaw = {
        data: decoded.data,
        width: decoded.info.width,
        height: decoded.info.height,
        channels: decoded.info.channels
      }
    }

    for (const box of detectedBoxes.slice(0, 20)) {
      let faceBuf: Buffer | Uint8Array

      if (box.kps.length === 5 && fullRaw) {
        // Warp the five landmarks onto the ArcFace template — the crop the
        // recogniser was actually trained on.
        faceBuf = warpToTemplate(
          fullRaw.data,
          fullRaw.width,
          fullRaw.height,
          fullRaw.channels,
          similarityTransform(box.kps)
        )
      } else {
        // No landmarks: fall back to the padded box rather than drop the face.
        const marginX = box.w * 0.15
        const marginY = box.h * 0.15
        const left = Math.max(0, Math.floor((box.x - marginX) * origW))
        const top = Math.max(0, Math.floor((box.y - marginY) * origH))
        const cropW = Math.min(origW - left, Math.ceil((box.w + 2 * marginX) * origW))
        const cropH = Math.min(origH - top, Math.ceil((box.h + 2 * marginY) * origH))
        if (cropW < 10 || cropH < 10) continue
        faceBuf = await sharp(job.filePath, { failOn: 'none' })
          .rotate()
          .extract({ left, top, width: cropW, height: cropH })
          .resize(ALIGN_SIZE, ALIGN_SIZE, { fit: 'fill' })
          .removeAlpha()
          .raw()
          .toBuffer()
      }

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
      const rawEmb = embTensor?.data as Float32Array | undefined

      // A face row without a usable embedding is worse than no row at all: it
      // can never be clustered, and it used to crash the clusterer outright.
      // Drop the face instead of storing a placeholder.
      if (!rawEmb || rawEmb.length < 512) continue

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
