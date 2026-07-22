import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import type { Photo } from '@shared/types'
import './Editor.css'

const RATIOS: { label: string; value: number | null }[] = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '3:2', value: 3 / 2 }
]

interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

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

  const [ratio, setRatio] = useState<number | null>(null)
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
    // Appending 'a' prevents Chromium standard-scheme IPv4 host canonicalization for numeric hosts
    img.src = `media://${photo.id}a/`
    return () => {
      cancelled = true
    }
  }, [photo.id, photo.hash])

  // draw preview
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

  // handle window resize
  useEffect(() => {
    const handleResize = () => drawPreview()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [drawPreview])

  // ratio button selection
  const handleRatioSelect = (val: number | null) => {
    setRatio(val)
    const canvas = canvasRef.current
    if (!canvas || val === null) {
      setCrop(null)
      return
    }
    const cw = canvas.width
    const ch = canvas.height
    let w = cw
    let h = ch
    if (cw / ch > val) {
      w = ch * val
    } else {
      h = cw / val
    }
    w *= 0.85
    h *= 0.85
    const x = (cw - w) / 2
    const y = (ch - h) / 2
    setCrop({ x, y, w, h })
  }

  // crop drag
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const onCanvasMouseDown = (e: React.MouseEvent): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    dragRef.current = { startX: e.clientX - rect.left, startY: e.clientY - rect.top }
    setCrop(null)
  }

  const onCanvasMouseMove = (e: React.MouseEvent): void => {
    if (!dragRef.current || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const cx = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const cy = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
    let w = Math.abs(cx - dragRef.current.startX)
    let h = Math.abs(cy - dragRef.current.startY)
    if (ratio) {
      h = w / ratio
    }
    const x = Math.min(dragRef.current.startX, cx)
    const y = Math.min(dragRef.current.startY, cy)
    setCrop({ x, y, w, h })
  }

  const onCanvasMouseUp = (): void => {
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
    setRatio(null)
    setCrop(null)
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
            onMouseDown={onCanvasMouseDown}
            onMouseMove={onCanvasMouseMove}
            onMouseUp={onCanvasMouseUp}
            onMouseLeave={onCanvasMouseUp}
          />
          {crop && (
            <div className="editor-crop" style={{ left: crop.x, top: crop.y, width: crop.w, height: crop.h }} />
          )}
        </div>
      </div>

      <div className="editor-toolbar glass" style={{ flexDirection: 'column', gap: 12, padding: '12px 16px' }}>
        <div className="editor-group" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="icon-btn" title="Rotate left" onClick={() => setRotation((r) => (r + 270) % 360)}>⟲</button>
          <button className="icon-btn" title="Rotate right" onClick={() => setRotation((r) => (r + 90) % 360)}>⟳</button>
          <button className={`icon-btn ${flipH ? 'active' : ''}`} title="Flip horizontal" onClick={() => setFlipH(!flipH)}>⇋</button>
          <button className={`icon-btn ${flipV ? 'active' : ''}`} title="Flip vertical" onClick={() => setFlipV(!flipV)}>⇵</button>

          <span style={{ margin: '0 8px', opacity: 0.3 }}>|</span>

          {RATIOS.map((r) => (
            <button
              key={r.label}
              className={`editor-ratio ${ratio === r.value ? 'active' : ''}`}
              onClick={() => handleRatioSelect(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>

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

