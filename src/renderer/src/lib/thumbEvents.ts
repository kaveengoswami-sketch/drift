// Per-photo thumbnail readiness notifications.
//
// A tile whose thumb 404'd subscribes to ITS photo id only; when the main
// process reports that thumbnail generated, just that tile refetches once.
// (The v1 design used a global tick that made every failed tile refetch on
// every completed thumbnail — thousands of protocol requests per second on a
// fresh library, enough to crash Chromium's network service.)

const subs = new Map<number, Set<() => void>>()

export function onThumbReady(id: number, cb: () => void): () => void {
  let set = subs.get(id)
  if (!set) {
    set = new Set()
    subs.set(id, set)
  }
  set.add(cb)
  return () => {
    set!.delete(cb)
    if (!set!.size) subs.delete(id)
  }
}

export function initThumbEvents(): void {
  window.drift.onThumbDone((id) => {
    subs.get(id)?.forEach((cb) => cb())
  })
}

// ---- video frame capture gate: one hidden <video> decoder at a time ----

let captureBusy = false
const captureWaiters: (() => void)[] = []

export function acquireCapture(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = (): void => {
      captureBusy = true
      let released = false
      resolve(() => {
        if (released) return
        released = true
        captureBusy = false
        captureWaiters.shift()?.()
      })
    }
    if (!captureBusy) grant()
    else captureWaiters.push(grant)
  })
}
