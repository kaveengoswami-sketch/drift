import { BrowserWindow } from 'electron'
import { Worker } from 'worker_threads'
import path from 'path'
import fs from 'fs'
import type { FaceScanProgress } from '@shared/types'
import * as db from '../database'
import { ensureModels, getModelPaths, hasModels } from './modelManager'
import { runClustering } from './clustering'
import type { ScanJob, ScanResult } from './faceWorker'

const JOB_GAP_MS = 50 // Pacing delay between face scanning jobs to keep CPU load minimal

let currentProgress: FaceScanProgress = {
  scanned: 0,
  total: 0,
  facesFound: 0,
  phase: 'idle'
}

let activeWorker: Worker | null = null
let isCancelled = false
let activeWin: BrowserWindow | null = null

export function getScanProgress(): FaceScanProgress {
  return currentProgress
}

function sendProgress(win: BrowserWindow | null): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  try {
    win.webContents.send('faces:progress', currentProgress)
  } catch {
    // window closed
  }
}

export function cancelFaceScan(): void {
  if (currentProgress.phase === 'scanning' || currentProgress.phase === 'downloading_models') {
    isCancelled = true
    if (activeWorker) {
      try {
        activeWorker.terminate()
      } catch {
        /* ignore */
      }
      activeWorker = null
    }
    currentProgress = { scanned: 0, total: 0, facesFound: 0, phase: 'idle' }
    sendProgress(activeWin)
  }
}

function createWorker(): Worker {
  const workerFile = path.join(__dirname, 'faceWorker.js')
  if (fs.existsSync(workerFile)) {
    return new Worker(workerFile)
  }

  // Fallback for bundled environment: worker thread using inline eval script calling processPhoto dynamically
  const evalScript = `
    const { parentPort } = require('worker_threads');
    let processPhoto;
    parentPort.on('message', async (job) => {
      try {
        if (!processPhoto) {
          const fw = require('./faceWorker.js');
          processPhoto = fw.processPhoto;
        }
        const res = await processPhoto(job);
        parentPort.postMessage(res);
      } catch (err) {
        parentPort.postMessage({ photoId: job.photoId, ok: false, faces: [], error: String(err) });
      }
    });
  `
  return new Worker(evalScript, { eval: true })
}

export async function startFaceScan(win: BrowserWindow): Promise<FaceScanProgress> {
  activeWin = win

  if (currentProgress.phase === 'scanning' || currentProgress.phase === 'downloading_models' || currentProgress.phase === 'clustering') {
    return currentProgress
  }

  isCancelled = false

  try {
    // 1. Model setup phase
    currentProgress = { scanned: 0, total: 0, facesFound: 0, phase: 'downloading_models' }
    sendProgress(win)

    const modelPaths = await ensureModels((_step, _pct) => {
      sendProgress(win)
    })

    if (isCancelled) return currentProgress

    // 2. Fetch unscanned photos from database
    const unscanned = db.getUnscannedPhotos()
    currentProgress = {
      scanned: 0,
      total: unscanned.length,
      facesFound: 0,
      phase: 'scanning'
    }
    sendProgress(win)

    if (unscanned.length === 0) {
      // Run clustering on existing faces if any
      currentProgress.phase = 'clustering'
      sendProgress(win)
      runClustering()
      currentProgress.phase = 'done'
      sendProgress(win)
      return currentProgress
    }

    activeWorker = createWorker()

    let index = 0

    const processNext = (): void => {
      if (isCancelled || !activeWorker) {
        if (activeWorker) {
          activeWorker.terminate()
          activeWorker = null
        }
        currentProgress.phase = 'idle'
        sendProgress(win)
        return
      }

      if (index >= unscanned.length) {
        // Finished scanning all photos
        if (activeWorker) {
          activeWorker.terminate()
          activeWorker = null
        }
        // 3. Run clustering
        currentProgress.phase = 'clustering'
        sendProgress(win)
        runClustering()

        currentProgress.phase = 'done'
        sendProgress(win)

        try {
          win.webContents.send('library:changed')
        } catch {
          /* ignore */
        }
        return
      }

      const photo = unscanned[index]

      const onMessage = (res: ScanResult): void => {
        if (activeWorker) activeWorker.off('message', onMessage)

        if (res.ok && res.faces.length > 0) {
          db.recordFaceScanResult(res.photoId, res.faces)
          currentProgress.facesFound += res.faces.length
        } else {
          // Record 0 faces so photo is marked scanned
          db.recordFaceScanResult(res.photoId, [])
        }

        index++
        currentProgress.scanned = index
        sendProgress(win)

        // Honour pacing gap to avoid hogging CPU
        setTimeout(processNext, JOB_GAP_MS)
      }

      const onError = (err: Error): void => {
        if (activeWorker) activeWorker.off('error', onError)
        console.error('Face worker error on photo', photo.id, err)
        db.recordFaceScanResult(photo.id, [])
        index++
        currentProgress.scanned = index
        sendProgress(win)
        setTimeout(processNext, JOB_GAP_MS)
      }

      activeWorker.once('message', onMessage)
      activeWorker.once('error', onError)

      const job: ScanJob = {
        photoId: photo.id,
        filePath: photo.path,
        detectorPath: modelPaths.detectorPath,
        recognizerPath: modelPaths.recognizerPath
      }

      activeWorker.postMessage(job)
    }

    processNext()
    return currentProgress
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    currentProgress = { scanned: 0, total: 0, facesFound: 0, phase: 'error', error: errorMsg }
    sendProgress(win)
    return currentProgress
  }
}

export async function processPhoto(job: ScanJob): Promise<ScanResult> {
  const { processPhoto: fn } = await import('./faceWorker')
  return fn(job)
}

export { hasModels, runClustering }
