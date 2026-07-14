import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary, queryKey } from '@/stores/libraryStore'
import { useUI, type ContextMenuItem } from '@/stores/uiStore'
import type { Photo } from '@shared/types'
import PhotoTile from './PhotoTile'
import './Grid.css'

const TILE_TARGET = 176
const GAP = 6
const PAD = 16
const HEADER_H = 52
const OVERSCAN = 700

interface HeaderRow {
  type: 'header'
  label: string
  sub: string
  y: number
}
interface TileRow {
  type: 'tiles'
  start: number // index into photos
  count: number
  y: number
}
type Row = HeaderRow | TileRow

function monthLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function Grid(): JSX.Element {
  const { photos, query, selection, select, clearSelection, setViewerIndex, saveScroll, scrollPositions, albums, refreshSidebar, toggleFavorite } =
    useLibrary()
  const { openContextMenu, askConfirm } = useUI()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(800)
  const [band, setBand] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)

  const grouped = query.view === 'all' || query.view === 'folder' || query.view === 'videos' || query.view === 'favorites'

  // observe container size
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setWidth(el.clientWidth)
      setViewportH(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // restore scroll position per view
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

  // ---- layout ----
  const cols = Math.max(2, Math.floor((width - PAD * 2 + GAP) / (TILE_TARGET + GAP)))
  const tile = width > 0 ? (width - PAD * 2 - GAP * (cols - 1)) / cols : TILE_TARGET

  const { rows, totalHeight } = useMemo(() => {
    const rows: Row[] = []
    let y = PAD
    if (!photos.length) return { rows, totalHeight: 0 }

    const pushTiles = (start: number, count: number): void => {
      for (let i = 0; i < count; i += cols) {
        rows.push({ type: 'tiles', start: start + i, count: Math.min(cols, count - i), y })
        y += tile + GAP
      }
    }

    if (grouped) {
      let i = 0
      while (i < photos.length) {
        const d = new Date(photos[i].dateTaken)
        const key = `${d.getFullYear()}-${d.getMonth()}`
        let j = i
        while (j < photos.length) {
          const dj = new Date(photos[j].dateTaken)
          if (`${dj.getFullYear()}-${dj.getMonth()}` !== key) break
          j++
        }
        rows.push({ type: 'header', label: monthLabel(photos[i].dateTaken), sub: dayLabel(photos[i].dateTaken) + (j - i > 1 ? ` – ${dayLabel(photos[j - 1].dateTaken)}` : ''), y })
        y += HEADER_H
        pushTiles(i, j - i)
        i = j
      }
    } else {
      pushTiles(0, photos.length)
    }
    return { rows, totalHeight: y + PAD }
  }, [photos, cols, tile, grouped])

  const visibleRows = useMemo(() => {
    const top = scrollTop - OVERSCAN
    const bottom = scrollTop + viewportH + OVERSCAN
    return rows.filter((r) => {
      const h = r.type === 'header' ? HEADER_H : tile
      return r.y + h >= top && r.y <= bottom
    })
  }, [rows, scrollTop, viewportH, tile])

  const onScroll = useCallback((): void => {
    const el = scrollRef.current
    if (!el) return
    setScrollTop(el.scrollTop)
    saveScroll(qk, el.scrollTop)
  }, [qk, saveScroll])

  // ---- interactions ----
  const openPhoto = useCallback(
    (index: number): void => {
      setViewerIndex(index)
    },
    [setViewerIndex]
  )

  const tileMenu = useCallback(
    (e: React.MouseEvent, photo: Photo, index: number): void => {
      e.preventDefault()
      const lib = useLibrary.getState()
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
                  label: 'Rename…',
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
          { label: 'Move to folder…', action: () => window.drift.movePhotos(ids) },
          { label: 'Copy to folder…', action: () => window.drift.copyPhotos(ids) },
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
    [query, albums, select, openPhoto, toggleFavorite, openContextMenu, askConfirm, refreshSidebar]
  )

  // rubber-band selection
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
    // geometric hit test against layout
    const hit = new Set<number>()
    for (const row of rows) {
      if (row.type !== 'tiles') continue
      if (row.y + tile < b.y0 || row.y > b.y1) continue
      for (let c = 0; c < row.count; c++) {
        const x = PAD + c * (tile + GAP)
        if (x + tile >= b.x0 && x <= b.x1) hit.add(photos[row.start + c].id)
      }
    }
    useLibrary.setState({ selection: hit })
  }
  const endBand = (): void => {
    bandStart.current = null
    setBand(null)
  }

  if (!photos.length) {
    return (
      <div className="grid-empty">
        <div className="grid-empty-icon">🌤️</div>
        <div className="grid-empty-title">{query.view === 'trash' ? 'Nothing deleted recently' : 'No photos here'}</div>
        <div className="grid-empty-sub">
          {query.view === 'all' ? 'Add a source folder from the sidebar to start browsing.' : 'Photos will appear here.'}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="grid-scroll"
      onScroll={onScroll}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={endBand}
      onMouseLeave={endBand}
    >
      <div className="grid-canvas" style={{ height: totalHeight }}>
        {visibleRows.map((row) =>
          row.type === 'header' ? (
            <div key={`h${row.y}`} className="grid-header" style={{ transform: `translateY(${row.y}px)` }}>
              <span className="grid-header-label">{row.label}</span>
              <span className="grid-header-sub">{row.sub}</span>
            </div>
          ) : (
            Array.from({ length: row.count }, (_, c) => {
              const idx = row.start + c
              const photo = photos[idx]
              return (
                <PhotoTile
                  key={photo.id}
                  photo={photo}
                  index={idx}
                  size={tile}
                  x={PAD + c * (tile + GAP)}
                  y={row.y}
                  selected={selection.has(photo.id)}
                  onOpen={openPhoto}
                  onSelect={select}
                  onContextMenu={tileMenu}
                />
              )
            })
          )
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
