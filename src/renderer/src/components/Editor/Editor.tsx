import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Photo } from '@shared/types'
import './Editor.css'

interface RatioPreset {
  id: string
  label: string
  ratio: number | null
}

const PRESETS: RatioPreset[] = [
  { id: 'original', label: 'Original', ratio: null },
  { id: 'square', label: 'Square (1:1)', ratio: 1 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '10:8', label: '10:8', ratio: 10 / 8 },
  { id: '7:5', label: '7:5', ratio: 7 / 5 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '5:3', label: '5:3', ratio: 5 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: 'freeform', label: 'Freeform', ratio: null }
]

interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

type DragHandle = 'create' | 'move' | 'nw' | 'ne' | 'sw' | 'se'

export default function Editor({ photo, onClose }: { photo: Photo; onClose: () => void }): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const [rotation, setRotation] = useState(0) // 0/90/180/270
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)

  const [brightness, setBrightness] = useState(100)
  const [contrast, setContrast] = useState(100)
  const [saturation, setSaturation] = useState(100)

  const [selectedPreset, setSelectedPreset] = useState<string>('original')
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape')
  const [crop, setCrop] = useState<CropBox | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  // load original photo for editor preview
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      imgRef.current = img
      setLoaded(true)
    }
    img.onerror = () => {
      if (cancelled) return
      const fallbackImg = new Image()
      fallbackImg.onload = () => {
        if (cancelled) return
        imgRef.current = fallbackImg
        setLoaded(true)
      }
      fallbackImg.src = `thumb://t/2048/${photo.hash}`
    }
    img.src = `media://${photo.id}/`
    return () => {
      cancelled = true
    }
  }, [photo.id, photo.hash])

  // handle Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // compute current numerical target aspect ratio (width / height)
  const getTargetRatio = useCallback((): number | null => {
    if (selectedPreset === 'freeform') return null

    let baseRatio: number
    const canvas = canvasRef.current
    if (selectedPreset === 'original') {
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null
      baseRatio = canvas.width / canvas.height
    } else {
      const preset = PRESETS.find((p) => p.id === selectedPreset)
      if (!preset || preset.ratio === null) return null
      baseRatio = preset.ratio
    }

    if (selectedPreset === 'square') return 1

    if (orientation === 'portrait') {
      return baseRatio > 1 ? 1 / baseRatio : baseRatio
    } else {
      return baseRatio < 1 ? 1 / baseRatio : baseRatio
    }
  }, [selectedPreset, orientation])

  // draw preview canvas
  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    const stage = stageRef.current
    if (!canvas || !img || !loaded || !stage) return

    const W = img.naturalWidth
    const H = img.naturalHeight
    const isRotated = rotation % 180 !== 0
    const bboxW = isRotated ? H : W
    const bboxH = isRotated ? W : H

    const maxW = Math.max(100, stage.clientWidth - 40)
    const maxH = Math.max(100, stage.clientHeight - 40)
    const s = Math.min(maxW / bboxW, maxH / bboxH, 1)

    canvas.width = Math.max(1, Math.round(bboxW * s))
    canvas.height = Math.max(1, Math.round(bboxH * s))

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.save()
    ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    ctx.drawImage(img, (-W * s) / 2, (-H * s) / 2, W * s, H * s)
    ctx.restore()
  }, [loaded, rotation, flipH, flipV, brightness, contrast, saturation])

  useEffect(() => {
    drawPreview()
  }, [drawPreview])

  // snap crop rectangle to ratio
  const snapCropToRatio = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || canvas.width === 0 || canvas.height === 0) return
    const cw = canvas.width
    const ch = canvas.height
    const targetRatio = getTargetRatio()

    if (targetRatio === null) {
      setCrop({ x: 0, y: 0, w: cw, h: ch })
      return
    }

    let w = cw
    let h = ch
    if (cw / ch > targetRatio) {
      w = ch * targetRatio
    } else {
      h = cw / targetRatio
    }

    w *= 0.95
    h *= 0.95

    const x = (cw - w) / 2
    const y = (ch - h) / 2
    setCrop({ x, y, w, h })
  }, [getTargetRatio])

  // auto snap when photo loads or ratio preset / orientation / rotation changes
  useEffect(() => {
    if (loaded) {
      snapCropToRatio()
    }
  }, [loaded, selectedPreset, orientation, rotation, snapCropToRatio])

  // handle window resize
  useEffect(() => {
    const handleResize = () => drawPreview()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [drawPreview])

  // crop drag state
  const dragRef = useRef<{
    handle: DragHandle
    startX: number
    startY: number
    initialCrop: CropBox | null
  } | null>(null)

  const handleMouseDown = (e: React.MouseEvent, handle: DragHandle) => {
    e.stopPropagation()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    dragRef.current = {
      handle,
      startX: mouseX,
      startY: mouseY,
      initialCrop: crop ? { ...crop } : null
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current || !canvasRef.current) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const cw = canvas.width
    const ch = canvas.height

    const mouseX = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const mouseY = Math.max(0, Math.min(e.clientY - rect.top, rect.height))

    const { handle, startX, startY, initialCrop } = dragRef.current
    const targetRatio = getTargetRatio()

    if (handle === 'move' && initialCrop) {
      const dx = mouseX - startX
      const dy = mouseY - startY
      const newX = Math.max(0, Math.min(initialCrop.x + dx, cw - initialCrop.w))
      const newY = Math.max(0, Math.min(initialCrop.y + dy, ch - initialCrop.h))
      setCrop({ ...initialCrop, x: newX, y: newY })
      return
    }

    if (handle === 'create') {
      const dx = mouseX - startX
      const dy = mouseY - startY
      let w = Math.abs(dx)
      let h = Math.abs(dy)

      if (targetRatio) {
        h = w / targetRatio
        if (mouseY >= startY) {
          if (startY + h > ch) {
            h = ch - startY
            w = h * targetRatio
          }
        } else {
          if (startY - h < 0) {
            h = startY
            w = h * targetRatio
          }
        }
      }

      let x = mouseX >= startX ? startX : startX - w
      let y = mouseY >= startY ? startY : startY - h

      x = Math.max(0, Math.min(x, cw - w))
      y = Math.max(0, Math.min(y, ch - h))

      setCrop({ x, y, w, h })
      return
    }

    if (initialCrop) {
      let { x, y, w, h } = initialCrop
      const dx = mouseX - startX
      const dy = mouseY - startY

      if (handle === 'se') {
        w = Math.max(20, Math.min(cw - x, initialCrop.w + dx))
        if (targetRatio) {
          h = w / targetRatio
          if (y + h > ch) {
            h = ch - y
            w = h * targetRatio
          }
        } else {
          h = Math.max(20, Math.min(ch - y, initialCrop.h + dy))
        }
      } else if (handle === 'sw') {
        w = Math.max(20, Math.min(initialCrop.x + initialCrop.w, initialCrop.w - dx))
        if (targetRatio) {
          h = w / targetRatio
          if (y + h > ch) {
            h = ch - y
            w = h * targetRatio
          }
          x = initialCrop.x + initialCrop.w - w
        } else {
          h = Math.max(20, Math.min(ch - y, initialCrop.h + dy))
          x = initialCrop.x + initialCrop.w - w
        }
      } else if (handle === 'ne') {
        w = Math.max(20, Math.min(cw - x, initialCrop.w + dx))
        if (targetRatio) {
          h = w / targetRatio
          if (h > initialCrop.y + initialCrop.h) {
            h = initialCrop.y + initialCrop.h
            w = h * targetRatio
          }
          y = initialCrop.y + initialCrop.h - h
        } else {
          h = Math.max(20, Math.min(initialCrop.y + initialCrop.h, initialCrop.h - dy))
          y = initialCrop.y + initialCrop.h - h
        }
      } else if (handle === 'nw') {
        w = Math.max(20, Math.min(initialCrop.x + initialCrop.w, initialCrop.w - dx))
        if (targetRatio) {
          h = w / targetRatio
          if (h > initialCrop.y + initialCrop.h) {
            h = initialCrop.y + initialCrop.h
            w = h * targetRatio
          }
          x = initialCrop.x + initialCrop.w - w
          y = initialCrop.y + initialCrop.h - h
        } else {
          h = Math.max(20, Math.min(initialCrop.y + initialCrop.h, initialCrop.h - dy))
          x = initialCrop.x + initialCrop.w - w
          y = initialCrop.y + initialCrop.h - h
        }
      }

      setCrop({ x, y, w, h })
    }
  }

  const handleMouseUp = () => {
    dragRef.current = null
    setCrop((c) => (c && c.w > 8 && c.h > 8 ? c : null))
  }

  const resetAll = () => {
    setRotation(0)
    setFlipH(false)
    setFlipV(false)
    setBrightness(100)
    setContrast(100)
    setSaturation(100)
    setSelectedPreset('original')
    setOrientation('landscape')
  }

  const save = async (): Promise<void> => {
    const img = imgRef.current
    const preview = canvasRef.current
    if (!img || !preview) return
    setSaving(true)

    try {
      const W = img.naturalWidth
      const H = img.naturalHeight
      const isRotated = rotation % 180 !== 0
      const bboxW = isRotated ? H : W
      const bboxH = isRotated ? W : H

      const full = document.createElement('canvas')
      full.width = bboxW
      full.height = bboxH
      const ctx = full.getContext('2d')
      if (!ctx) return

      ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`
      ctx.translate(bboxW / 2, bboxH / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
      ctx.drawImage(img, -W / 2, -H / 2, W, H)

      let out = full
      if (crop && preview.width > 0 && preview.height > 0) {
        const sx = bboxW / preview.width
        const sy = bboxH / preview.height
        const cropped = document.createElement('canvas')
        cropped.width = Math.max(1, Math.round(crop.w * sx))
        cropped.height = Math.max(1, Math.round(crop.h * sy))
        const cctx = cropped.getContext('2d')
        if (cctx) {
          cctx.drawImage(
            full,
            Math.round(crop.x * sx),
            Math.round(crop.y * sy),
            Math.round(crop.w * sx),
            Math.round(crop.h * sy),
            0,
            0,
            cropped.width,
            cropped.height
          )
          out = cropped
        }
      }

      await window.drift.saveEdited(photo.path, out.toDataURL('image/jpeg', 0.93))
    } catch (e) {
      console.error('Failed to save edited photo:', e)
    } finally {
      setSaving(false)
      onClose()
    }
  }

  return (
    <motion.div className="editor" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="editor-stage" ref={stageRef}>
        <div className="editor-canvas-wrap">
          <canvas
            ref={canvasRef}
            onMouseDown={(e) => handleMouseDown(e, 'create')}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          />
          {crop && (
            <div
              className="editor-crop"
              style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }}
              onMouseDown={(e) => handleMouseDown(e, 'move')}
            >
              <div className="crop-handle nw" onMouseDown={(e) => handleMouseDown(e, 'nw')} />
              <div className="crop-handle ne" onMouseDown={(e) => handleMouseDown(e, 'ne')} />
              <div className="crop-handle sw" onMouseDown={(e) => handleMouseDown(e, 'sw')} />
              <div className="crop-handle se" onMouseDown={(e) => handleMouseDown(e, 'se')} />
            </div>
          )}
        </div>
      </div>

      <div className="editor-toolbar glass" style={{ flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
        {/* Transform & Aspect Ratio Presets */}
        <div className="editor-group" style={{ flexWrap: 'wrap', justifyContent: 'center', gap: 6 }}>
          <button className="icon-btn" title="Rotate left" onClick={() => setRotation((r) => (r + 270) % 360)}>⟲</button>
          <button className="icon-btn" title="Rotate right" onClick={() => setRotation((r) => (r + 90) % 360)}>⟳</button>
          <button className={`icon-btn ${flipH ? 'active' : ''}`} title="Flip horizontal" onClick={() => setFlipH(!flipH)}>⇋</button>
          <button className={`icon-btn ${flipV ? 'active' : ''}`} title="Flip vertical" onClick={() => setFlipV(!flipV)}>⇵</button>

          <span style={{ margin: '0 4px', opacity: 0.3 }}>|</span>

          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`editor-ratio ${selectedPreset === p.id ? 'active' : ''}`}
              onClick={() => setSelectedPreset(p.id)}
            >
              {p.label}
            </button>
          ))}

          <span style={{ margin: '0 4px', opacity: 0.3 }}>|</span>

          <button
            className={`editor-ratio ${orientation === 'portrait' ? 'active' : ''}`}
            onClick={() => setOrientation((o) => (o === 'landscape' ? 'portrait' : 'landscape'))}
            disabled={selectedPreset === 'freeform' || selectedPreset === 'square'}
            title="Toggle aspect ratio orientation (Landscape / Portrait)"
          >
            {orientation === 'landscape' ? '↔ Landscape' : '↕ Portrait'}
          </button>
        </div>

        {/* Sliders */}
        <div className="editor-group" style={{ gap: 16, fontSize: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Brightness</span>
            <input
              type="range"
              min={50}
              max={150}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Contrast</span>
            <input
              type="range"
              min={50}
              max={150}
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Saturation</span>
            <input
              type="range"
              min={0}
              max={200}
              value={saturation}
              onChange={(e) => setSaturation(Number(e.target.value))}
            />
          </label>
        </div>

        {/* Action Buttons */}
        <div className="editor-group" style={{ justifyContent: 'flex-end', width: '100%', gap: 8 }}>
          <button className="editor-btn" onClick={resetAll} title="Reset adjustments">
            Reset
          </button>
          <button className="editor-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="editor-btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save copy'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}


