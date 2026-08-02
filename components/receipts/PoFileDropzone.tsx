'use client'

import { useId, useState, type ChangeEvent, type DragEvent } from 'react'
import {
  isPoFileTypeAllowed,
  PO_MAX_FILE_SIZE_BYTES,
} from '@/lib/receipts/storage'
import { formatPoFileSize } from '@/lib/receipts/po-file'

export interface PoFileDropzoneProps {
  file: File | null
  onChange: (file: File | null) => void
  disabled?: boolean
}

export function PoFileDropzone({ file, onChange, disabled = false }: PoFileDropzoneProps) {
  const inputId = useId()
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const accept = (candidate: File | null) => {
    if (!candidate) return
    if (!isPoFileTypeAllowed(candidate.type)) {
      setError('รองรับเฉพาะไฟล์ JPG, PNG, WEBP หรือ PDF')
      return
    }
    if (candidate.size === 0) {
      setError('ไฟล์ PO ว่างเปล่า')
      return
    }
    if (candidate.size > PO_MAX_FILE_SIZE_BYTES) {
      setError('ไฟล์ PO ต้องมีขนาดไม่เกิน 10 MB')
      return
    }

    setError(null)
    onChange(candidate)
  }

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    accept(event.target.files?.[0] ?? null)
    // Allow choosing the same file again after removing or correcting it.
    event.target.value = ''
  }

  const drop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (!disabled) accept(event.dataTransfer.files?.[0] ?? null)
  }

  return (
    <div className="po-dropzone">
      <label
        className="po-dropzone__surface"
        data-dragging={isDragging || undefined}
        htmlFor={inputId}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!disabled) setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault()
          if (event.currentTarget === event.target) setIsDragging(false)
        }}
        onDrop={drop}
      >
        <strong>{file ? 'เปลี่ยนไฟล์ PO' : 'ลากไฟล์ PO มาวางที่นี่'}</strong>
        <span>หรือคลิกเพื่อเลือกไฟล์</span>
        <small>รองรับ JPG, PNG, WEBP และ PDF · รูปภาพจะ resize อัตโนมัติก่อนอัปโหลด</small>
        <input
          id={inputId}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          disabled={disabled}
          onChange={choose}
        />
      </label>

      {file && (
        <div className="po-dropzone__file">
          <div>
            <strong>{file.name}</strong>
            <small>{file.type === 'application/pdf' ? 'PDF ต้นฉบับ' : 'รูปภาพ — จะ resize ก่อนอัปโหลด'} · {formatPoFileSize(file.size)}</small>
          </div>
          <button type="button" onClick={() => onChange(null)} disabled={disabled}>นำออก</button>
        </div>
      )}

      {error && <p className="po-dropzone__error" role="alert">{error}</p>}
    </div>
  )
}
