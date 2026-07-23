# Drift

Apple Photos-inspired photo & video organizer for Windows. Electron + React + TypeScript.

## Dev

```
npm install
npm run dev      # dev mode with main-process watch/restart
npm run build    # bundle main/preload/renderer into out/
npm run dist     # package with electron-builder -> dist/
```

`npm run build` uses esbuild and does **not** typecheck. Run `npx tsc --noEmit` for that.

### Packaging notes

Config lives in `electron-builder.yml`. Two settings there are load-bearing:
`asarUnpack` keeps sharp's `@img/*` prebuilt binaries outside the asar archive
(they can't be `dlopen`'d from inside it), and `npmRebuild: false` stops
electron-builder trying to rebuild native modules from source — there are no VS
build tools on this machine, so a rebuild fails the whole package step.

The app icon is `build/icon.ico`. electron-builder picks it up by convention —
without it the build logs `default Electron icon is used` and the installed app
shows a generic Electron icon in the Start menu and taskbar. Regenerate it with
`npm run icon` (or `python build/make_icon.py`), which renders the official
Variation 4 (Warm Cedar & Sunset Gradient Polaroid) logo and packs multi-res ICO
and PNG assets. `build/` is excluded from the packaged app.

#### The winCodeSign symlink failure

The NSIS step can abort on a non-elevated Windows box with:

```
ERROR: Cannot create symbolic link : A required privilege is not held by the client.
  ...\winCodeSign\<random>\darwin\10.12\lib\libcrypto.dylib
```

electron-builder unpacks a codesigning toolchain that contains macOS `.dylib`
symlinks, and creating symlinks on Windows needs a privilege a normal shell
doesn't have. It fetches that toolchain **even for unsigned builds** — it
resolves the path to `signtool.exe` before it checks whether a certificate
exists, then logs `no signing info identified, signing is skipped` and never
uses it.

Three ways out, cheapest first:

1. **Seed the cache** (no privileges needed). Extraction goes to a random temp
   dir but the finished artifact is cached under a stable name, so a
   pre-populated directory short-circuits the download entirely. 7-Zip already
   extracts all 83 files and only fails on the two symlinks, so the salvaged
   tree is complete — replace the two 0-byte stubs with copies of their targets
   and rename it:
   `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign\winCodeSign-2.6.0`
2. Set `SIGNTOOL_PATH` to any signtool binary — checked *before* the vendor
   download, so it skips the fetch.
3. Enable Windows Developer Mode (Settings → System → For developers), or build
   from an elevated shell.

`dist/win-unpacked/Drift.exe` is produced either way and runs fine — only the
installer step needs this.

#### Installing without the installer

`dist/win-unpacked/` is a loose build output: running the exe from there works,
but the app won't appear in the Start menu or Windows Search, because Windows
only surfaces apps that have a Start Menu shortcut. Copy the folder to
`%LOCALAPPDATA%\Programs\Drift` (where the NSIS installer puts it too, so a
later real install supersedes it cleanly) and drop a shortcut in
`%APPDATA%\Microsoft\Windows\Start Menu\Programs`.

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
- **Trash**: files move to a hidden `.drift-trash` folder inside their source root; auto-purged after the configured retention. Purge deletes the files first, then retires all the rows in one transaction — a row-at-a-time purge that gets interrupted strands rows the scan's reconciliation pass will never revisit.
- **Moves are volume-aware**: `rename()` throws `EXDEV` across drives, so `file-ops` falls back to copy + unlink. Relevant here — the app lives on `D:` and libraries usually don't.
- **IPC trust boundary**: the renderer is sandboxed (`sandbox: true`; the preload only needs `contextBridge` + `ipcRenderer`). Handlers that turn a renderer string into a filesystem write or a shell action — `saveEdited`, `showInExplorer`, `copyToClipboard` — resolve it against an indexed photo path first, and the video-frame cache filename comes from the DB row rather than the renderer, since it becomes a path. Settings keys are checked against `DEFAULT_SETTINGS`.
- **Long scans outlive windows**: `webContents.send()` throws on a destroyed window, and the scan loop is async, so every progress message goes through a guarded send. Otherwise closing the app mid-scan raises an unhandled rejection.
