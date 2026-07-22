import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary, queryKey } from '@/stores/libraryStore'
import { useUI, ZOOM_LEVELS, type ContextMenuItem } from '@/stores/uiStore'
import type { Photo } from '@shared/types'
import { pickBucket, type ThumbPx } from '@shared/types'
import PhotoTile from './PhotoTile'
import './Grid.css'

// ---- layout constants -------------------------------------------------------

// Apple's tight grid gap (spec section 5)
const GAP = 2
// Horizontal padding each side (--grid-pad = 16px)
const PAD = 16
// Height of a date-section header row (px) — spec: 20px header + 8px below
const HEADER_H = 56
// Rows above and below the viewport to keep rendered (virtual-scroll overscan)
const OVERSCAN = 700

// ---- row types for the virtual layout ---------------------------------------

interface HeaderRow {
  type: 'header'
  label: string
  sub: string
  y: number
  height: number
}

// Square-mode tile row
interface TileRow {
  type: 'tiles'
  start: number  // index into photos[]
  count: number
  y: number
  height: number // = tileSize (square) or rowH (aspect)
}

// Aspect-mode justified row — each photo has its own computed width
interface AspectRow {
  type: 'aspect'
  start: number
  count: number
  y: number
  height: number
  // Pixel width for each photo in the row (same length as count)
  widths: number[]
}

type Row = HeaderRow | TileRow | AspectRow

// ---- date-key helpers -------------------------------------------------------

