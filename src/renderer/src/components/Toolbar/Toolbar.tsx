import { useEffect, useState, useRef } from 'react'
import { useUI, ZOOM_LEVELS } from '@/stores/uiStore'
import { useLibrary } from '@/stores/libraryStore'
import './Toolbar.css'

/* SVG icon helpers ------------------------------------------------- */
function IconAspect({ active }: { active: boolean }): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      {active ? (
        /* aspect mode: variable-height tiles */
        <>
          <rect x="1.5" y="2" width="5.5" height="7" rx="1" />
          <rect x="9" y="2" width="5.5" height="5" rx="1" />
          <rect x="1.5" y="10.5" width="5.5" height="3.5" rx="1" />
          <rect x="9" y="8.5" width="5.5" height="5.5" rx="1" />
        </>
      ) : (
        /* square mode: uniform square tiles */
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

function IconSearch(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="5.8" cy="5.8" r="4.1" />
      <line x1="8.9" y1="8.9" x2="12.5" y2="12.5" />
    </svg>
  )
}

function IconInfo(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6.5" />
      <line x1="8" y1="7" x2="8" y2="11.5" />
      <circle cx="8" cy="4.5" r="0.7" fill="currentColor" stroke="none" />
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

type GroupBy = 'years' | 'months' | 'days' | 'all'
const GROUP_SEGMENTS: { key: GroupBy; label: string }[] = [
  { key: 'years', label: 'Years' },
  { key: 'months', label: 'Months' },
  { key: 'days', label: 'Days' },
  { key: 'all', label: 'All Photos' }
]

export default function Toolbar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const query = useLibrary((s) => s.query)
  const setQuery = useLibrary((s) => s.setQuery)
  const [search, setSearch] = useState(query.search ?? '')

  const zoom = useUI((s) => s.zoom)
  const aspectMode = useUI((s) => s.aspectMode)
  const groupBy = useUI((s) => s.groupBy)
  const infoPanelOpen = useUI((s) => s.infoPanelOpen)
  const setZoom = useUI((s) => s.setZoom)
  const setAspectMode = useUI((s) => s.setAspectMode)
  const setGroupBy = useUI((s) => s.setGroupBy)
  const toggleInfoPanel = useUI((s) => s.toggleInfoPanel)

  useEffect(() => {
    window.drift.isMaximized().then(setMaximized)
    return window.drift.onMaximized(setMaximized)
  }, [])

  useEffect(() => {
    setSearch(query.search ?? '')
  }, [query.search])

  const handleSearchChange = (val: string): void => {
    setSearch(val)
    setQuery({ ...query, search: val || undefined })
  }

  const toggleAspect = (): void => {
    setAspectMode(aspectMode === 'square' ? 'aspect' : 'square')
  }

  return (
    <div className="toolbar">
      {/* LEFT: aspect toggle + zoom slider */}
      <div className="toolbar-left">
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
      </div>

      {/* CENTER: segmented group-by control */}
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

      {/* RIGHT: search, info, share, window controls */}
      <div className="toolbar-right">
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

        <button
          className={`icon-btn tb-btn${infoPanelOpen ? ' active' : ''}`}
          onClick={toggleInfoPanel}
          title="Info (I)"
        >
          <IconInfo />
        </button>
        <button className="icon-btn tb-btn" title="Share">
          <IconShare />
        </button>

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
