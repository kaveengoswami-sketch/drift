import { useEffect, useRef, useState } from 'react'
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
  const [rotation, setRotation] = useState(0) // 0/90/180/270
  const [flipH, setFlipH] = useState(false)
  const [flipV, setFlipV] = useState(false)
  const [ratio, setRatio] = useState<number | null>(null)
  const [crop, setCrop] = useState<CropBox | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  // load original
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setLoaded(true)
    }
    img.src = `media://${photo.id}/`
  }, [photo.id])

  // draw preview
  useEffect(() => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !loaded) return
    const rotated = rotation % 180 !== 0
    const iw = rotated ? img.naturalHeight : img.naturalWidth
    const ih = rotated ? img.naturalWidth : img.naturalHeight
    const stage = stageRef.current!
    const maxW = stage.clientWidth - 40
    const maxH = stage.clientHeight - 40
    const s = Math.min(maxW / iw, maxH / ih, 1)
    canvas.width = Math.round(iw * s)
    canvas.height = Math.round(ih * s)
    const ctx = canvas.getContext('2d')!
    ctx.save()
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    const dw = rotated ? canvas.height : canvas.width
    const dh = rotated ? canvas.width : canvas.height
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  }, [rotation, flipH, flipV, loaded])

  // crop drag
  const dragRef = useRef<{ startX: number; startY: number } | null>(null)
  const onCanvasMouseDown = (e: React.MouseEvent): void => {
    const rect = canvasRef.current!.getBoundingClientRect()
    dragRef.current = { startX: e.clientX - rect.left, startY: e.clientY - rect.top }
    setCrop(null)
  }
  const onCanvasMouseMove = (e: React.MouseEvent): void => {
    if (!dragRef.current) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const cx = Math.max(0, Math.min(e.clientX - rect.left, rect.width))
    const cy = Math.max(0, Math.min(e.clientY - rect.top, rect.height))
    let w = Math.abs(cx - dragRef.current.startX)
    let h = Math.abs(cy - dragRef.current.startY)
    if (ratio) h = w / ratio
    const x = Math.min(dragRef.current.startX, cx)
    const y = cy > dragRef.current.startY ? dragRef.current.startY : dragRef.current.startY - h
    setCrop({ x, y, w, h })
  }
  const onCanvasMouseUp = (): void => {
    dragRef.current = null
    setCrop((c) => (c && c.w > 8 && c.h > 8 ? c : null))
  }

  const save = async (): Promise<void> => {
    const img = imgRef.current
    const preview = canvasRef.current
    if (!img || !preview) return
    setSaving(true)
    // render full-res with transforms
    const rotated = rotation % 180 !== 0
    const iw = rotated ? img.naturalHeight : img.naturalWidth
    const ih = rotated ? img.naturalWidth : img.naturalHeight
    const full = document.createElement('canvas')
    full.width = iw
    full.height = ih
    const ctx = full.getContext('2d')!
    ctx.translate(iw / 2, ih / 2)
    ctx.rotate((rotation * Math.PI) / 180)
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1)
    ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

    let out = full
    if (crop) {
      const sx = iw / preview.width
      const sy = ih / preview.height
      const cropped = document.createElement('canvas')
      cropped.width = Math.round(crop.w * sx)
      cropped.height = Math.round(crop.h * sy)
      cropped.getContext('2d')!.drawImage(full, crop.x * sx, crop.y * sy, crop.w * sx, crop.h * sy, 0, 0, cropped.width, cropped.height)
      out = cropped
    }

    await window.drift.saveEdited(photo.path, out.toDataURL('image/jpeg', 0.93))
    setSaving(false)
    onClose()
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
      <div className="editor-toolbar glass">
        <div className="editor-group">
          <button className="icon-btn" title="Rotate left" onClick={() => setRotation((r) => (r + 270) % 360)}>⟲</button>
          <button className="icon-btn" title="Rotate right" onClick={() => setRotation((r) => (r + 90) % 360)}>⟳</button>
          <button className={`icon-btn ${flipH ? 'active' : ''}`} title="Flip horizontal" onClick={() => setFlipH(!flipH)}>⇋</button>
          <button className={`icon-btn ${flipV ? 'active' : ''}`} title="Flip vertical" onClick={() => setFlipV(!flipV)}>⇵</button>
        </div>
        <div className="editor-group">
          {RATIOS.map((r) => (
            <button
              key={r.label}
              className={`editor-ratio ${ratio === r.value ? 'active' : ''}`}
              onClick={() => setRatio(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="editor-group">
          <button className="editor-btn" onClick={onClose}>Cancel</button>
          <button className="editor-btn primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save copy'}
          </button>
        </div>
      </div>
    </motion.div>
  )
}
