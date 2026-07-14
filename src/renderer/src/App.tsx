import { useEffect } from 'react'
import { AnimatePresence } from 'framer-motion'
import { useLibrary } from './stores/libraryStore'
import { useUI } from './stores/uiStore'
import TitleBar from './components/TitleBar/TitleBar'
import Sidebar from './components/Sidebar/Sidebar'
import Grid from './components/Grid/Grid'
import PhotoView from './components/PhotoView/PhotoView'
import Slideshow from './components/Slideshow/Slideshow'
import Settings from './components/Settings/Settings'
import FirstRun from './components/FirstRun/FirstRun'
import ContextMenu from './components/common/ContextMenu'
import ConfirmDialog from './components/common/ConfirmDialog'
import ScanBanner from './components/common/ScanBanner'
import './App.css'

export default function App(): JSX.Element {
  const { settings, folders, viewerIndex, photos, setViewerIndex, slideshow, setSlideshow, toggleFavorite, selection, selectAll, clearSelection } =
    useLibrary()
  const ui = useUI()

  const needsFirstRun = !settings.firstRunComplete && folders.length === 0

  // global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const lib = useLibrary.getState()
      const uiState = useUI.getState()

      if (e.key === 'Escape') {
        if (uiState.contextMenu) uiState.closeContextMenu()
        else if (uiState.confirm) uiState.closeConfirm()
        else if (lib.slideshow) lib.setSlideshow(false)
        else if (uiState.editMode) uiState.setEditMode(false)
        else if (uiState.settingsOpen) uiState.setSettingsOpen(false)
        else if (lib.viewerIndex !== null) lib.setViewerIndex(null)
        else lib.clearSelection()
        return
      }
      if (e.key === 'F11') {
        e.preventDefault()
        lib.setSlideshow(!lib.slideshow)
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        selectAll()
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        window.drift.undo()
        return
      }
      if (e.ctrlKey && e.key === ',') {
        uiState.setSettingsOpen(true)
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        uiState.toggleSidebar()
        return
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'c') {
        const p =
          lib.viewerIndex !== null ? lib.photos[lib.viewerIndex] : lib.photos.find((ph) => lib.selection.has(ph.id))
        if (p) window.drift.copyToClipboard(p.path)
        return
      }
      if (e.key.toLowerCase() === 'f' && !e.ctrlKey) {
        toggleFavorite()
        return
      }
      if (e.key.toLowerCase() === 'i' && lib.viewerIndex !== null) {
        uiState.toggleInfoPanel()
        return
      }
      if (e.key.toLowerCase() === 'e' && lib.viewerIndex !== null) {
        uiState.setEditMode(true)
        return
      }
      if (e.key === 'Delete') {
        const ids = lib.viewerIndex !== null && lib.photos[lib.viewerIndex] ? [lib.photos[lib.viewerIndex].id] : [...lib.selection]
        if (!ids.length) return
        if (lib.query.view === 'trash') {
          uiState.askConfirm({
            title: 'Delete permanently?',
            message: `Permanently delete ${ids.length} item${ids.length > 1 ? 's' : ''}? This cannot be undone.`,
            confirmLabel: 'Delete forever',
            danger: true,
            onConfirm: () => window.drift.deleteForever(ids)
          })
        } else {
          window.drift.trashPhotos(ids)
          if (lib.viewerIndex !== null) lib.setViewerIndex(null)
        }
        return
      }
      if (e.key === ' ' && lib.viewerIndex === null) {
        e.preventDefault()
        const firstSelected = lib.photos.findIndex((p) => lib.selection.has(p.id))
        if (firstSelected >= 0) lib.setViewerIndex(firstSelected)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectAll, toggleFavorite])

  return (
    <div className={`app ${settings.animationsEnabled ? '' : 'no-anim'}`}>
      <TitleBar />
      <div className="app-body">
        {!needsFirstRun && <Sidebar />}
        <main className="app-main">
          {needsFirstRun ? <FirstRun /> : <Grid />}
        </main>
      </div>
      <ScanBanner />
      <AnimatePresence>
        {viewerIndex !== null && photos[viewerIndex] && !slideshow && (
          <PhotoView key="viewer" />
        )}
      </AnimatePresence>
      {slideshow && <Slideshow />}
      {ui.settingsOpen && <Settings />}
      {ui.contextMenu && <ContextMenu />}
      {ui.confirm && <ConfirmDialog />}
    </div>
  )
}
