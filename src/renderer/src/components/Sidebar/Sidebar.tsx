import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLibrary, queryKey } from '@/stores/libraryStore'
import { useUI } from '@/stores/uiStore'
import type { LibraryQuery } from '@shared/types'
import './Sidebar.css'

/* ---- SVG icons --------------------------------------------------- */
function IconPhotos(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <circle cx="5" cy="6.5" r="1.2" />
      <path d="M1.5 10.5l3-3 2.5 2.5 2.5-2 4.5 4" />
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

function IconClock(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M8 4.5v4l2.5 1.5" />
    </svg>
  )
}

function IconEye(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1.5 8c0 0 2.5-5 6.5-5s6.5 5 6.5 5-2.5 5-6.5 5S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  )
}

function IconVideo(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="3.5" width="9" height="9" rx="1.5" />
      <path d="M10.5 6l4-2.5v9L10.5 10" />
    </svg>
  )
}

function IconTrash(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 4h12M5.5 4V2.5h5V4M6 4v8M10 4v8M3 4l1 9.5h8L13 4" />
    </svg>
  )
}

function IconLock(): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3" y="7" width="10" height="7" rx="1.5" />
      <path d="M5 7V4.5a3 3 0 0 1 6 0V7" />
    </svg>
  )
}

function IconFolder(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1.5 4.5h4l1.5 1.5h7v8h-13V4.5Z" />
    </svg>
  )
}

function IconBook(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2" width="12" height="12" rx="1.5" />
      <line x1="8" y1="2" x2="8" y2="14" />
      <line x1="5" y1="5" x2="7" y2="5" />
      <line x1="5" y1="7.5" x2="7" y2="7.5" />
    </svg>
  )
}

function IconSettings(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="2.2" />
      <path d="M6.5 1.5h3l.4 1.5a5 5 0 0 1 1.2.7l1.5-.5 1.5 2.6-1.1 1.1a5 5 0 0 1 0 1.6l1.1 1.1-1.5 2.6-1.5-.5a5 5 0 0 1-1.2.7l-.4 1.5h-3l-.4-1.5a5 5 0 0 1-1.2-.7l-1.5.5-1.5-2.6 1.1-1.1a5 5 0 0 1 0-1.6L1 6.9l1.5-2.6 1.5.5a5 5 0 0 1 1.2-.7l.4-1.5Z" />
    </svg>
  )
}

function IconPeople(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="5.5" r="2.5" />
      <path d="M2.5 13.5c0-2.5 2.5-4 5.5-4s5.5 1.5 5.5 4" />
    </svg>
  )
}

/* ------------------------------------------------------------------ */

const LIBRARY_ITEMS: { key: LibraryQuery; label: string; Icon: () => JSX.Element; isLocked?: boolean }[] = [
  { key: { view: 'all' },           label: 'All Photos',      Icon: IconPhotos },
  { key: { view: 'favorites' },     label: 'Favorites',       Icon: IconHeart },
  { key: { view: 'people' },        label: 'People',          Icon: IconPeople },
  { key: { view: 'recent-added' },  label: 'Recently Added',  Icon: IconClock },
  { key: { view: 'recent-viewed' }, label: 'Recently Viewed', Icon: IconEye },
  { key: { view: 'videos' },        label: 'Videos',          Icon: IconVideo },
  { key: { view: 'trash' },         label: 'Recently Deleted',Icon: IconTrash, isLocked: true }
]

function Section({
  title,
  children,
  actions
}: {
  title: string
  children: React.ReactNode
  actions?: React.ReactNode
}): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="sb-section">
      <div className="sb-section-header">
        <button className="sb-section-title" onClick={() => setOpen(!open)}>
          <span className={`sb-chevron ${open ? 'open' : ''}`}>&#9658;</span>
          {title}
        </button>
        {actions}
      </div>
      {open && <div className="sb-section-body">{children}</div>}
    </div>
  )
}

