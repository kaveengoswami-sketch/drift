import { useEffect, useState, useRef, useMemo } from 'react'
import { useUI, ZOOM_LEVELS } from '@/stores/uiStore'
import { useLibrary } from '@/stores/libraryStore'
import type { ContextMenuItem } from '@/stores/uiStore'
import './Toolbar.css'

/* SVG icon helpers ------------------------------------------------- */
function IconSidebarToggle(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
    </svg>
  )
}

function IconPlus(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <line x1="8" y1="3" x2="8" y2="13" strokeLinecap="round" />
      <line x1="3" y1="8" x2="13" y2="8" strokeLinecap="round" />
    </svg>
  )
}

function IconAspect({ active }: { active: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      {active ? (
        <>
          <rect x="1.5" y="2" width="5.5" height="7" rx="1" />
          <rect x="9" y="2" width="5.5" height="5" rx="1" />
          <rect x="1.5" y="10.5" width="5.5" height="3.5" rx="1" />
          <rect x="9" y="8.5" width="5.5" height="5.5" rx="1" />
        </>
      ) : (
        <>
          <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
          <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
          <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
          <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
        </>
      )}
    </svg>
  )
}

function IconMore(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <circle cx="3.5" cy="8" r="1.3" />
      <circle cx="8" cy="8" r="1.3" />
      <circle cx="12.5" cy="8" r="1.3" />
    </svg>
  )
}

function IconHeart(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M8 13.5C8 13.5 1.5 9.5 1.5 5.5a3 3 0 0 1 6-0.5 3 3 0 0 1 6 0.5c0 4-6.5 8-6.5 8Z" />
    </svg>
  )
}

function IconShare(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M5.5 5L8 2.5 10.5 5" />
      <line x1="8" y1="2.5" x2="8" y2="10" />
      <path d="M4 8v5.5h8V8" />
    </svg>
  )
}

function IconSearch(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="5.8" cy="5.8" r="4.1" />
      <line x1="8.9" y1="8.9" x2="12.5" y2="12.5" />
    </svg>
  )
}

