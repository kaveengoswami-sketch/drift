import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useLibrary } from '@/stores/libraryStore'
import { useUI } from '@/stores/uiStore'
import { useModalFocus } from '@/lib/useModalFocus'
import './Settings.css'

import type { FaceScanProgress } from '@shared/types'
import { ACCENTS, applyAccent, resolveAccent } from '@/lib/accent'


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
  const [faceProgress, setFaceProgress] = useState<FaceScanProgress | null>(null)

  useEffect(() => {
    window.drift.cacheSize().then(setCacheSize)
    window.drift.appVersion().then(setVersion)
    window.drift.getFaceScanProgress().then(setFaceProgress)
    return window.drift.onFaceScanProgress((p) => setFaceProgress(p as FaceScanProgress))
  }, [])

  const dlgRef = useModalFocus<HTMLDivElement>()

  const setTheme = (theme: 'dark' | 'light'): void => {
    setSettings({ theme })
    document.documentElement.dataset.theme = theme
  }

  const setAccent = (accentColor: string): void => {
    setSettings({ accentColor })
    applyAccent(accentColor)
  }

  return (
    <div className="dlg-backdrop" role="presentation" onClick={() => setSettingsOpen(false)}>
      <motion.div
        ref={dlgRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="settings glass"
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id="settings-title">Settings</h2>
          <button autoFocus className="icon-btn" onClick={() => setSettingsOpen(false)}>✕</button>
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
                {ACCENTS.map((a) => (
                  <button
                    key={a.value}
                    className={`accent-dot ${resolveAccent(settings.accentColor) === a.value ? 'active' : ''}`}
                    style={{ background: a.value }}
                    title={a.name}
                    aria-label={a.name}
                    onClick={() => setAccent(a.value)}
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
            <h3>Face Recognition</h3>
            <div className="settings-row" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 6 }}>
              <span className="settings-muted" style={{ fontSize: '12px', lineHeight: '1.4' }}>
                On-device machine learning (SCRFD + MobileFaceNet). All face recognition runs 100% locally on your computer and never uploads data anywhere.
              </span>
            </div>
            {faceProgress && faceProgress.phase !== 'idle' && faceProgress.phase !== 'done' && (
              <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 4, margin: '8px 0' }}>
                <div style={{ fontSize: '13px', fontWeight: 500 }}>
                  {faceProgress.phase === 'downloading_models' && 'Downloading face models (~15MB)...'}
                  {faceProgress.phase === 'scanning' && `Scanning photos: ${faceProgress.scanned} / ${faceProgress.total} (${faceProgress.facesFound} faces)`}
                  {faceProgress.phase === 'clustering' && 'Grouping faces into people...'}
                  {faceProgress.phase === 'error' && `Error: ${faceProgress.error}`}
                </div>
                {faceProgress.phase === 'scanning' && faceProgress.total > 0 && (
                  <div style={{ width: '100%', height: 4, background: 'var(--bg-hover)', borderRadius: 999, overflow: 'hidden', marginTop: 4 }}>
                    <div style={{ width: `${Math.min(100, (faceProgress.scanned / faceProgress.total) * 100)}%`, height: '100%', background: 'var(--accent)' }} />
                  </div>
                )}
              </div>
            )}
            <div className="settings-row-buttons">
              {faceProgress && (faceProgress.phase === 'scanning' || faceProgress.phase === 'downloading_models' || faceProgress.phase === 'clustering') ? (
                <button className="editor-btn" onClick={() => window.drift.cancelFaceScan()}>
                  Cancel Scan
                </button>
              ) : (
                <button className="editor-btn" onClick={() => window.drift.startFaceScan()}>
                  Scan for People
                </button>
              )}
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
