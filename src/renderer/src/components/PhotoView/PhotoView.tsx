import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, animate } from 'framer-motion'
import { useLibrary } from '@/stores/libraryStore'
import { useUI } from '@/stores/uiStore'
import type { Face } from '@shared/types'
import InfoPanel from '../InfoPanel/InfoPanel'
import Editor from '../Editor/Editor'
import FaceChips from './FaceChips'
import './PhotoView.css'
import { copyPhotoToClipboard } from '@/lib/copy'

const SPRING = { type: 'spring', stiffness: 320, damping: 26 } as const
const MAX_ZOOM = 8

/** Where an object-fit: contain image actually lands inside its box. */
function containRect(
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number
): { left: number; top: number; width: number; height: number } {
  const s = Math.min(boxW / imgW, boxH / imgH)
  const width = imgW * s
  const height = imgH * s
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height }
}

export default function PhotoView(): JSX.Element {
  const { photos, viewerIndex, setViewerIndex, toggleFavorite, setSlideshow } = useLibrary()
  const { infoPanelOpen, toggleInfoPanel, filmstripVisible, toggleFilmstrip, editMode, setEditMode, askConfirm } = useUI()
  const index = viewerIndex!
  const photo = photos[index]
  const isVideo = photo?.type === 'video'

  const containerRef = useRef<HTMLDivElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const currentPhotoIdRef = useRef<number | null>(null)
  currentPhotoIdRef.current = photo?.id ?? null

  const scale = useMotionValue(1)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const [fullLoadedPhotoId, setFullLoadedPhotoId] = useState<number | null>(null)
  const [thumbErrorPhotoId, setThumbErrorPhotoId] = useState<number | null>(null)
  const [zoomed, setZoomed] = useState(false)
  const [thumbVersion, setThumbVersion] = useState(0)
  const [faces, setFaces] = useState<Face[]>([])
  const [hoveredFaceId, setHoveredFaceId] = useState<number | null>(null)
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number } | null>(null)

  const fullLoaded = photo ? fullLoadedPhotoId === photo.id : false
  const thumbError = photo ? thumbErrorPhotoId === photo.id : false

  const resetZoom = useCallback((): void => {
    animate(scale, 1, SPRING)
    animate(x, 0, SPRING)
    animate(y, 0, SPRING)
    setZoomed(false)
  }, [scale, x, y])

  // reset on photo change
  useEffect(() => {
    if (!photo) return
    scale.set(1)
    x.set(0)
    y.set(0)
    setZoomed(false)
    window.drift.ensureThumb(photo.id, ['large'])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo?.id])

  useEffect(() => {
    if (!photo) return
    let active = true
    const img = imgRef.current
    if (img) {
      if (img.complete && img.naturalWidth) {
        if (currentPhotoIdRef.current === photo.id) {
          setFullLoadedPhotoId(photo.id)
        }
      } else if (typeof img.decode === 'function') {
        img
          .decode()
          .then(() => {
            if (active && currentPhotoIdRef.current === photo.id) {
              setFullLoadedPhotoId(photo.id)
            }
          })
          .catch(() => {
            // decode aborted or failed
          })
      }
    }
    return () => {
      active = false
    }
  }, [photo?.id])

  useEffect(() => {
    if (!photo) return
    return window.drift.onThumbDone((doneId) => {
      if (doneId === photo.id) {
        setThumbVersion((v) => v + 1)
      }
    })
  }, [photo?.id])

  useEffect(() => {
    if (!photo) return
    let active = true
    setHoveredFaceId(null)
    window.drift.facesForPhoto(photo.id).then((res) => {
      if (active) setFaces(res || [])
    })
    return () => {
      active = false
    }
  }, [photo?.id])

  // The media wrap is inset inside the stage and the image is letterboxed inside
  // *that*, so the ring needs the wrap's box to place a highlight on the photo.
  //
  // The wrap is measured by query rather than by ref. It's an AnimatePresence
  // child under mode="popLayout", and popLayout clones the child to attach its
  // own measuring ref — which discards any ref passed here, so `wrapRef` stays
  // null forever and the ring silently never renders.
  //
  // offsetWidth/Height rather than getBoundingClientRect: the wrap carries a
  // mount scale animation and the zoom/pan transform, and those change the
  // visual rect while leaving the layout box (which is what the letterbox maths
  // needs) untouched.
  useEffect(() => {
    const stage = containerRef.current
    if (!stage) return
    const measure = (): void => {
      const el = stage.querySelector('.viewer-media-wrap') as HTMLElement | null
      if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
        setWrapSize({ w: el.offsetWidth, h: el.offsetHeight })
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(stage)
    return () => ro.disconnect()
  }, [photo?.id, infoPanelOpen, filmstripVisible])

  const hoveredFace = hoveredFaceId === null ? null : faces.find((f) => f.id === hoveredFaceId) ?? null

  const imageRect = useMemo(
    () =>
      wrapSize && photo?.width && photo?.height
        ? containRect(wrapSize.w, wrapSize.h, photo.width, photo.height)
        : null,
    [wrapSize, photo?.width, photo?.height]
  )
  const detachFace = useCallback(
    (f: Face): void => {
      askConfirm({
        title: 'Detach face?',
        message: `Remove "${f.personName || 'this face'}" assignment from this person?`,
        confirmLabel: 'Detach',
        danger: true,
        onConfirm: async () => {
          await window.drift.detachFace(f.id)
          const updated = await window.drift.facesForPhoto(f.photoId)
          setFaces(updated)
        }
      })
    },
    [askConfirm]
  )

  const navigate = useCallback(
    (dir: 1 | -1): void => {
      const next = index + dir
      if (next >= 0 && next < photos.length) setViewerIndex(next)
    },
    [index, photos.length, setViewerIndex]
  )

  const zoomTo = useCallback(
    (target: number, cx?: number, cy?: number): void => {
      const el = containerRef.current
      if (!el) return
      const clamped = Math.max(1, Math.min(MAX_ZOOM, target))
      const rect = el.getBoundingClientRect()
      const px = cx !== undefined ? cx - rect.left - rect.width / 2 : 0
      const py = cy !== undefined ? cy - rect.top - rect.height / 2 : 0
      const prev = scale.get()
      const ratio = clamped / prev
      const nx = clamped <= 1 ? 0 : px - (px - x.get()) * ratio
      const ny = clamped <= 1 ? 0 : py - (py - y.get()) * ratio
      animate(scale, clamped, SPRING)
      animate(x, nx, SPRING)
      animate(y, ny, SPRING)
      setZoomed(clamped > 1.01)
    },
    [scale, x, y]
  )

  // wheel: zoom (or swipe-navigate at fit)
  const onWheel = useCallback(
    (e: React.WheelEvent): void => {
      if (isVideo) return
      if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        const factor = Math.exp(-e.deltaY * 0.0022)
        zoomTo(scale.get() * factor, e.clientX, e.clientY)
      } else if (scale.get() <= 1.01 && Math.abs(e.deltaX) > 30) {
        navigate(e.deltaX > 0 ? 1 : -1)
      }
    },
    [zoomTo, scale, navigate, isVideo]
  )

  // drag to pan when zoomed
  const dragState = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button === 3) return navigate(-1)
    if (e.button === 4) return navigate(1)
    if (scale.get() <= 1.01) return
    dragState.current = { px: e.clientX, py: e.clientY, ox: x.get(), oy: y.get() }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent): void => {
    if (!dragState.current) return
    x.set(dragState.current.ox + e.clientX - dragState.current.px)
    y.set(dragState.current.oy + e.clientY - dragState.current.py)
  }
  const onPointerUp = (): void => {
    dragState.current = null
  }

  const onDoubleClick = (e: React.MouseEvent): void => {
    if (isVideo) return
    if (scale.get() > 1.01) resetZoom()
    else {
      const img = imgRef.current
      const natural = img && img.naturalWidth && img.clientWidth ? img.naturalWidth / img.clientWidth : 2.5
      zoomTo(Math.max(1.5, natural), e.clientX, e.clientY)
    }
  }

  // viewer-scoped keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (useUI.getState().editMode) return
      if (e.key === 'Escape') setViewerIndex(null)
      else if (e.key === 'ArrowLeft') navigate(-1)
      else if (e.key === 'ArrowRight') navigate(1)
      else if (e.key === '+' || e.key === '=') zoomTo(scale.get() * 1.4)
      else if (e.key === '-') zoomTo(scale.get() / 1.4)
      else if (e.key === '0') resetZoom()
      else if (e.key === '1') {
        const img = imgRef.current
        if (img && img.naturalWidth && img.clientWidth) zoomTo(img.naturalWidth / img.clientWidth)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, zoomTo, resetZoom, scale, setViewerIndex])

  if (!photo) return <></>

  const doDelete = (): void => {
    askConfirm({
      title: 'Move to Recently Deleted?',
      message: `"${photo.filename}" will be moved to Recently Deleted.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        await window.drift.trashPhotos([photo.id])
        // photos hasn't refreshed yet; navigate using pre-delete snapshot.
        // App.tsx guards photos[viewerIndex] so an OOB index will auto-close
        // the viewer once refresh settles, but we eagerly navigate for UX.
        if (index >= photos.length - 1) {
          setViewerIndex(photos.length > 1 ? index - 1 : null)
        }
        // else: stay at same index — the next photo will occupy it after refresh
      }
    })
  }

  return (
    <motion.div
      className="viewer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) setViewerIndex(null)
      }}
    >
      <div className="viewer-layout">
        <div
          ref={containerRef}
          className={`viewer-stage ${zoomed ? 'zoomed' : ''}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onDoubleClick={onDoubleClick}
          onClick={(e) => {
            if (e.target === e.currentTarget) setViewerIndex(null)
          }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div
              key={photo.id}
              ref={wrapRef}
              className="viewer-media-wrap"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
              style={{ x, y, scale }}
            >
              {isVideo ? (
                <video key={`video-${photo.id}`} className="viewer-media" src={`media://${photo.id}/`} controls autoPlay />
              ) : (
                <>
                  {/* progressive: large thumb on top layer (z-index 2), fades out on load or error */}
                  <img
                    key={`thumb-${photo.id}`}
                    className="viewer-media viewer-media-thumb"
                    src={`thumb://t/1024/${photo.hash}${thumbVersion ? `?v=${thumbVersion}` : ''}`}
                    draggable={false}
                    alt=""
                    onError={() => {
                      if (currentPhotoIdRef.current === photo.id) {
                        setThumbErrorPhotoId(photo.id)
                      }
                    }}
                    style={{
                      opacity: fullLoaded || thumbError ? 0 : 1,
                      pointerEvents: 'none'
                    }}
                  />
                  {/* full-res image on bottom layer (z-index 1), always opacity 1 */}
                  <img
                    key={`media-${photo.id}`}
                    ref={imgRef}
                    className="viewer-media viewer-media-full"
                    src={`media://${photo.id}/`}
                    draggable={false}
                    alt=""
                    onLoad={() => {
                      if (currentPhotoIdRef.current === photo.id) {
                        setFullLoadedPhotoId(photo.id)
                      }
                    }}
                    style={{
                      opacity: 1
                    }}
                  />
                  {/* Highlight ring — only for the face chip under the cursor, so
                      the photo itself stays unobstructed while browsing. */}
                  {hoveredFace && imageRect && (
                    <div
                      className="viewer-face-ring-layer"
                      style={{
                        left: imageRect.left,
                        top: imageRect.top,
                        width: imageRect.width,
                        height: imageRect.height
                      }}
                    >
                      <div
                        className="viewer-face-ring"
                        style={{
                          left: `${hoveredFace.bboxX * 100}%`,
                          top: `${hoveredFace.bboxY * 100}%`,
                          width: `${hoveredFace.bboxW * 100}%`,
                          height: `${hoveredFace.bboxH * 100}%`
                        }}
                      />
                    </div>
                  )}
                </>
              )}
            </motion.div>
          </AnimatePresence>

          {/* nav arrows */}
          {index > 0 && (
            <button className="viewer-arrow left" onClick={() => navigate(-1)}>
              ‹
            </button>
          )}
          {index < photos.length - 1 && (
            <button className="viewer-arrow right" onClick={() => navigate(1)}>
              ›
            </button>
          )}

          {/* top bar */}
          <div className="viewer-topbar">
            <button className="viewer-close" onClick={() => setViewerIndex(null)} title="Close (Esc)" aria-label="Close viewer">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 3l10 10M13 3L3 13" />
              </svg>
            </button>
            <span className="viewer-counter">
              {index + 1} of {photos.length}
            </span>
            <span className="viewer-filename">{photo.filename}</span>
          </div>

          {/* bottom toolbar */}
          <div className="viewer-toolbar glass">
            <button className={`icon-btn ${photo.favorite ? 'active' : ''}`} onClick={() => toggleFavorite([photo.id])} title="Favorite (F)">
              <svg width="17" height="17" viewBox="0 0 24 24" fill={photo.favorite ? '#ff5f7a' : 'none'} stroke="currentColor" strokeWidth="1.8">
                <path d="M12 21s-7.5-4.9-9.9-9.2C.5 8.4 2.4 4.5 6 4.5c2.1 0 3.5 1.1 4.3 2.4L12 9l1.7-2.1c.8-1.3 2.2-2.4 4.3-2.4 3.6 0 5.5 3.9 3.9 7.3C19.5 16.1 12 21 12 21z" />
              </svg>
            </button>
            {!isVideo && (
              <button className="icon-btn" onClick={() => setEditMode(true)} title="Edit (E)">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                  <path d="M11 2.5l2.5 2.5L5 13.5l-3 .5.5-3z" />
                </svg>
              </button>
            )}
            <button className="icon-btn" onClick={() => copyPhotoToClipboard(photo.path)} title="Copy to clipboard (Ctrl+C)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="5" y="5" width="9" height="9" rx="1.5" />
                <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" />
              </svg>
            </button>
            <button className="icon-btn" onClick={() => window.drift.showInExplorer(photo.path)} title="Show in Explorer">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M1.5 4.5A1.5 1.5 0 0 1 3 3h3l1.5 1.5H13A1.5 1.5 0 0 1 14.5 6v5A1.5 1.5 0 0 1 13 12.5H3A1.5 1.5 0 0 1 1.5 11z" />
              </svg>
            </button>
            <button className="icon-btn" onClick={() => setSlideshow(true)} title="Slideshow (F11)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M4 2.5v11l9-5.5z" />
              </svg>
            </button>
            <button className={`icon-btn ${filmstripVisible ? 'active' : ''}`} onClick={toggleFilmstrip} title="Filmstrip">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="1.5" y="5" width="3.6" height="6" rx="1" />
                <rect x="6.2" y="5" width="3.6" height="6" rx="1" />
                <rect x="10.9" y="5" width="3.6" height="6" rx="1" />
              </svg>
            </button>
            <button className={`icon-btn ${infoPanelOpen ? 'active' : ''}`} onClick={toggleInfoPanel} title="Info (I)">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <circle cx="8" cy="8" r="6.5" />
                <path d="M8 7.5V11M8 5v.1" strokeLinecap="round" />
              </svg>
            </button>
            <button className="icon-btn" onClick={doDelete} title="Delete">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M2.5 4h11M6.5 2.5h3M4 4l.7 9.3A1.5 1.5 0 0 0 6.2 14.5h3.6a1.5 1.5 0 0 0 1.5-1.2L12 4" />
              </svg>
            </button>
          </div>

          {/* face chips — circular crops tucked in the corner, Apple Photos style */}
          {!isVideo && (
            <div className={`viewer-face-dock${filmstripVisible ? ' with-filmstrip' : ''}`}>
              <FaceChips
                photo={photo}
                faces={faces}
                thumbVersion={thumbVersion}
                hoveredId={hoveredFaceId}
                onHover={setHoveredFaceId}
                onDetach={detachFace}
              />
            </div>
          )}

          {/* filmstrip */}
          {filmstripVisible && (
            <div className="filmstrip">
              {(() => {
                const start = Math.max(0, index - 12)
                return photos.slice(start, Math.min(photos.length, index + 13)).map((p, offset) => {
                  const i = start + offset
                  return (
                    <button
                      key={p.id}
                      className={`filmstrip-thumb ${i === index ? 'current' : ''}`}
                      onClick={() => setViewerIndex(i)}
                    >
                      <img src={`thumb://t/256/${p.hash}`} alt="" draggable={false} />
                    </button>
                  )
                })
              })()}
            </div>
          )}
        </div>

        {infoPanelOpen && <InfoPanel photo={photo} />}
      </div>

      {editMode && !isVideo && <Editor photo={photo} onClose={() => setEditMode(false)} />}
    </motion.div>
  )
}
