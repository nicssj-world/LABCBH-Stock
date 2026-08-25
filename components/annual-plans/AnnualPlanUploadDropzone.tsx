'use client'

import { useId, useRef, useState } from 'react'
import { validateAnnualPlanFile } from '@/lib/annual-plans/files'
import { annualPlanTypeLabel, fiscalYearLabel } from '@/lib/annual-plans/presenter'
import type { AnnualPlanRecord } from '@/lib/annual-plans/types'
import type { AnnualPlanType } from '@/lib/annual-plans/schema'

interface AnnualPlanUploadResponse {
  planId?: unknown
  error?: unknown
}

async function uploadAnnualPlanFile(formData: FormData) {
  const response = await fetch('/api/annual-plans/upload', {
    method: 'POST',
    body: formData,
    credentials: 'same-origin',
  })

  const contentType = response.headers.get('content-type') ?? ''
  let payload: AnnualPlanUploadResponse | null = null
  if (contentType.includes('application/json')) {
    try {
      payload = await response.json() as AnnualPlanUploadResponse
    } catch {
      payload = null
    }
  }

  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `อัปโหลดแผนประจำปีไม่สำเร็จ (HTTP ${response.status})`
    throw new Error(message)
  }
  if (typeof payload?.planId !== 'string') {
    throw new Error('เซิร์ฟเวอร์ไม่ส่งผลการอัปโหลดแผนประจำปีกลับมา')
  }
}

export interface AnnualPlanUploadDropzoneProps {
  fiscalYear: number
  planType: AnnualPlanType
  existingFile: AnnualPlanRecord | null
  onUploaded: () => void
}

export function AnnualPlanUploadDropzone({
  fiscalYear,
  planType,
  existingFile,
  onUploaded,
}: AnnualPlanUploadDropzoneProps) {
  const inputId = useId()
  const helpId = `${inputId}-help`
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const handleFile = async (file: File | undefined) => {
    if (!file || isUploading) return
    setError(null)
    setStatus(null)

    try {
      await validateAnnualPlanFile(file)
      if (existingFile && !window.confirm(`มี${annualPlanTypeLabel(planType)}ของ${fiscalYearLabel(fiscalYear)}อยู่แล้ว ต้องการแทนที่ไฟล์เดิมหรือไม่`)) {
        return
      }

      setIsUploading(true)
      const formData = new FormData()
      formData.set('file', file)
      formData.set('fiscalYear', String(fiscalYear))
      formData.set('planType', planType)
      await uploadAnnualPlanFile(formData)
      setStatus('อัปโหลดสำเร็จ กำลังโหลดข้อมูลล่าสุด')
      onUploaded()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'อัปโหลดแผนประจำปีไม่สำเร็จ')
    } finally {
      setIsUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="annual-plan-dropzone">
      <input
        ref={inputRef}
        id={inputId}
        className="annual-plan-file-input"
        type="file"
        accept="application/pdf,.pdf"
        disabled={isUploading}
        aria-describedby={helpId}
        aria-busy={isUploading}
        onChange={(event) => void handleFile(event.target.files?.[0])}
      />
      <label
        htmlFor={inputId}
        className="annual-plan-dropzone__surface"
        data-dragging={isDragging}
        aria-busy={isUploading}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragEnter={(event) => {
          event.preventDefault()
          if (!isUploading) setIsDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) setIsDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          setIsDragging(false)
          void handleFile(event.dataTransfer.files?.[0])
        }}
      >
        <span className="annual-plan-dropzone__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M12 16V4m0 0L8 8m4-4 4 4M5 14v5h14v-5M7 19h10" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="annual-plan-dropzone__copy">
          <strong>{isUploading ? 'กำลังอัปโหลด…' : 'ลากไฟล์ PDF มาวางที่นี่'}</strong>
          <span>หรือ</span>
          <span className="annual-plan-dropzone__button">เลือกไฟล์ PDF</span>
        </span>
      </label>
      <p id={helpId} className="annual-plan-dropzone__hint">
        รองรับ PDF เท่านั้น · ขนาดไม่เกิน 25 MB · อัปโหลดได้ใน 2 ปีงบประมาณที่เก็บไว้
      </p>
      {status && <p className="annual-plan-dropzone__status" aria-live="polite">{status}</p>}
      {error && <p className="annual-plan-dropzone__error" role="alert">{error}</p>}
    </div>
  )
}
