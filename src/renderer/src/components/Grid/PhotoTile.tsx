import { memo, useEffect, useRef, useState } from 'react'
import type { Photo, ThumbPx } from '@shared/types'
import { useLibrary } from '@/stores/libraryStore'
import { onThumbReady, acquireCapture } from '@/lib/thumbEvents'

// ---- Props ------------------------------------------------------------------
//
// width and height are separate (aspect mode has non-square tiles).
// bucket is the ThumbPx to use for the thumb:// URL.

interface Props {
  photo: Photo
  index: number
  /** Rendered pixel width of this tile */
  width: number
  /** Rendered pixel height of this tile */
  height: number
  x: number
  y: number
  selected: boolean
  /** Thumbnail pixel bucket, e.g. 256 or 384. Used to build thumb://<bucket>/<hash> */
  bucket: ThumbPx
  onOpen: (index: number) => void
  onSelect: (id: number, index: number, mode: 'single' | 'toggle' | 'range') => void
  onContextMenu: (e: React.MouseEvent, photo: Photo, index: number) => void
}

// ---- Video frame capture semaphore -----------------------------------------
//
// We allow only one hidden <video> decode at a time to avoid saturating the
// media pipeline. Captured ids are tracked module-level so React re-renders do
// not re-attempt a capture that already succeeded.

const captured = new Set<number>()

function fmtDuration(s: number | null): string {
  if (!s) return ''
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

/** Hidden, semaphore-gated video element that grabs one mid-frame as the thumbnail. */
function VideoFrameCapture({ photo }: { photo: Photo }): JSX.Element | null {
  const ref = useRef<HTMLVideoElement>(null)
  const [allowed, setAllowed] = useState(false)
  const releaseRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    acquireCapture().then((release) => {
      if (cancelled) return release()
      releaseRef.current = release
      setAllowed(true)
    })
    return () => {
      cancelled = true
      releaseRef.current?.()
    }
  }, [])

  if (!allowed) return null

  const done = (): void => {
    releaseRef.current?.()
    releaseRef.current = null
  }

  return (
    <video
      ref={ref}
      className="tile-video-capture"
      src={`media://${photo.id}/`}
      muted
      preload="metadata"
      onLoadedMetadata={() => {
        const v = ref.current
        if (v) v.currentTime = Math.min(v.duration / 2, 5)
      }}
      onError={done}
      onSeeked={() => {
        const v = ref.current
        if (!v || captured.has(photo.id)) return done()
        captured.add(photo.id)
        const canvas = document.createElement('canvas')
        const scale = Math.min(1, 1200 / Math.max(v.videoWidth, v.videoHeight))
        canvas.width = Math.round(v.videoWidth * scale)
        canvas.height = Math.round(v.videoHeight * scale)
        canvas.getContext('2d')?.drawImage(v, 0, 0, canvas.width, canvas.height)
        window.drift
          .saveVideoFrame(photo.id, photo.hash, canvas.toDataURL('image/jpeg', 0.82), v.duration)
          .finally(done)
      }}
    />
  )
}

// ---- PhotoTile (inner, wrapped by memo) ------------------------------------

