import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLibrary } from '@/stores/libraryStore'
import './Slideshow.css'

export default function Slideshow(): JSX.Element {
  const { photos, viewerIndex, settings, setSlideshow, setViewerIndex } = useLibrary()
  const [index, setIndex] = useState(viewerIndex ?? 0)
  const [playing, setPlaying] = useState(true)
  const [controlsVisible, setControlsVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>()

  const advance = useCallback(
    (dir: 1 | -1 = 1): void => {
      setIndex((i) => (i + dir + photos.length) % photos.length)
    },
    [photos.length]
  )

  useEffect(() => {
    if (!playing) return
    const t = setInterval(() => advance(1), Math.max(2, settings.slideshowInterval) * 1000)
    return () => clearInterval(t)
  }, [playing, settings.slideshowInterval, advance])

  useEffect(() => {
    const onMove = (): void => {
      setControlsVisible(true)
      clearTimeout(hideTimer.current)
      hideTimer.current = setTimeout(() => setControlsVisible(false), 2200)
    }
    onMove()
    window.addEventListener('mousemove', onMove)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') advance(1)
      else if (e.key === 'ArrowLeft') advance(-1)
      else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onKey)
      clearTimeout(hideTimer.current)
    }
  }, [advance])

  const photo = photos[index]
  if (!photo) return <></>

  return (
    <div className="slideshow">
      <AnimatePresence mode="sync">
        <motion.div
          key={photo.id}
          className="slideshow-slide"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.8, ease: 'easeInOut' }}
        >
          {photo.type === 'video' ? (
            <video src={`media://${photo.id}/`} autoPlay muted onEnded={() => advance(1)} />
          ) : (
            <img src={`media://${photo.id}/`} alt="" draggable={false} />
          )}
        </motion.div>
      </AnimatePresence>

      <motion.div className="slideshow-controls glass" animate={{ opacity: controlsVisible ? 1 : 0, y: controlsVisible ? 0 : 16 }}>
        <button className="icon-btn" onClick={() => advance(-1)}>⏮</button>
        <button className="icon-btn" onClick={() => setPlaying(!playing)}>{playing ? '⏸' : '▶'}</button>
        <button className="icon-btn" onClick={() => advance(1)}>⏭</button>
        <span className="slideshow-count">{index + 1} / {photos.length}</span>
        <button
          className="icon-btn"
          onClick={() => {
            setSlideshow(false)
            const safeIndex = Math.min(index, photos.length - 1)
            setViewerIndex(safeIndex >= 0 ? safeIndex : null)
          }}
          title="Exit (Esc)"
        >
          ✕
        </button>
      </motion.div>
    </div>
  )
}