export default function Sidebar(): JSX.Element {
  const { query, setQuery, folders, subfolders, albums, refreshSidebar } = useLibrary()
  const { sidebarCollapsed, openContextMenu, askConfirm, setSettingsOpen } = useUI()
  const activeKey = queryKey(query)

  const createAlbum = async (): Promise<void> => {
    const name = prompt('Album name')
    if (name?.trim()) {
      await window.drift.createAlbum(name.trim())
      refreshSidebar()
    }
  }

  const folderMenu = (e: React.MouseEvent, folderId: number): void => {
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY, [
      {
        label: 'Remove from library',
        danger: true,
        action: () =>
          askConfirm({
            title: 'Remove folder?',
            message: 'This removes the folder from Drift. No files on disk will be deleted.',
            confirmLabel: 'Remove',
            danger: true,
            onConfirm: async () => {
              await window.drift.removeFolder(folderId)
              refreshSidebar()
            }
          })
      }
    ])
  }

  const albumMenu = (e: React.MouseEvent, albumId: number, name: string): void => {
    e.preventDefault()
    openContextMenu(e.clientX, e.clientY, [
      {
        label: 'Rename album',
        action: async () => {
          const newName = prompt('Album name', name)
          if (newName?.trim()) {
            await window.drift.renameAlbum(albumId, newName.trim())
            refreshSidebar()
          }
        }
      },
      {
        label: 'Delete album',
        danger: true,
        action: () =>
          askConfirm({
            title: 'Delete album?',
            message: `Delete "${name}"? Photos are not deleted.`,
            confirmLabel: 'Delete',
            danger: true,
            onConfirm: async () => {
              await window.drift.deleteAlbum(albumId)
              refreshSidebar()
            }
          })
      }
    ])
  }

  return (
    <AnimatePresence initial={false}>
      {!sidebarCollapsed && (
        <motion.aside
          className="sidebar"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 200, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.18, ease: [0.32, 0.72, 0, 1] }}
        >
          <div className="sidebar-inner">
            {/* Section 1: Library */}
            <Section title="Library">
              {LIBRARY_ITEMS.map((item) => (
                <button
                  key={item.label}
                  className={`sb-item ${queryKey(item.key) === activeKey ? 'active' : ''}`}
                  onClick={() => setQuery(item.key)}
                >
                  <span className="sb-icon">
                    <item.Icon />
                  </span>
                  <span className="sb-label">{item.label}</span>
                  {item.isLocked && (
                    <span className="sb-lock-icon" title="Protected">
                      <IconLock />
                    </span>
                  )}
                </button>
              ))}
            </Section>

            {/* Section 2: Albums */}
            <Section
              title="Albums"
              actions={
                <button className="sb-add" onClick={createAlbum} title="Create album">
                  +
                </button>
              }
            >
              {albums.map((a) => {
                const aq: LibraryQuery = { view: 'album', albumId: a.id }
                return (
                  <button
                    key={a.id}
                    className={`sb-item ${queryKey(aq) === activeKey ? 'active' : ''}`}
                    onClick={() => setQuery(aq)}
                    onContextMenu={(e) => albumMenu(e, a.id, a.name)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault()
                      const ids = JSON.parse(e.dataTransfer.getData('drift/photo-ids') || '[]') as number[]
                      if (ids.length) {
                        await window.drift.addToAlbum(a.id, ids)
                        refreshSidebar()
                      }
                    }}
                  >
                    <span className="sb-icon">
                      <IconBook />
                    </span>
                    <span className="sb-label">{a.name}</span>
                    <span className="sb-count">{a.photoCount}</span>
                  </button>
                )
              })}
              {!albums.length && <div className="sb-empty">No albums yet</div>}
            </Section>

            {/* Section 3: Folders */}
            <Section
              title="Folders"
              actions={
                <button
                  className="sb-add"
                  onClick={() => window.drift.addFolder().then(() => refreshSidebar())}
                  title="Add folder"
                >
                  +
                </button>
              }
            >
              {folders.map((f) => {
                const fq: LibraryQuery = { view: 'folder', folderId: f.id }
                return (
                  <div key={f.id}>
                    <button
                      className={`sb-item ${queryKey(fq) === activeKey ? 'active' : ''}`}
                      onClick={() => setQuery(fq)}
                      onContextMenu={(e) => folderMenu(e, f.id)}
                      title={f.path}
                    >
                      <span className="sb-icon">
                        <IconFolder />
                      </span>
                      {f.name}
                    </button>
                    {subfolders
                      .filter((sf) => sf.folderId === f.id)
                      .map((sf) => {
                        const sq: LibraryQuery = { view: 'folder', folderPathPrefix: sf.path + '\\' }
                        return (
                          <button
                            key={sf.path}
                            className={`sb-item sb-nested ${queryKey(sq) === activeKey ? 'active' : ''}`}
                            style={{ paddingLeft: 22 + sf.depth * 14 }}
                            onClick={() => setQuery(sq)}
                            title={sf.path}
                          >
                            <span className="sb-icon">
                              <IconFolder />
                            </span>
                            {sf.name}
                          </button>
                        )
                      })}
                  </div>
                )
              })}
              {!folders.length && <div className="sb-empty">No folders yet</div>}
            </Section>
          </div>

          <div className="sb-footer" style={{ padding: '8px 12px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
            <button
              className="sb-item sb-settings-btn"
              onClick={() => setSettingsOpen(true)}
              title="Settings (Ctrl+,)"
              style={{ width: '100%' }}
            >
              <span className="sb-icon">
                <IconSettings />
              </span>
              <span className="sb-label">Settings</span>
            </button>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
