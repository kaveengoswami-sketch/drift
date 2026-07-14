# Drift

Apple Photos-inspired photo & video organizer for Windows. Electron + React + TypeScript.

## Dev

```
npm install
npm run dev      # dev mode with main-process watch/restart
npm run dist     # package with electron-builder
```

## Architecture (the parts that matter)

- **Database**: `node:sqlite` (built into Electron's Node runtime — no native module rebuilds). DB + thumbnail cache live in `%APPDATA%/drift/`.
- **Custom protocols**: `thumb://<size>/<hash>` serves cached WebP thumbnails; `media://<photoId>/` streams originals (Range-aware for video seek). Handlers return clean 404s — never throw — because the renderer probes for thumbs that may not exist yet.
- **Thumbnail pipeline** (performance-critical, don't regress):
  - One `worker_thread` running sharp with `cache(false)` + `concurrency(1)` + a 30 ms gap between jobs. Background indexing must never saturate the machine.
  - Scan-time backfill generates **only the 200 px small size** — sharp's shrink-on-load means a small thumb never fully decodes a large original.
  - `medium`/`large` are generated lazily (`ensureThumb`) when a photo is opened; the viewer falls back to the original meanwhile.
  - RAW/HEIC fall back to the embedded EXIF preview via exifr.
  - Video thumbs: the renderer captures a mid-frame from a hidden `<video>`, gated by a **one-slot semaphore** (each capture is a full decoder instance).
- **Thumb readiness events are per-photo-id** (`lib/thumbEvents.ts`). A failed tile retries only when *its* thumbnail completes. A global retry tick once produced enough protocol traffic to crash Chromium's network service — don't reintroduce one.
- **Grid**: custom virtual scroller (`components/Grid`) — absolute-positioned rows computed from a flat layout model; only viewport ± 700 px renders. Hover effects are pure CSS, not animated components.
- **Scanning**: on launch + on folder add; change detection via size/mtime against the SQLite index; content hash = first 64 KB + size + mtime.
- **Trash**: files move to a hidden `.drift-trash` folder inside their source root; auto-purged after the configured retention.