function PhotoTileInner({
  photo,
  index,
  width,
  height,
  x,
  y,
  selected,
  bucket,
  onOpen,
  onSelect,
  onContextMenu
}: Props): JSX.Element {
  const [failed, setFailed] = useState(false)
  const [version, setVersion] = useState(0)
  const isVideo = photo.type === 'video'

  // Ref tracks failed state without capturing a stale closure in the effect.
  const failedRef = useRef(false)
  failedRef.current = failed

  // Subscribe unconditionally so a thumb:done event that fires in the gap
  // between onError() and the next effect commit is not silently dropped.
  // Only act if currently in failed state to avoid spurious re-fetches.
  //
  // This is the ONLY mechanism by which a tile re-requests its thumbnail —
  // it is triggered by a per-photo-id IPC event from the main process, never
  // by a timer or a global sweep.
  useEffect(() => {
    return onThumbReady(photo.id, () => {
      if (!failedRef.current) return
      setFailed(false)
      setVersion((v) => v + 1)
    })
  }, [photo.id])

  // Thumbnail URL: thumb://t/<px>/<hash>
  // The bucket is a member of THUMB_LADDER (e.g. 256, 384, 512...).
  // The literal "t" host is required: 'thumb' is registered as a standard
  // scheme, so Chromium canonicalises the host, and a purely numeric host
  // ("384") becomes an IPv4 address ("0.0.1.128") — which matches no bucket
  // and renders every tile as a broken image.
  // A cache-busting ?v= suffix is appended when the tile was previously in
  // failed state and the main process has just reported the thumb is ready.
  const thumbSrc = `thumb://t/${bucket}/${photo.hash}${version ? `?v=${version}` : ''}`

  const click = (e: React.MouseEvent): void => {
    e.stopPropagation()
    if (e.shiftKey) onSelect(photo.id, index, 'range')
    else if (e.ctrlKey) onSelect(photo.id, index, 'toggle')
    else onOpen(index)
  }

  return (
    <div
      // role="option" is only meaningful on a listbox option. tabIndex -1 keeps
      // the parent listbox (role="listbox") as the single keyboard tab stop.
      role="option"
      tabIndex={-1}
      aria-selected={selected}
      aria-label={photo.filename}
      className={`tile${selected ? ' selected' : ''}`}
      style={{ width, height, transform: `translate(${x}px, ${y}px)` }}
      onClick={click}
      onContextMenu={(e) => onContextMenu(e, photo, index)}
      draggable
      onDragStart={(e) => {
        const lib = useLibrary.getState()
        const ids = lib.selection.has(photo.id) ? [...lib.selection] : [photo.id]
        e.dataTransfer.setData('drift/photo-ids', JSON.stringify(ids))
      }}
    >
      {!failed ? (
        <img
          className="tile-img"
          src={thumbSrc}
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
          alt=""
        />
      ) : (
        <div className="tile-placeholder">{isVideo ? '\u{1F3AC}' : '\u{1F5BC}\uFE0F'}</div>
      )}

      {/* Video frame capture: only when no thumbnail yet */}
      {isVideo && failed && !captured.has(photo.id) && <VideoFrameCapture photo={photo} />}

      {/* Video duration/play badge */}
      {isVideo && (
        <div className="tile-video-badge">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
            <path d="M2 1.5v7l6-3.5z" />
          </svg>
          {photo.duration ? <span>{fmtDuration(photo.duration)}</span> : null}
        </div>
      )}

      {/* Favorite heart indicator (bottom-left) */}
      {!!photo.favorite && (
        <div className="tile-fav">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="#ff5f7a">
            <path d="M12 21s-7.5-4.9-9.9-9.2C.5 8.4 2.4 4.5 6 4.5c2.1 0 3.5 1.1 4.3 2.4L12 9l1.7-2.1c.8-1.3 2.2-2.4 4.3-2.4 3.6 0 5.5 3.9 3.9 7.3C19.5 16.1 12 21 12 21z" />
          </svg>
        </div>
      )}

      {/* Selection checkmark badge — top-right per design spec section 5 */}
      {selected && (
        <div className="tile-check">
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
          >
            <path d="M3 8.5l3.2 3L13 4.5" />
          </svg>
        </div>
      )}

      {/* Hover-reveal heart button — top-left */}
      <button
        className="tile-heart"
        title="Favorite"
        onClick={(e) => {
          e.stopPropagation()
          useLibrary.getState().toggleFavorite([photo.id])
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={photo.favorite ? '#ff5f7a' : 'none'}
          stroke="#fff"
          strokeWidth="2"
        >
          <path d="M12 21s-7.5-4.9-9.9-9.2C.5 8.4 2.4 4.5 6 4.5c2.1 0 3.5 1.1 4.3 2.4L12 9l1.7-2.1c.8-1.3 2.2-2.4 4.3-2.4 3.6 0 5.5 3.9 3.9 7.3C19.5 16.1 12 21 12 21z" />
        </svg>
      </button>
    </div>
  )
}

export default memo(PhotoTileInner)
