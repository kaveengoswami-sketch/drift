import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useLibrary } from '@/stores/libraryStore'
import { useUI } from '@/stores/uiStore'
import './Settings.css'

const ACCENTS = ['#6c8cff', '#a86cff', '#ff6c9d', '#ff9d6c', '#6cd9a8', '#4db8e8']
const TRASH_OPTIONS = [7, 14, 30, 60, 90, 0]

function fmtBytes(n: number): string {
  if (n > 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB'
  return Math.round(n / 1024) + ' KB'
}

export default function Settings(): JSX.Element {
  const { settings, setSettings, folders, refreshSidebar } = useLibrary()
  const { setSettingsOpen, askConfirm } = useUI()
  const [cacheSize, setCacheSize] = useState<number | null>(null)
  const [version, setVersion] = useState('')

  useEffect(() => {
    window.drift.cacheSize().then(setCacheSize)
    window.drift.appVersion().then(setVersion)
  }, [])

  const setTheme = (theme: 'dark' | 'light'): void => {
    setSettings({ theme })
    document.documentElement.dataset.theme = theme
  }

  const setAccent = (accentColor: string): void => {
    setSettings({ accentColor })
    document.documentElement.style.setProperty('--accent', accentColor)
    document.documentElement.style.setProperty(
      '--accent-soft',
      accentColor + '38'
    )
  }

  return (
    <div className="dlg-backdrop" onClick={() => setSettingsOpen(false)}>
      <motion.div
        className="settings glass"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="icon-btn" onClick={() => setSettingsOpen(false)}>✕</button>
        </div>

        <div className="settings-body">
          <section>
            <h3>Source Folders</h3>
            {folders.map((f) => (
              <div key={f.id} className="settings-folder">
                <span title={f.path}>{f.path}</span>
                <button
                  className="settings-remove"
                  onClick={() =>
                    askConfirm({
                      title: 'Remove folder?',
                      message: 'Removes it from Drift only — no files are deleted.',
                      confirmLabel: 'Remove',
                      danger: true,
                      onConfirm: async () => {
                        await window.drift.removeFolder(f.id)
                        refreshSidebar()
                        useLibrary.getState().refresh()
                      }
                    })
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div className="settings-row-buttons">
              <button className="editor-btn" onClick={() => window.drift.addFolder().then(() => refreshSidebar())}>
                Add Folder…
              </button>
              <button className="editor-btn" onClick={() => window.drift.rescan()}>
                Rescan Library
              </button>
            </div>
          </section>

          <section>
            <h3>Appearance</h3>
            <div className="settings-row">
              <span>Theme</span>
              <div className="seg">
                <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}>Dark</button>
                <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}>Light</button>
              </div>
            </div>
            <div className="settings-row">
              <span>Accent</span>
              <div className="accent-row">
                {ACCENTS.map((c) => (
                  <button
                    key={c}
                    className={`accent-dot ${settings.accentColor === c ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setAccent(c)}
                  />
                ))}
              </div>
            </div>
            <div className="settings-row">
              <span>Animations</span>
              <div className="seg">
                <button className={settings.animationsEnabled ? 'active' : ''} onClick={() => setSettings({ animationsEnabled: true })}>On</button>
                <button className={!settings.animationsEnabled ? 'active' : ''} onClick={() => setSettings({ animationsEnabled: false })}>Off</button>
              </div>
            </div>
          </section>

          <section>
            <h3>Thumbnails</h3>
            <div className="settings-row">
              <span>Cache size</span>
              <span className="settings-muted">{cacheSize !== null ? fmtBytes(cacheSize) : '…'}</span>
            </div>
            <div className="settings-row-buttons">
              <button
                className="editor-btn"
                onClick={() =>
                  askConfirm({
                    title: 'Clear thumbnail cache?',
                    message: 'Thumbnails will be regenerated on the next scan.',
                    confirmLabel: 'Clear cache',
                    danger: true,
                    onConfirm: async () => {
                      await window.drift.clearCache()
                      setCacheSize(0)
                    }
                  })
                }
              >
                Clear Cache
              </button>
            </div>
          </section>

          <section>
            <h3>Trash</h3>
            <div className="settings-row">
              <span>Auto-delete after</span>
              <select
                value={settings.trashDays}
                onChange={(e) => setSettings({ trashDays: Number(e.target.value) })}
              >
                {TRASH_OPTIONS.map((d) => (
                  <option key={d} value={d}>{d === 0 ? 'Never' : `${d} days`}</option>
                ))}
              </select>
            </div>
          </section>

          <section>
            <h3>Slideshow</h3>
            <div className="settings-row">
              <span>Interval</span>
              <select
                value={settings.slideshowInterval}
                onChange={(e) => setSettings({ slideshowInterval: Number(e.target.value) })}
              >
                {[3, 5, 10, 15, 30].map((s) => (
                  <option key={s} value={s}>{s} seconds</option>
                ))}
              </select>
            </div>
          </section>

          <section>
            <h3>About</h3>
            <div className="settings-row">
              <span>Drift</span>
              <span className="settings-muted">v{version}</span>
            </div>
          </section>
        </div>
      </motion.div>
    </div>
  )
}