function yearKey(ts: number): string {
  return String(new Date(ts).getFullYear())
}
function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}`
}
function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function yearLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric' })
}
function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}
function dayLabelShort(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

// ---- aspect-mode: justified row builder ------------------------------------
//
// Fills rows to exactly containerWidth. Each row is filled greedily until
// adding the next photo would overshoot. The row is then scaled so the sum
// of widths (plus gaps) equals containerWidth exactly.
// The last row is left-aligned (tiles keep their natural scaled height but
// are not stretched to fill the row).

function buildAspectRows(
  photos: Photo[],
  start: number,
  count: number,
  containerW: number,
  targetH: number,
  initialY: number
): AspectRow[] {
  const rows: AspectRow[] = []
  let y = initialY
  let i = start

  // Returns the natural aspect ratio of a photo, falling back to 1:1
  const ratio = (p: Photo): number =>
    p.width > 0 && p.height > 0 ? p.width / p.height : 1

  const end = start + count

  while (i < end) {
    // Greedily fill a row
    let rowPhotoCount = 1
    let naturalW = ratio(photos[i]) * targetH

    while (i + rowPhotoCount < end) {
      const next = ratio(photos[i + rowPhotoCount]) * targetH
      const totalW = naturalW + next + GAP * rowPhotoCount
      if (totalW > containerW + 0.5) break
      naturalW += next
      rowPhotoCount++
    }

    const isLastRow = i + rowPhotoCount >= end

    // Scale the row so widths fill containerW exactly (unless last row)
    let rowH: number
    let widths: number[]

    if (!isLastRow && rowPhotoCount > 1) {
      // Scale factor: available content width / sum of natural widths
      const gapsW = GAP * (rowPhotoCount - 1)
      const scale = (containerW - gapsW) / naturalW
      rowH = Math.round(targetH * scale)
      widths = Array.from({ length: rowPhotoCount }, (_, k) =>
        Math.round(ratio(photos[i + k]) * rowH)
      )
      // Distribute any 1-px rounding remainder to the last tile in the row
      const used = widths.reduce((a, b) => a + b, 0) + gapsW
      widths[widths.length - 1] += containerW - used
    } else {
      // Last row or single-photo row: left-aligned at targetH
      rowH = targetH
      widths = Array.from({ length: rowPhotoCount }, (_, k) =>
        Math.round(ratio(photos[i + k]) * targetH)
      )
    }

    rows.push({ type: 'aspect', start: i, count: rowPhotoCount, y, height: rowH, widths })
    y += rowH + GAP
    i += rowPhotoCount
  }

  return rows
}

// ---- viewport-driven thumbnail request deduplication -----------------------
//
// Module-level so it survives React re-renders.
//
// This is a signature of the LAST set we sent, NOT a permanent per-id
// blacklist. The main process *replaces* its viewport queue on every report,
// so a photo that scrolled out of view before it was generated is dropped from
// that queue — if we also refused to ever name it again, its tile would stay
// blank forever. Keying on the whole set means we skip the IPC only when
// nothing actually changed, and scrolling back re-requests correctly.
let lastViewportSig = ''
let pendingRafId: number | null = null

// ---- Grid component ---------------------------------------------------------

export default function Grid(): JSX.Element {
  const {
    photos,
    query,
    selection,
    select,
    clearSelection,
    setViewerIndex,
    saveScroll,
    scrollPositions,
    refreshSidebar,
    toggleFavorite
  } = useLibrary()

  const { openContextMenu, askConfirm, zoom, aspectMode, groupBy } = useUI()

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [width, setWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(800)
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  // ---- Container measurement ------------------------------------------------
  //
  // Uses a CALLBACK REF, not a useEffect. The empty-state below returns early,
  // so .grid-scroll is not mounted until photos arrive. A [] dep effect ran
  // once against a null ref, never re-ran, never attached the ResizeObserver,
  // and left width at 0 forever — pinning layout to 2 columns.
  //
  // A callback ref fires whenever the node mounts or unmounts. Measuring
  // synchronously here means the very first painted frame has the real width.
  const attachScroll = useCallback((el: HTMLDivElement | null): void => {
    scrollRef.current = el
    roRef.current?.disconnect()
    roRef.current = null
    if (!el) return
    setWidth(el.clientWidth)
    setViewportH(el.clientHeight)
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setViewportH(el.clientHeight)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  // Cleanup the ResizeObserver on unmount
  useEffect(() => () => roRef.current?.disconnect(), [])

  // Restore scroll position per view
  const qk = queryKey(query)
  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      const saved = scrollPositions.get(qk) ?? 0
      el.scrollTop = saved
      setScrollTop(saved)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qk])

  // ---- Derived layout values ------------------------------------------------

  // Target tile size from the zoom slider (spec section 7b)
  const targetTile = ZOOM_LEVELS[zoom] ?? ZOOM_LEVELS[3]

  // Column count: floor(availableWidth / targetTile), minimum 1.
  // Tiles are then widened evenly to fill the row exactly with no right gap.
  const innerW = Math.max(0, width - PAD * 2)
  const cols = Math.max(1, Math.floor((innerW + GAP) / (targetTile + GAP)))
  // Actual tile size in square mode (tiles fill the row edge to edge)
  const tileSize = width > 0 ? (innerW - GAP * (cols - 1)) / cols : targetTile

  // Computed bucket: smallest THUMB_LADDER entry >= tileSize * devicePixelRatio
  const bucket: ThumbPx = pickBucket(Math.ceil(tileSize * window.devicePixelRatio))

  // ---- Build row layout -------------------------------------------------------

  const { rows, footerY, totalHeight } = useMemo(() => {
    const rows: Row[] = []
    let y = PAD
    if (!photos.length) return { rows, footerY: 0, totalHeight: 0 }

    // Helper: push square-mode tile rows for a slice of photos
    const pushTileRows = (start: number, count: number): void => {
      for (let i = 0; i < count; i += cols) {
        const c = Math.min(cols, count - i)
        rows.push({ type: 'tiles', start: start + i, count: c, y, height: tileSize })
        y += tileSize + GAP
      }
    }

    // Helper: push aspect-mode rows for a slice of photos
    const pushAspectRows = (start: number, count: number): void => {
      const aRows = buildAspectRows(photos, start, count, innerW, tileSize, y)
      for (const r of aRows) rows.push(r)
      if (aRows.length > 0) {
        const last = aRows[aRows.length - 1]
        y = last.y + last.height + GAP
      }
    }

    const pushSlice =
      aspectMode === 'aspect' ? pushAspectRows : pushTileRows

    if (groupBy === 'all') {
      // Continuous, no headers
      pushSlice(0, photos.length)
    } else {
      // Grouped — key function and label functions depend on groupBy
      let keyFn: (ts: number) => string
      let labelFn: (ts: number) => string
      let subFn: (first: number, last: number) => string

      if (groupBy === 'years') {
        keyFn = yearKey
        labelFn = yearLabel
        subFn = (first, last) => {
          const a = dayLabelShort(first)
          const b = dayLabelShort(last)
          return a === b ? a : `${a} - ${b}`
        }
      } else if (groupBy === 'days') {
        keyFn = dayKey
        labelFn = dayLabel
        subFn = (_, last) => dayLabelShort(last)
      } else {
        // months (default)
        keyFn = monthKey
        labelFn = monthLabel
        subFn = (first, last) => {
          const a = dayLabelShort(first)
          const b = dayLabelShort(last)
          return a === b ? a : `${a} - ${b}`
        }
      }

      let i = 0
      while (i < photos.length) {
        const key = keyFn(photos[i].dateTaken)
        let j = i
        while (j < photos.length && keyFn(photos[j].dateTaken) === key) j++

        const sub = subFn(photos[i].dateTaken, photos[j - 1].dateTaken)
        rows.push({ type: 'header', label: labelFn(photos[i].dateTaken), sub, y, height: HEADER_H })
        y += HEADER_H
        pushSlice(i, j - i)
        i = j
      }
    }

    const contentHeight = y + PAD
    const footerY = contentHeight + 16
    return { rows, contentHeight, footerY, totalHeight: footerY + 60 }
  }, [photos, cols, tileSize, aspectMode, groupBy, innerW])

  // ---- Virtual-scroll: only render rows in viewport + overscan ---------------

  const visibleRows = useMemo(() => {
    const top = scrollTop - OVERSCAN
    const bottom = scrollTop + viewportH + OVERSCAN
    return rows.filter((r) => r.y + r.height >= top && r.y <= bottom)
  }, [rows, scrollTop, viewportH])

  const formattedCounts = useMemo(() => {
    if (!photos.length) return ''
    let p = 0
    let v = 0
    for (let i = 0; i < photos.length; i++) {
      if (photos[i].type === 'video') v++
      else p++
    }
    const parts: string[] = []
    if (p > 0) parts.push(`${p.toLocaleString()} Photo${p === 1 ? '' : 's'}`)
    if (v > 0) parts.push(`${v.toLocaleString()} Video${v === 1 ? '' : 's'}`)
    return parts.length ? parts.join(', ') : '0 Items'
  }, [photos])

  // ---- Viewport thumbnail reporting -----------------------------------------
  //
  // Spec CONTRACT (DRIFT_THUMBNAIL_SPEC.md "THE CONTRACT"):
  //   - Call window.drift.thumbViewport(ids, bucket) at most once per animation frame
  //   - ids ordered nearest-to-viewport-centre first
  //   - Keep a Set<`${id}:${bucket}`> and never send a pair twice (dedupe)
  //   - NEVER add a global timer or interval — only per-photo-id events

  const reportViewport = useCallback(
    (currentRows: Row[], currentScrollTop: number, currentViewportH: number, currentBucket: ThumbPx): void => {
      if (pendingRafId !== null) return // already queued for this frame

      pendingRafId = requestAnimationFrame(() => {
        pendingRafId = null

        const centre = currentScrollTop + currentViewportH / 2

        // Collect visible+overscan photo ids with their distance from centre
        const candidates: { id: number; dist: number }[] = []

        for (const row of currentRows) {
          if (row.type === 'header') continue
          const rowCentre = row.y + row.height / 2
          const dist = Math.abs(rowCentre - centre)

          if (row.type === 'tiles') {
            for (let c = 0; c < row.count; c++) {
              const photo = photos[row.start + c]
              if (!photo) continue
              candidates.push({ id: photo.id, dist })
            }
          } else {
            // aspect row
            for (let c = 0; c < row.count; c++) {
              const photo = photos[row.start + c]
              if (!photo) continue
              candidates.push({ id: photo.id, dist })
            }
          }
        }

        // Sort nearest-to-viewport-centre first
        candidates.sort((a, b) => a.dist - b.dist)

        // Send the whole current viewport, ordered nearest-centre first, and
        // skip the IPC only when the set is byte-for-byte what we last sent.
        // Main treats each report as the complete new priority set.
        const ids = candidates.map((c) => c.id)
        const sig = `${currentBucket}:${ids.join(',')}`
        if (sig === lastViewportSig) return
        lastViewportSig = sig

        if (ids.length > 0) {
          window.drift.thumbViewport(ids, currentBucket)
        }
      })
    },
    [photos]
  )

  // Fire viewport report whenever visible rows, scroll position, or bucket changes
  useEffect(() => {
    reportViewport(visibleRows, scrollTop, viewportH, bucket)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, bucket])

  // ---- Scroll handler -------------------------------------------------------

  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    saveScroll(qk, el.scrollTop)
  }, [qk, saveScroll])

  // ---- Keyboard navigation --------------------------------------------------
  //
  // Flattened list of TileRow/AspectRow so arrow-down goes to the same column
  // in the next row (or as close as possible in aspect mode).

  const tileRows = useMemo(
    () => rows.filter((r): r is TileRow | AspectRow => r.type === 'tiles' || r.type === 'aspect'),
    [rows]
  )

  const openPhoto = useCallback(
    (index: number): void => setViewerIndex(index),
    [setViewerIndex]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (!photos.length) return
      const cur = useLibrary.getState().lastSelectedIndex ?? 0
      const rowAt = (i: number): number =>
        tileRows.findIndex((r) => i >= r.start && i < r.start + r.count)
      let next: number

      if (e.key === 'ArrowRight') next = Math.min(cur + 1, photos.length - 1)
      else if (e.key === 'ArrowLeft') next = Math.max(cur - 1, 0)
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = photos.length - 1
      else if (e.key === 'Enter') {
        e.preventDefault()
        openPhoto(cur)
        return
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const ri = rowAt(cur)
        if (ri < 0) {
          next = 0
        } else {
          const row = tileRows[ri]
          const target = tileRows[ri + (e.key === 'ArrowDown' ? 1 : -1)]
          next = target ? target.start + Math.min(cur - row.start, target.count - 1) : cur
        }
      } else return

      e.preventDefault()
      select(photos[next].id, next, 'single')

      // Keep the cursor on screen
      const ri = rowAt(next)
      const el = scrollRef.current
      if (ri >= 0 && el) {
        const r = tileRows[ri]
        if (r.y < el.scrollTop) el.scrollTop = Math.max(0, r.y - PAD)
        else if (r.y + r.height > el.scrollTop + el.clientHeight)
          el.scrollTop = r.y + r.height - el.clientHeight + PAD
      }
    },
    [photos, tileRows, select, openPhoto]
  )

  // ---- Context menu ---------------------------------------------------------

  const tileMenu = useCallback(
    (e: React.MouseEvent, photo: Photo, index: number): void => {
      e.preventDefault()
      const lib = useLibrary.getState()
      const albums = lib.albums
      const ids = lib.selection.has(photo.id) ? [...lib.selection] : [photo.id]
      if (!lib.selection.has(photo.id)) select(photo.id, index, 'single')
      const many = ids.length > 1

      let items: ContextMenuItem[]
      if (query.view === 'trash') {
        items = [
          { label: `Restore ${many ? ids.length + ' items' : ''}`.trim(), action: () => window.drift.restorePhotos(ids) },
          {
            label: 'Delete permanently',
            danger: true,
            action: () =>
              askConfirm({
                title: 'Delete permanently?',
                message: `Permanently delete ${ids.length} item${many ? 's' : ''}? This cannot be undone.`,
                confirmLabel: 'Delete forever',
                danger: true,
                onConfirm: () => window.drift.deleteForever(ids)
              })
          }
        ]
      } else {
        items = [
          { label: 'Open', action: () => openPhoto(index) },
          { label: photo.favorite ? 'Remove from Favorites' : 'Add to Favorites', action: () => toggleFavorite(ids) },
          {
            label: 'Add to album',
            submenu: albums.map((a) => ({
              label: a.name,
              action: async () => {
                await window.drift.addToAlbum(a.id, ids)
                refreshSidebar()
              }
            }))
          },
          ...(query.view === 'album' && query.albumId
            ? [
                {
                  label: 'Remove from album',
                  action: async (): Promise<void> => {
                    await window.drift.removeFromAlbum(query.albumId!, ids)
                    useLibrary.getState().refresh()
                    refreshSidebar()
                  }
                },
                { label: 'Set as album cover', action: (): Promise<void> => window.drift.setAlbumCover(query.albumId!, photo.id) }
              ]
            : []),
          { label: '', separator: true },
          { label: 'Copy image', action: () => window.drift.copyToClipboard(photo.path) },
          { label: 'Show in Explorer', action: () => window.drift.showInExplorer(photo.path) },
          ...(!many
            ? [
                {
                  label: 'Rename\u2026',
                  action: async (): Promise<void> => {
                    const name = prompt('New name', photo.filename)
                    if (name?.trim()) {
                      const err = await window.drift.renamePhoto(photo.id, name.trim())
                      if (err) alert(err)
                    }
                  }
                }
              ]
            : []),
          { label: 'Move to folder\u2026', action: () => window.drift.movePhotos(ids) },
          { label: 'Copy to folder\u2026', action: () => window.drift.copyPhotos(ids) },
          { label: '', separator: true },
          {
            label: `Delete ${many ? ids.length + ' items' : ''}`.trim(),
            danger: true,
            action: () =>
              askConfirm({
                title: 'Move to Recently Deleted?',
                message: `${ids.length} item${many ? 's' : ''} will be moved to Recently Deleted and auto-removed later.`,
                confirmLabel: 'Delete',
                danger: true,
                onConfirm: () => window.drift.trashPhotos(ids)
              })
          }
        ]
      }
      openContextMenu(e.clientX, e.clientY, items)
    },
    [query, select, openPhoto, toggleFavorite, openContextMenu, askConfirm, refreshSidebar]
  )

  // ---- Rubber-band drag selection -------------------------------------------

  const bandStart = useRef<{ x: number; y: number } | null>(null)

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (target.closest('.tile')) return
    const el = scrollRef.current!
    const rect = el.getBoundingClientRect()
    bandStart.current = { x: e.clientX - rect.left, y: e.clientY - rect.top + el.scrollTop }
    if (!e.ctrlKey && !e.shiftKey) clearSelection()
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    if (!bandStart.current) return
    const el = scrollRef.current!
    const rect = el.getBoundingClientRect()
    const cur = { x: e.clientX - rect.left, y: e.clientY - rect.top + el.scrollTop }
    const b = {
      x0: Math.min(bandStart.current.x, cur.x),
      y0: Math.min(bandStart.current.y, cur.y),
      x1: Math.max(bandStart.current.x, cur.x),
      y1: Math.max(bandStart.current.y, cur.y)
    }
    setBand(b)

    // Geometric hit test against the layout
    const hit = new Set<number>()
    for (const row of rows) {
      if (row.type === 'header') continue
      if (row.y + row.height < b.y0 || row.y > b.y1) continue

      if (row.type === 'tiles') {
        for (let c = 0; c < row.count; c++) {
          const x = PAD + c * (tileSize + GAP)
          if (x + tileSize >= b.x0 && x <= b.x1) {
            hit.add(photos[row.start + c].id)
          }
        }
      } else {
        // aspect row: tiles have variable widths
        let x = PAD
        for (let c = 0; c < row.count; c++) {
          const w = row.widths[c]
          if (x + w >= b.x0 && x <= b.x1) {
            hit.add(photos[row.start + c].id)
          }
          x += w + GAP
        }
      }
    }
    useLibrary.setState({ selection: hit, lastSelectedIndex: null })
  }

  const endBand = (): void => {
    bandStart.current = null
    setBand(null)
  }

  // ---- Empty state ----------------------------------------------------------
  //
  // Must return BEFORE we render .grid-scroll so the callback ref never fires
  // against a null width, and so .grid-scroll truly does not mount until photos
  // are available. This is load-bearing — do not move the early return below the
  // scroll container.

  if (!photos.length) {
    return (
      <div className="grid-empty">
        <div className="grid-empty-icon">&#x1F304;</div>
        <div className="grid-empty-title">{query.view === 'trash' ? 'Nothing deleted recently' : 'No photos here'}</div>
        <div className="grid-empty-sub">
          {query.view === 'all' ? 'Add a source folder from the sidebar to start browsing.' : 'Photos will appear here.'}
        </div>
      </div>
    )
  }

  // ---- Render ---------------------------------------------------------------

  return (
    <div
      ref={attachScroll}
      className="grid-scroll"
      // The grid is a multi-select listbox: the container is the single tab
      // stop and arrow keys move within it. Making every tile tabbable would
      // mean pressing Tab 50,000 times to exit the grid.
      role="listbox"
      aria-multiselectable="true"
      aria-label="Photos"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endBand}
      onMouseLeave={endBand}
    >
      <div className="grid-canvas" style={{ height: totalHeight }}>
        {visibleRows.map((row) => {
          if (row.type === 'header') {
            return (
              <div
                key={`h${row.y}`}
                className="grid-header"
                style={{ transform: `translateY(${row.y}px)`, height: row.height }}
              >
                <span className="grid-header-label">{row.label}</span>
                <span className="grid-header-sub">{row.sub}</span>
              </div>
            )
          }

          if (row.type === 'tiles') {
            return Array.from({ length: row.count }, (_, c) => {
              const idx = row.start + c
              const photo = photos[idx]
              return (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  index={idx}
                  width={tileSize}
                  height={tileSize}
                  x={PAD + c * (tileSize + GAP)}
                  y={row.y}
                  selected={selection.has(photo.id)}
                  bucket={bucket}
                  onOpen={openPhoto}
                  onSelect={select}
                  onContextMenu={tileMenu}
                />
              )
            })
          }

          // aspect row — variable-width tiles
          const aspectRow = row
          let x = PAD
          return Array.from({ length: aspectRow.count }, (_, c) => {
            const idx = aspectRow.start + c
            const photo = photos[idx]
            const w = aspectRow.widths[c]
            const tileX = x
            x += w + GAP
            return (
              <PhotoTile
                key={photo.id}
                photo={photo}
                index={idx}
                width={w}
                height={aspectRow.height}
                x={tileX}
                y={aspectRow.y}
                selected={selection.has(photo.id)}
                bucket={bucket}
                onOpen={openPhoto}
                onSelect={select}
                onContextMenu={tileMenu}
              />
            )
          })
        })}

        {formattedCounts && (
          <div className="grid-footer" style={{ transform: `translateY(${footerY}px)` }}>
            <span className="grid-footer-count">{formattedCounts}</span>
          </div>
        )}

        {band && (
          <div
            className="rubber-band"
            style={{ left: band.x0, top: band.y0, width: band.x1 - band.x0, height: band.y1 - band.y0 }}
          />
        )}
      </div>
    </div>
  )
}
