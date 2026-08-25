'use client'

import { useId, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  ANNUAL_PLAN_BUCKET,
  ANNUAL_PLAN_MIME_TYPE,
  validateAnnualPlanFile,
} from '@/lib/annual-plans/files'
import { annualPlanTypeLabel, fiscalYearLabel } from '@/lib/annual-plans/presenter'
import type { AnnualPlanRecord } from '@/lib/annual-plans/types'
import type { AnnualPlanType } from '@/lib/annual-plans/schema'

interface AnnualPlanUploadPayload {
  path?: unknown
  token?: unknown
  planId?: unknown
  error?: unknown
}

function responseError(response: Response, payload: AnnualPlanUploadPayload | null, fallback: string) {
  return typeof payload?.error === 'string'
    ? payload.error
    : `${fallback} (HTTP ${response.status})`
}

async function readJson(response: Response) {
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) return null
  try {
    return await response.json() as AnnualPlanUploadPayload
  } catch {
    return null
  }
}

async function uploadAnnualPlanFile(input: {
  fiscalYear: number
  planType: AnnualPlanType
  file: File
  onStage: (message: string) => void
}) {
  input.onStage('กำลังเตรียมพื้นที่อัปโหลด…')
  const ticketResponse = await fetch('/api/annual-plans/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fiscalYear: input.fiscalYear,
      planType: input.planType,
      fileName: input.file.name,
      fileSizeBytes: input.file.size,
    }),
    credentials: 'same-origin',
  })
  const ticket = await readJson(ticketResponse)
  if (!ticketResponse.ok) {
    throw new Error(responseError(ticketResponse, ticket, 'เตรียมอัปโหลดแผนประจำปีไม่สำเร็จ'))
  }
  if (typeof ticket?.path !== 'string' || typeof ticket.token !== 'string') {
    throw new Error('เซิร์ฟเวอร์ไม่ส่งข้อมูลพื้นที่อัปโหลดแผนประจำปีกลับมา')
  }

  input.onStage('กำลังส่งไฟล์ไปยังพื้นที่จัดเก็บ…')
  const uploaded = await createClient()
    .storage
    .from(ANNUAL_PLAN_BUCKET)
    .uploadToSignedUrl(ticket.path, ticket.token, input.file, {
      contentType: ANNUAL_PLAN_MIME_TYPE,
    })
  if (uploaded.error) {
    throw new Error(`อัปโหลดแผนประจำปีไม่สำเร็จ: ${uploaded.error.message}`)
  }

  input.onStage('กำลังบันทึกข้อมูลแผน…')
  const finalizeResponse = await fetch('/api/annual-plans/finalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fiscalYear: input.fiscalYear,
      planType: input.planType,
      filePath: ticket.path,
      fileName: input.file.name,
      fileSizeBytes: input.file.size,
    }),
    credentials: 'same-origin',
  })
  const finalized = await readJson(finalizeResponse)
  if (!finalizeResponse.ok) {
    throw new Error(responseError(finalizeResponse, finalized, 'บันทึกแผนประจำปีไม่สำเร็จ'))
  }
  if (typeof finalized?.planId !== 'string') {
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
  const [retryFile, setRetryFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)

  const handleFile = async (file: File | undefined, skipReplacementConfirmation = false) => {
    if (!file || isUploading) return
    setError(null)
    setStatus(null)
    setRetryFile(null)

    try {
      await validateAnnualPlanFile(file)
      if (!skipReplacementConfirmation && existingFile && !window.confirm(`มี${annualPlanTypeLabel(planType)}ของ${fiscalYearLabel(fiscalYear)}อยู่แล้ว ต้องการแทนที่ไฟล์เดิมหรือไม่`)) {
        return
      }

      setIsUploading(true)
      setRetryFile(file)
      await uploadAnnualPlanFile({
        fiscalYear,
        planType,
        file,
        onStage: setStatus,
      })
      setStatus('อัปโหลดสำเร็จ กำลังโหลดข้อมูลล่าสุด')
      setRetryFile(null)
      onUploaded()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'อัปโหลดแผนประจำปีไม่สำเร็จ')
      setStatus(null)
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
        role="button"
        tabIndex={isUploading ? -1 : 0}
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
      {error && (
        <div className="annual-plan-dropzone__feedback">
          <p className="annual-plan-dropzone__error" role="alert">{error}</p>
          {retryFile && (
            <button
              type="button"
              className="annual-plan-dropzone__retry"
              onClick={() => void handleFile(retryFile, true)}
              disabled={isUploading}
            >
              ลองอัปโหลดอีกครั้ง
            </button>
          )}
        </div>
      )}
    </div>
  )
}
