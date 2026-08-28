'use client'

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '@/components/ui/Button'

export interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
}

const STROKE_HEIGHT_PX = 180

export function SignaturePad({ onChange, disabled = false }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef<{ x: number; y: number } | null>(null)
  const hasSignatureRef = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)

  // Backing store scaled by devicePixelRatio so strokes stay crisp on
  // high-density screens; CSS size stays the container width × fixed height.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const resize = () => {
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      if (width <= 0 || hasSignatureRef.current) return

      canvas.width = Math.floor(width * ratio)
      canvas.height = STROKE_HEIGHT_PX * ratio
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        ctx.lineWidth = 2.5
        ctx.strokeStyle = '#0f172a'
      }
    }

    resize()
    const frame = window.requestAnimationFrame(resize)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(canvas)
    window.addEventListener('resize', resize)
    return () => {
      window.cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  const pointFromEvent = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  const startStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drawingRef.current = true
    lastPointRef.current = pointFromEvent(event)
  }

  const continueStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const last = lastPointRef.current
    if (!ctx || !last) return

    const point = pointFromEvent(event)
    ctx.beginPath()
    ctx.moveTo(last.x, last.y)
    ctx.lineTo(point.x, point.y)
    ctx.stroke()
    lastPointRef.current = point
    if (!hasSignatureRef.current) {
      hasSignatureRef.current = true
      setHasSignature(true)
    }
  }

  const endStroke = () => {
    if (!drawingRef.current) return
    drawingRef.current = false
    lastPointRef.current = null
    const canvas = canvasRef.current
    onChange(canvas && hasSignatureRef.current ? canvas.toDataURL('image/png') : null)
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    hasSignatureRef.current = false
    setHasSignature(false)
    onChange(null)
  }

  return (
    <div className="signature-pad">
      <canvas
        ref={canvasRef}
        className="signature-pad__canvas"
        role="img"
        aria-label={hasSignature ? 'ลายเซ็นต์ที่วาดไว้' : 'พื้นที่วาดลายเซ็นต์ ว่างเปล่า'}
        onPointerDown={startStroke}
        onPointerMove={continueStroke}
        onPointerUp={endStroke}
        onPointerLeave={endStroke}
        onPointerCancel={endStroke}
      />
      <div className="signature-pad__footer">
        <small>ลงลายเซ็นต์ด้วยเมาส์ นิ้ว หรือปากกาบนหน้าจอ</small>
        <Button type="button" variant="secondary" onClick={clear} disabled={disabled || !hasSignature}>
          ล้างลายเซ็นต์
        </Button>
      </div>
    </div>
  )
}
