import { useState, useEffect, useRef, useMemo } from 'react'
import type { Person, Photo } from '@shared/types'
import { onThumbReady } from '@/lib/thumbEvents'

interface PersonCardProps {
  person: Person
  selected: boolean
  onSelect: (id: number, mode: 'single' | 'toggle') => void
  onOpen: (person: Person) => void
  onNameChange: (id: number, name: string) => void
  onMergeDrop: (targetId: number, sourceId: number) => void
  onContextMenu: (e: React.MouseEvent, person: Person) => void
}

/** Tile width / height. 4:5 is the portrait print ratio the whole view is built on. */
const TILE_ASPECT = 0.8
/** Vertical head-room multiplier on the detected box — enough to keep hair and jaw. */
const VERT_PAD = 2.0
/** A face must never fill more than this fraction of the crop width. */
const HORIZ_PAD = 1.45
/** Never crop tighter than this many source pixels: below it, zooming just makes mush. */
const MIN_SOURCE_PX = 260

interface CropStyle {
  width: string
  left: string
  top: string
}

/**
 * Map the detected face box onto the tile without distorting the photo.
 *
 * The old card stretched the whole image to the container (objectFit: 'fill')
 * and then CSS-zoomed it, so every landscape photo arrived squashed before it
 * was ever magnified. Here the image keeps its natural aspect ratio and is
 * simply scaled and offset so the padded face box lands on the tile.
 *
 * Dimensions come from the loaded <img> rather than photos.width/height,
 * because the crop maths has to describe the exact bitmap on screen. It also
 * sidesteps a separate bug: photos.width/height are recorded pre-rotation, so
 * they are transposed for the ~47% of this library carrying EXIF orientation
 * 8. The thumbnail is served already oriented, so its natural size cannot
 * drift from what is rendered.
 */
function computeCrop(pw: number, ph: number, bbox: Person['coverBbox']): CropStyle {

  let cx = 0.5
  let cy = 0.5
  let cropW: number

  if (bbox) {
    cx = bbox.x + bbox.w / 2
    cy = bbox.y + bbox.h / 2
    const faceW = bbox.w * pw
    const faceH = bbox.h * ph
    cropW = Math.max(faceH * VERT_PAD * TILE_ASPECT, faceW * HORIZ_PAD, MIN_SOURCE_PX)
  } else {
    cropW = Math.min(pw, ph * TILE_ASPECT)
  }

  // Can't crop wider than the photo, and can't crop taller than it either.
  cropW = Math.min(cropW, pw, ph * TILE_ASPECT)

  // Rendered image width as a percentage of the tile width.
  const k = (pw / cropW) * 100

  return {
    width: `${k}%`,
    left: `${50 - cx * k}%`,
    top: `${50 - cy * k * (ph / pw) * TILE_ASPECT}%`
  }
}

export default function PersonCard({
  person,
  selected,
  onSelect,
  onOpen,
  onNameChange,
  onMergeDrop,
  onContextMenu
}: PersonCardProps): JSX.Element {
  const [photo, setPhoto] = useState<Photo | null>(null)
  const [nameInput, setNameInput] = useState(person.name || '')
  const [isDragOver, setIsDragOver] = useState(false)
  const [thumbVersion, setThumbVersion] = useState(0)
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setNameInput(person.name || '')
  }, [person.name])

  useEffect(() => {
    let cancelled = false
    window.drift.photosForPerson(person.id).then((photos) => {
      if (!cancelled && photos && photos.length > 0) {
        setDims(null)
        const coverPhoto = person.coverPhotoPath
          ? photos.find((p) => p.path === person.coverPhotoPath) ?? photos[0]
          : photos[0]
        setPhoto(coverPhoto)
      }
    })
    return () => {
      cancelled = true
    }
  }, [person.id, person.coverPhotoPath])

  // The tile crops hard into a small region of the frame, so it needs the
  // largest cached bucket to have real detail to work with. Refetch once the
  // main process reports that bucket has actually been generated.
  useEffect(() => {
    if (!photo) return
    window.drift.ensureThumb(photo.id, ['2048'])
    return onThumbReady(photo.id, () => setThumbVersion((v) => v + 1))
  }, [photo])

  const crop = useMemo(
    () => (dims ? computeCrop(dims.w, dims.h, person.coverBbox) : null),
    [dims, person.coverBbox]
  )

  const thumbUrl = photo
    ? `thumb://t/2048/${photo.hash}${thumbVersion ? `?v=${thumbVersion}` : ''}`
    : null

  const commitName = (): void => {
    const next = nameInput.trim()
    if (next !== (person.name || '')) onNameChange(person.id, next)
  }

  return (
    <div
      className={`person-card${selected ? ' selected' : ''}${isDragOver ? ' drag-over' : ''}`}
      onContextMenu={(e) => onContextMenu(e, person)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('drift/person-id', String(person.id))
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setIsDragOver(false)
        const sourceIdStr = e.dataTransfer.getData('drift/person-id')
        if (sourceIdStr) {
          const sourceId = parseInt(sourceIdStr, 10)
          if (sourceId && sourceId !== person.id) onMergeDrop(person.id, sourceId)
        }
      }}
    >
      <button
        type="button"
        className="person-print"
        aria-label={person.name ? `Open photos of ${person.name}` : 'Open photos of unnamed person'}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey) onSelect(person.id, 'toggle')
          else onOpen(person)
        }}
      >
        {thumbUrl ? (
          <img
            className="person-print-img"
            src={thumbUrl}
            style={crop ?? { visibility: 'hidden' }}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const el = e.currentTarget
              if (el.naturalWidth > 0) setDims({ w: el.naturalWidth, h: el.naturalHeight })
            }}
          />
        ) : (
          <div className="person-print-empty">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
              <circle cx="12" cy="8.5" r="4" />
              <path d="M4.5 21v-1.5a5 5 0 0 1 5-5h5a5 5 0 0 1 5 5V21" />
            </svg>
          </div>
        )}
        {selected && (
          <span className="person-print-check" aria-hidden="true">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M3 8.5l3.2 3L13 4.5" />
            </svg>
          </span>
        )}
      </button>

      <div className="person-mount">
        <input
          ref={inputRef}
          type="text"
          className={`person-caption${person.name ? ' is-named' : ''}`}
          value={nameInput}
          placeholder="Add name"
          spellCheck={false}
          onChange={(e) => setNameInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitName()
              inputRef.current?.blur()
            }
            if (e.key === 'Escape') {
              setNameInput(person.name || '')
              inputRef.current?.blur()
            }
          }}
          onBlur={commitName}
        />
        <span className="person-tally">{person.faceCount}</span>
      </div>
    </div>
  )
}
