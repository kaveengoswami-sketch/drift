import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLibrary, queryKey } from '@/stores/libraryStore'
import { useUI } from '@/stores/uiStore'
import type { LibraryQuery } from '@shared/types'
import './Sidebar.css'

const LIBRARY_ITEMS: { key: LibraryQuery; label: string; icon: string }[] = [
  { key: { view: 'all' }, label: 'All Photos', icon: '🖼️' },
  { key: { view: 'favorites' }, label: 'Favorites', icon: '❤️' },
  { key: { view: 'recent-added' }, label: 'Recently Added', icon: '🕐' },
  { key: { view: 'recent-viewed' }, label: 'Recently Viewed', icon: '👁️' },
  { key: { view: 'videos' }, label: 'Videos', icon: '🎞️' },
  { key: { view: 'trash' }, label: 'Recently Deleted', icon: '🗑️' }
]

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }): JSX.Element {
  const [open, setOpen] = useState(true)
  return (
    <div className="sb-section">
      <div className="sb-section-header">
        <button className="sb-section-title" onClick={() => setOpen(!open)}>
          <span className={`sb-chevron ${open ? 'open' : ''}`}>▸</span>
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
  const { sidebarCollapsed, openContextMenu, askConfirm } = useUI()
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
          className="sidebar glass"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 240, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36 }}
        >
          <div className="sidebar-inner">
            <Section title="Library">
              {LIBRARY_ITEMS.map((item) => (
                <button
                  key={item.label}
                  className={`sb-item ${queryKey(item.key) === activeKey ? 'active' : ''}`}
                  onClick={() => setQuery(item.key)}
                >
                  <span className="sb-icon">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </Section>

            <Section
              title="Source Folders"
              actions={
                <button className="sb-add" onClick={() => window.drift.addFolder().then(() => refreshSidebar())} title="Add folder">
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
                      <span className="sb-icon">📂</span>
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
                            <span className="sb-icon">📁</span>
                            {sf.name}
                          </button>
                        )
                      })}
                  </div>
                )
              })}
              {!folders.length && <div className="sb-empty">No folders yet</div>}
            </Section>

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
                    <span className="sb-icon">📔</span>
                    <span className="sb-label">{a.name}</span>
                    <span className="sb-count">{a.photoCount}</span>
                  </button>
                )
              })}
              {!albums.length && <div className="sb-empty">No albums yet</div>}
            </Section>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
