import { useMemo, useState } from 'react'
import type { Face, Photo } from '@shared/types'

/** Head-room multiplier on the detected box — enough to keep hair and chin in a circle.
 *  Matches PersonCard's effective crop (VERT_PAD 2.0 x TILE_ASPECT 0.8) so a person
 *  reads the same in the strip as on their card. */
const VERT_PAD = 1.6
/** Circles clip the corners, so a face needs a little more side room than a square tile. */
const HORIZ_PAD = 1.55
/** Never crop tighter than this fraction of the short edge: below it the chip is just mush. */
const MIN_CROP_FRACTION = 0.09
/** Chips past this count collapse behind a "+N" button so the corner stays quiet. */
const COLLAPSE_AFTER = 6

interface CropStyle {
  width: string
  left: string
  top: string
}

/**
 * Map a detected face box onto a square chip without distorting the photo.
 *
 * Same approach as PersonCard: the image keeps its natural aspect ratio and is
 * scaled and offset so the padded face box lands on the chip. The crop is a
 * square (the chip is a circle) and is clamped to stay inside the frame, so a
 * face near an edge shows more of its surroundings rather than dead space.
 */
function computeCrop(pw: number, ph: number, f: Face): CropStyle {
  const faceW = f.bboxW * pw
  const faceH = f.bboxH * ph

  let crop = Math.max(faceH * VERT_PAD, faceW * HORIZ_PAD, Math.min(pw, ph) * MIN_CROP_FRACTION)
  crop = Math.min(crop, pw, ph)

  const half = crop / 2
  const cx = Math.min(Math.max((f.bboxX + f.bboxW / 2) * pw, half), pw - half) / pw
  const cy = Math.min(Math.max((f.bboxY + f.bboxH / 2) * ph, half), ph - half) / ph

  // Rendered image width as a percentage of the chip width.
  const k = (pw / crop) * 100

  return {
    width: `${k}%`,
    left: `${50 - cx * k}%`,
    top: `${50 - cy * k * (ph / pw)}%`
  }
}

interface FaceChipsProps {
  photo: Photo
  faces: Face[]
  thumbVersion: number
  hoveredId: number | null
  onHover: (id: number | null) => void
  onDetach: (face: Face) => void
}

export default function FaceChips({
  photo,
  faces,
  thumbVersion,
  hoveredId,
  onHover,
  onDetach
}: FaceChipsProps): JSX.Element | null {
  const [expanded, setExpanded] = useState(false)
  // DB dims are stored post-orientation, but the loaded bitmap is the source of
  // truth for the crop maths — prefer it once we have it.
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null)

  const pw = dims?.w ?? photo.width
  const ph = dims?.h ?? photo.height

  // Biggest face first: whoever the photo is actually of should lead the strip.
  const ordered = useMemo(
    () => [...faces].sort((a, b) => b.bboxW * b.bboxH - a.bboxW * a.bboxH),
    [faces]
  )

  const crops = useMemo(
    () => (pw > 0 && ph > 0 ? ordered.map((f) => computeCrop(pw, ph, f)) : null),
    [ordered, pw, ph]
  )

  if (ordered.length === 0) return null

  const hidden = expanded ? 0 : Math.max(0, ordered.length - COLLAPSE_AFTER)
  const shown = hidden > 0 ? ordered.slice(0, COLLAPSE_AFTER) : ordered
  const src = `thumb://t/1024/${photo.hash}${thumbVersion ? `?v=${thumbVersion}` : ''}`

  return (
    <div className="viewer-face-strip" onMouseLeave={() => onHover(null)}>
      {shown.map((f, i) => (
        <div
          key={f.id}
          className={`face-chip-wrap${hoveredId === f.id ? ' is-hovered' : ''}`}
          onMouseEnter={() => onHover(f.id)}
        >
          <div className="face-chip">
            <img
              className="face-chip-img"
              src={src}
              alt=""
              draggable={false}
              style={crops ? crops[i] : { visibility: 'hidden' }}
              onLoad={(e) => {
                const el = e.currentTarget
                if (el.naturalWidth > 0 && !dims) setDims({ w: el.naturalWidth, h: el.naturalHeight })
              }}
            />
          </div>
          <div className="face-chip-pop">
            <span className={`face-chip-name${f.personName ? '' : ' is-unnamed'}`}>
              {f.personName || 'Unnamed'}
            </span>
            {f.personId !== null && (
              <button
                className="face-chip-detach"
                title="Detach face assignment"
                aria-label={`Detach ${f.personName || 'this face'}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onDetach(f)
                }}
              >
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
                  <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
                </svg>
              </button>
            )}
          </div>
        </div>
      ))}

      {hidden > 0 && (
        <button className="face-chip-more" onClick={() => setExpanded(true)} title="Show all faces">
          +{hidden}
        </button>
      )}
    </div>
  )
}
