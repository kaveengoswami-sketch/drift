import { useState, useEffect, useRef } from 'react'
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
  const [isEditing, setIsEditing] = useState(false)
  const [nameInput, setNameInput] = useState(person.name || '')
  const [isDragOver, setIsDragOver] = useState(false)
  const [thumbVersion, setThumbVersion] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setNameInput(person.name || '')
  }, [person.name])

  useEffect(() => {
    let cancelled = false
    window.drift.photosForPerson(person.id).then((photos) => {
      if (!cancelled && photos && photos.length > 0) {
        setPhoto(photos[0])
      }
    })
    return () => {
      cancelled = true
    }
  }, [person.id])

  // The card zooms into a small face bbox, sometimes 8x — a 512px whole-photo
  // thumbnail (the old fixed size) turns into a handful of blurry pixels once
  // scaled up. Request the largest cached bucket so the crop has real detail
  // to zoom into, and refetch once it's actually been generated.
  useEffect(() => {
    if (!photo) return
    window.drift.ensureThumb(photo.id, ['2048'])
    return onThumbReady(photo.id, () => setThumbVersion((v) => v + 1))
  }, [photo])

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

  const handleNameSubmit = (): void => {
    setIsEditing(false)
    if (nameInput.trim() !== (person.name || '')) {
      onNameChange(person.id, nameInput.trim())
    }
  }

  // Face bbox normalization logic for client-side cropping
  const bbox = person.coverBbox
  const cx = bbox ? bbox.x + bbox.w / 2 : 0.5
  const cy = bbox ? bbox.y + bbox.h / 2 : 0.5
  const faceSize = bbox ? Math.max(bbox.w, bbox.h) * 1.6 : 0.4
  const scale = Math.min(Math.max(1 / Math.max(faceSize, 0.05), 1), 8)
  const translateX = (0.5 - cx) * 100
  const translateY = (0.5 - cy) * 100

  const transformStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'fill',
    transformOrigin: `${cx * 100}% ${cy * 100}%`,
    transform: `translate(${translateX}%, ${translateY}%) scale(${scale})`
  }

  const thumbUrl = photo ? `thumb://t/2048/${photo.hash}${thumbVersion ? `?v=${thumbVersion}` : ''}` : null

  return (
    <div
      className={`person-card ${selected ? 'selected' : ''} ${isDragOver ? 'drag-over' : ''}`}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) onSelect(person.id, 'toggle')
        else onSelect(person.id, 'single')
      }}
      onDoubleClick={() => onOpen(person)}
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
          if (sourceId && sourceId !== person.id) {
            onMergeDrop(person.id, sourceId)
          }
        }
      }}
    >
      <div className="person-avatar-wrap">
        <div className="person-avatar">
          {thumbUrl ? (
            <img src={thumbUrl} alt={person.name || 'Person face'} style={transformStyle} />
          ) : (
            <div className="person-avatar-placeholder">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
          )}
        </div>
      </div>

      <div className="person-info" onClick={(e) => e.stopPropagation()}>
        {isEditing ? (
          <input
            ref={inputRef}
            type="text"
            className="person-name-input"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleNameSubmit()
              if (e.key === 'Escape') {
                setNameInput(person.name || '')
                setIsEditing(false)
              }
            }}
            onBlur={handleNameSubmit}
          />
        ) : (
          <div className="person-name-row">
            {person.name ? (
              <span className="person-name" onClick={() => setIsEditing(true)} title="Click to rename">
                {person.name}
              </span>
            ) : (
              <button className="person-add-name" onClick={() => setIsEditing(true)}>
                Add Name
              </button>
            )}
          </div>
        )}

        <span className="person-count">
          {person.faceCount} {person.faceCount === 1 ? 'photo' : 'photos'}
        </span>
      </div>
    </div>
  )
}