function IconMinimize(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function IconMaximize({ maximized }: { maximized: boolean }): JSX.Element {
  return maximized ? (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="1" y="3" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.1" />
      <path d="M3 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <rect x="1" y="1" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

function IconClose(): JSX.Element {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */

type GroupBy = 'years' | 'months' | 'all'
const GROUP_SEGMENTS: { key: GroupBy; label: string }[] = [
  { key: 'years', label: 'Years' },
  { key: 'months', label: 'Months' },
  { key: 'all', label: 'All Photos' }
]

export default function Toolbar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const photos = useLibrary((s) => s.photos)
  const query = useLibrary((s) => s.query)
  const setQuery = useLibrary((s) => s.setQuery)
  const selection = useLibrary((s) => s.selection)
  const viewerIndex = useLibrary((s) => s.viewerIndex)
  const toggleFavorite = useLibrary((s) => s.toggleFavorite)
  const setSlideshow = useLibrary((s) => s.setSlideshow)
  const selectAll = useLibrary((s) => s.selectAll)
  const refreshSidebar = useLibrary((s) => s.refreshSidebar)
  const albums = useLibrary((s) => s.albums)

  const [search, setSearch] = useState(query.search ?? '')

  const zoom = useUI((s) => s.zoom)
  const aspectMode = useUI((s) => s.aspectMode)
  const groupBy = useUI((s) => s.groupBy)
  const toggleSidebar = useUI((s) => s.toggleSidebar)
  const setZoom = useUI((s) => s.setZoom)
  const setAspectMode = useUI((s) => s.setAspectMode)
  const setGroupBy = useUI((s) => s.setGroupBy)
  const openContextMenu = useUI((s) => s.openContextMenu)
  const setSettingsOpen = useUI((s) => s.setSettingsOpen)

  useEffect(() => {
    window.drift.isMaximized().then(setMaximized)
    return window.drift.onMaximized(setMaximized)
  }, [])

  useEffect(() => {
    setSearch(query.search ?? '')
  }, [query.search])

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [])

  const handleSearchChange = (val: string): void => {
    setSearch(val)
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setQuery({ ...useLibrary.getState().query, search: val || undefined })
    }, 150)
  }

  const toggleAspect = (): void => {
    setAspectMode(aspectMode === 'square' ? 'aspect' : 'square')
  }

  const viewTitle = useMemo(() => {
    if (query.view === 'favorites') return 'Favorites'
    if (query.view === 'recent-added') return 'Recently Added'
    if (query.view === 'recent-viewed') return 'Recently Viewed'
    if (query.view === 'videos') return 'Videos'
    if (query.view === 'trash') return 'Recently Deleted'
    if (query.view === 'album' && query.albumId) {
      const alb = albums.find((a) => a.id === query.albumId)
      return alb ? alb.name : 'Album'
    }
    return 'Library'
  }, [query, albums])

  const dateSubtitle = useMemo(() => {
    if (!photos || photos.length === 0) return ''
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < photos.length; i++) {
      const t = photos[i].dateTaken
      if (t < min) min = t
      if (t > max) max = t
    }
    if (min === Infinity || max === -Infinity) return ''
    const dMin = new Date(min)
    const dMax = new Date(max)
    const monthMin = dMin.toLocaleDateString(undefined, { month: 'short' })
    const monthMax = dMax.toLocaleDateString(undefined, { month: 'short' })
    const yrMin = dMin.getFullYear()
    const yrMax = dMax.getFullYear()

    if (yrMin === yrMax && monthMin === monthMax) {
      return `${dMin.getDate()} - ${dMax.getDate()} ${monthMin} ${yrMin}`
    } else if (yrMin === yrMax) {
      return `${dMin.getDate()} ${monthMin} - ${dMax.getDate()} ${monthMax} ${yrMin}`
    }
    return `${dMin.getDate()} ${monthMin} ${yrMin} - ${dMax.getDate()} ${monthMax} ${yrMax}`
  }, [photos])

  const handlePlusClick = (e: React.MouseEvent): void => {
    openContextMenu(e.clientX, e.clientY, [
      {
        label: 'New Album',
        action: async () => {
          const name = prompt('Album name')
          if (name?.trim()) {
            await window.drift.createAlbum(name.trim())
            refreshSidebar()
          }
        }
      },
      {
        label: 'Add Folder to Library',
        action: async () => {
          await window.drift.addFolder()
          refreshSidebar()
        }
      }
    ])
  }

  const handleMoreClick = (e: React.MouseEvent): void => {
    openContextMenu(e.clientX, e.clientY, [
      { label: 'Start Slideshow (F11)', action: () => setSlideshow(true) },
      { label: 'Select All (Ctrl+A)', action: () => selectAll() },
      { label: 'Settings (Ctrl+,)', action: () => setSettingsOpen(true) }
    ])
  }

  const handleHeartClick = (): void => {
    const ids = Array.from(selection)
    if (ids.length > 0) toggleFavorite(ids)
    else setQuery({ view: 'favorites' })
  }

  const handleShareClick = (e: React.MouseEvent): void => {
    const currentPhoto =
      viewerIndex !== null && photos[viewerIndex]
        ? photos[viewerIndex]
        : (photos.find((p) => selection.has(p.id)) ?? null)

    const items: ContextMenuItem[] = []
    if (currentPhoto) {
      items.push(
        {
          label: 'Copy Image to Clipboard',
          action: () => window.drift.copyToClipboard(currentPhoto.path)
        },
        {
          label: 'Copy File Path',
          action: () => navigator.clipboard.writeText(currentPhoto.path)
        },
        {
          label: 'Reveal in File Explorer',
          action: () => window.drift.showInExplorer(currentPhoto.path)
        }
      )
    } else {
      items.push({
        label: 'Select a photo to share',
        action: () => {}
      })
    }

    openContextMenu(e.clientX, e.clientY, items)
  }

  return (
    <div className="toolbar">
      {/* LEFT: sidebar toggle, plus button, title + subtitle */}
      <div className="toolbar-left">
        <button className="icon-btn tb-btn" onClick={toggleSidebar} title="Toggle Sidebar (Ctrl+B)">
          <IconSidebarToggle />
        </button>
        <button className="icon-btn tb-btn" onClick={handlePlusClick} title="New Album / Add Folder">
          <IconPlus />
        </button>
        <div className="tb-title-block">
          <span className="tb-title">{viewTitle}</span>
          {dateSubtitle && <span className="tb-subtitle">{dateSubtitle}</span>}
        </div>
      </div>

      {/* CENTER: segmented group-by control (Years / Months / All Photos) */}
      <div className="toolbar-center">
        <div className="tb-segments" role="group" aria-label="View grouping">
          {GROUP_SEGMENTS.map(({ key, label }) => (
            <button
              key={key}
              className={`tb-segment${groupBy === key ? ' selected' : ''}`}
              onClick={() => setGroupBy(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* RIGHT: stack/grid icon, zoom slider, more, heart, share, search, caption buttons */}
      <div className="toolbar-right">
        <button
          className={`icon-btn tb-btn${aspectMode === 'aspect' ? ' active' : ''}`}
          onClick={toggleAspect}
          title={aspectMode === 'square' ? 'Switch to aspect-ratio mode' : 'Switch to square mode'}
        >
          <IconAspect active={aspectMode === 'aspect'} />
        </button>
        <input
          type="range"
          className="tb-zoom-slider"
          min={0}
          max={ZOOM_LEVELS.length - 1}
          step={1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          title={`Zoom: ${ZOOM_LEVELS[zoom]}px`}
        />

        <button className="icon-btn tb-btn" onClick={handleMoreClick} title="More actions">
          <IconMore />
        </button>
        <button className="icon-btn tb-btn" onClick={handleHeartClick} title="Favorite selected (F)">
          <IconHeart />
        </button>
        <button className="icon-btn tb-btn" onClick={handleShareClick} title="Share photo">
          <IconShare />
        </button>

        <div className="tb-search">
          <span className="tb-search-icon">
            <IconSearch />
          </span>
          <input
            ref={searchRef}
            type="search"
            placeholder="Search"
            className="tb-search-input"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>

        {/* Windows caption buttons */}
        <div className="tb-caption-buttons">
          <button
            className="tb-caption-btn tb-minimize"
            onClick={() => window.drift.minimize()}
            title="Minimize"
          >
            <IconMinimize />
          </button>
          <button
            className="tb-caption-btn tb-maximize"
            onClick={() => window.drift.maximize()}
            title={maximized ? 'Restore' : 'Maximize'}
          >
            <IconMaximize maximized={maximized} />
          </button>
          <button
            className="tb-caption-btn tb-close"
            onClick={() => window.drift.close()}
            title="Close"
          >
            <IconClose />
          </button>
        </div>
      </div>
    </div>
  )
}

