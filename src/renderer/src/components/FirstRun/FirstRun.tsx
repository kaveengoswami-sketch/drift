import { useState } from 'react'
import { motion } from 'framer-motion'
import { useLibrary } from '@/stores/libraryStore'
import './FirstRun.css'

export default function FirstRun(): JSX.Element {
  const { setSettings, refreshSidebar, refresh, scanProgress } = useLibrary()
  const [adding, setAdding] = useState(false)

  const addFolder = async (): Promise<void> => {
    setAdding(true)
    const folder = await window.drift.addFolder()
    setAdding(false)
    if (folder) {
      setSettings({ firstRunComplete: true })
      await refreshSidebar()
      await refresh()
    }
  }

  return (
    <div className="firstrun">
      <motion.div
        className="firstrun-card glass"
        initial={{ opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 26 }}
      >
        <div className="firstrun-logo">🌊</div>
        <h1>Welcome to Drift</h1>
        <p>
          A fast, beautiful home for your photos and videos.
          <br />
          Pick a folder to get started — Drift will index it and build thumbnails in the background.
        </p>
        <button className="firstrun-cta" onClick={addFolder} disabled={adding}>
          {adding ? 'Waiting for folder…' : 'Add your first photo folder'}
        </button>
        {scanProgress && scanProgress.phase === 'scanning' && scanProgress.total > 0 && (
          <div className="firstrun-progress">
            Scanning {scanProgress.scanned.toLocaleString()} / {scanProgress.total.toLocaleString()}…
          </div>
        )}
        <div className="firstrun-tips">
          <span>💡 Click a photo to open it · scroll to zoom · <kbd>F</kbd> to favorite · <kbd>Esc</kbd> to go back</span>
        </div>
      </motion.div>
    </div>
  )
}
