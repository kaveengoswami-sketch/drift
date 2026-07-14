import { useEffect, useState } from 'react'
import { useUI } from '@/stores/uiStore'
import './TitleBar.css'

export default function TitleBar(): JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const { toggleSidebar, setSettingsOpen } = useUI()

  useEffect(() => {
    window.drift.isMaximized().then(setMaximized)
    return window.drift.onMaximized(setMaximized)
  }, [])

  return (
    <header className="titlebar glass">
      <div className="titlebar-left">
        <div className="traffic-lights">
          <button className="tl tl-close" onClick={() => window.drift.close()} title="Close" />
          <button className="tl tl-min" onClick={() => window.drift.minimize()} title="Minimize" />
          <button className="tl tl-max" onClick={() => window.drift.maximize()} title={maximized ? 'Restore' : 'Maximize'} />
        </div>
        <button className="icon-btn" onClick={toggleSidebar} title="Toggle sidebar (Ctrl+B)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
            <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
            <line x1="5.5" y1="2.5" x2="5.5" y2="13.5" />
          </svg>
        </button>
      </div>
      <div className="titlebar-drag">
        <span className="titlebar-title">Drift</span>
      </div>
      <div className="titlebar-right">
        <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings (Ctrl+,)">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
            <circle cx="8" cy="8" r="2.4" />
            <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
          </svg>
        </button>
      </div>
    </header>
  )
}
