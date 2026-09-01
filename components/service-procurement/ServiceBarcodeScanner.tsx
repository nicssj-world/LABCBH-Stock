'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

interface Props {
  open: boolean
  onClose: () => void
  onDetected: (value: string) => void
}

const subscribeToClientReady = () => () => undefined

function cameraErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'ไม่สามารถใช้กล้องได้ กรุณาอนุญาตสิทธิ์กล้องในเบราว์เซอร์ แล้วลองใหม่อีกครั้ง'
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') {
    return 'ไม่พบกล้องในอุปกรณ์นี้ สามารถพิมพ์หรือใช้เครื่องยิง barcode แทนได้'
  }
  return 'เปิดกล้องไม่สำเร็จ กรุณาตรวจสอบสิทธิ์กล้องหรือใช้เครื่องยิง barcode แทน'
}

export function ServiceBarcodeScanner({ open, onClose, onDetected }: Props) {
  const portalReady = useSyncExternalStore(subscribeToClientReady, () => true, () => false)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<{ stop: () => void } | null>(null)
  const onCloseRef = useRef(onClose)
  const onDetectedRef = useRef(onDetected)
  const [error, setError] = useState<string | null>(null)
  const [scanAttempt, setScanAttempt] = useState(0)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    const video = videoRef.current
    if (!open || !video) return

    let disposed = false
    setError(null)
    const hints = new Map<DecodeHintType, unknown>()
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE])
    hints.set(DecodeHintType.TRY_HARDER, true)
    const reader = new BrowserMultiFormatReader(hints)

    void reader.decodeFromConstraints(
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      video,
      (result) => {
        if (disposed || !result) return
        const value = result.getText().trim()
        if (!value) return
        disposed = true
        controlsRef.current?.stop()
        controlsRef.current = null
        onDetectedRef.current(value)
        onCloseRef.current()
      },
    ).then((controls) => {
      if (disposed) controls.stop()
      else controlsRef.current = controls
    }).catch((caught: unknown) => {
      if (!disposed) setError(cameraErrorMessage(caught))
    })

    return () => {
      disposed = true
      controlsRef.current?.stop()
      controlsRef.current = null
      if (video) {
        video.pause()
        video.srcObject = null
      }
    }
  }, [open, scanAttempt])

  if (!portalReady || !open) return null

  return createPortal(
    <dialog
      ref={dialogRef}
      className="app-dialog service-barcode-scanner"
      aria-labelledby="service-barcode-scanner-title"
      aria-describedby="service-barcode-scanner-description"
      onCancel={(event) => {
        event.preventDefault()
        onCloseRef.current()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCloseRef.current()
      }}
    >
      <header className="app-dialog__header">
        <div>
          <h2 id="service-barcode-scanner-title">สแกนเลขที่เอกสาร</h2>
          <p id="service-barcode-scanner-description">จัด barcode ให้อยู่ในกรอบ แล้วถือให้นิ่ง ระบบรองรับ Code128 และ QR</p>
        </div>
        <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างสแกน barcode" onClick={() => onCloseRef.current()}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="app-dialog__body service-barcode-scanner__body">
        <div className="service-barcode-scanner__viewport">
          <video ref={videoRef} autoPlay muted playsInline aria-label="ภาพจากกล้องสำหรับสแกน barcode" />
          <span className="service-barcode-scanner__target" aria-hidden="true" />
        </div>
        <p className="service-barcode-scanner__hint" role="status" aria-live="polite">
          {error ?? 'กำลังค้นหา barcode…'}
        </p>
        {error && (
          <button type="button" className="lab-button lab-button--secondary service-barcode-scanner__retry" onClick={() => {
            setError(null)
            setScanAttempt((attempt) => attempt + 1)
          }}>
            ลองเปิดกล้องอีกครั้ง
          </button>
        )}
        <div className="service-barcode-scanner__actions">
          <button type="button" className="lab-button lab-button--ghost" onClick={() => onCloseRef.current()}>ยกเลิก</button>
        </div>
      </div>
    </dialog>,
    document.body,
  )
}
