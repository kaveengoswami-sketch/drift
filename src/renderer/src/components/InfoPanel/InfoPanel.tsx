import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import type { Photo, PhotoMeta } from '@shared/types'
import { useLibrary } from '@/stores/libraryStore'
import './InfoPanel.css'

function fmtBytes(n: number): string {
  if (n > 1e9) return (n / 1e9).toFixed(2) + ' GB'
  if (n > 1e6) return (n / 1e6).toFixed(1) + ' MB'
  return Math.round(n / 1024) + ' KB'
}

export default function InfoPanel({ photo }: { photo: Photo }): JSX.Element {
  const [meta, setMeta] = useState<PhotoMeta | null>(null)
  const [tagInput, setTagInput] = useState('')
  const allTags = useLibrary((s) => s.tags)
  const refreshSidebar = useLibrary((s) => s.refreshSidebar)

  useEffect(() => {
    setMeta(null)
    window.drift.photoMeta(photo.id).then(setMeta)
  }, [photo.id])

  const addTag = async (): Promise<void> => {
    const t = tagInput.trim()
    if (!t) return
    await window.drift.addTag(photo.id, t)
    setTagInput('')
    window.drift.photoMeta(photo.id).then(setMeta)
    refreshSidebar()
  }

  const suggestions = allTags.filter((t) => tagInput && t.toLowerCase().startsWith(tagInput.toLowerCase()) && !meta?.tags.includes(t)).slice(0, 5)

  return (
    <motion.aside
      className="info-panel glass"
      initial={{ x: 300 }}
      animate={{ x: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34 }}
    >
      <h3 className="ip-title">Info</h3>

      <div className="ip-row">
        <span className="ip-key">Filename</span>
        <span className="ip-val" title={photo.filename}>{photo.filename}</span>
      </div>
      <div className="ip-row">
        <span className="ip-key">Size</span>
        <span className="ip-val">{fmtBytes(photo.size)}</span>
      </div>
      {photo.width > 0 && (
        <div className="ip-row">
          <span className="ip-key">Dimensions</span>
          <span className="ip-val">{photo.width} × {photo.height}</span>
        </div>
      )}
      <div className="ip-row">
        <span className="ip-key">Taken</span>
        <span className="ip-val">{new Date(photo.dateTaken).toLocaleString()}</span>
      </div>
      <div className="ip-row">
        <span className="ip-key">Modified</span>
        <span className="ip-val">{new Date(photo.dateModified).toLocaleString()}</span>
      </div>
      <div className="ip-row">
        <span className="ip-key">Path</span>
        <button className="ip-val ip-link" title="Show in Explorer" onClick={() => window.drift.showInExplorer(photo.path)}>
          {photo.path}
        </button>
      </div>

      {meta?.exif && Object.keys(meta.exif).length > 0 && (
        <>
          <h4 className="ip-subtitle">Camera</h4>
          {meta.exif.Make || meta.exif.Model ? (
            <div className="ip-row">
              <span className="ip-key">Camera</span>
              <span className="ip-val">{String(meta.exif.Make ?? '')} {String(meta.exif.Model ?? '')}</span>
            </div>
          ) : null}
          {meta.exif.FNumber ? (
            <div className="ip-row">
              <span className="ip-key">Exposure</span>
              <span className="ip-val">
                ƒ/{String(meta.exif.FNumber)}
                {meta.exif.ExposureTime ? ` · ${Number(meta.exif.ExposureTime) < 1 ? `1/${Math.round(1 / Number(meta.exif.ExposureTime))}` : meta.exif.ExposureTime}s` : ''}
                {meta.exif.ISO ? ` · ISO ${meta.exif.ISO}` : ''}
              </span>
            </div>
          ) : null}
        </>
      )}

      <h4 className="ip-subtitle">Tags</h4>
      <div className="ip-tags">
        {meta?.tags.map((t) => (
          <span key={t} className="ip-tag">
            {t}
            <button
              onClick={async () => {
                await window.drift.removeTag(photo.id, t)
                window.drift.photoMeta(photo.id).then(setMeta)
              }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
      <div className="ip-tag-input">
        <input
          value={tagInput}
          placeholder="Add tag…"
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') addTag()
            e.stopPropagation()
          }}
        />
        {suggestions.length > 0 && (
          <div className="ip-suggestions glass">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={async () => {
                  await window.drift.addTag(photo.id, s)
                  setTagInput('')
                  window.drift.photoMeta(photo.id).then(setMeta)
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {meta && meta.albums.length > 0 && (
        <>
          <h4 className="ip-subtitle">Albums</h4>
          <div className="ip-tags">
            {meta.albums.map((a) => (
              <span key={a.id} className="ip-tag">{a.name}</span>
            ))}
          </div>
        </>
      )}
    </motion.aside>
  )
}
