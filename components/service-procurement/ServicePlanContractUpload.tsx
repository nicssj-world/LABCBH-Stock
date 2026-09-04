'use client'

import { useState, useTransition, type DragEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { uploadServicePlanContract } from '@/lib/service-procurement/actions'
import type { ServicePlanDocumentRecord } from '@/lib/service-procurement/types'

const MAX_CONTRACT_BYTES = 20 * 1024 * 1024

function contractFileError(file: File | undefined): string | null {
  if (!file) return 'กรุณาเลือกไฟล์สัญญา'
  if (file.size <= 0 || file.size > MAX_CONTRACT_BYTES) return 'ไฟล์สัญญาต้องมีขนาดไม่เกิน 20 MB'
  if (file.type !== 'application/pdf') return 'ไฟล์สัญญาต้องเป็น PDF เท่านั้น'
  return null
}

interface Props {
  planId: string
  document?: Pick<ServicePlanDocumentRecord, 'fileName'>
}

export function ServicePlanContractUpload({ planId, document }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [file, setFile] = useState<File | undefined>()
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function chooseFile(nextFile: File | undefined) {
    setFile(nextFile)
    setError(nextFile ? contractFileError(nextFile) : null)
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault()
    setDragging(false)
    if (!pending) chooseFile(event.dataTransfer.files?.[0])
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fileError = contractFileError(file)
    if (fileError) {
      setError(fileError)
      return
    }
    if (!file) return
    const formData = new FormData()
    formData.set('contract', file, file.name)
    setError(null)
    startTransition(async () => {
      try {
        await uploadServicePlanContract(planId, formData)
        setFile(undefined)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกไฟล์สัญญาไม่สำเร็จ')
      }
    })
  }

  return (
    <form className="service-plan-contract-upload" onSubmit={submit}>
      <div className="service-plan-contract-upload__heading">
        <div>
          <strong>{document ? 'มีไฟล์สัญญาแล้ว' : 'ยังไม่มีไฟล์สัญญา'}</strong>
          <small>{document ? `${document.fileName} · แนบไฟล์ใหม่เพื่อแทนที่` : 'เจ้าหน้าที่คลังแนบได้เฉพาะ PDF · สูงสุด 20 MB'}</small>
        </div>
        <span>{document ? 'พร้อมใช้ใน PR' : 'ต้องแนบก่อนสร้าง PR'}</span>
      </div>
      {file && <p className="service-plan-contract-upload__file">ไฟล์ใหม่: {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <label
        className={`pr-checklist__dropzone${dragging ? ' is-dragging' : ''}`}
        aria-disabled={pending}
        onDragEnter={(event) => { event.preventDefault(); if (!pending) setDragging(true) }}
        onDragOver={(event) => { event.preventDefault(); if (!pending) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <svg className="pr-checklist__dropzone-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
          <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
        </svg>
        <span className="pr-checklist__dropzone-copy">
          <strong>{dragging ? 'วางไฟล์ที่นี่' : file ? 'เลือกไฟล์ใหม่อีกครั้ง' : 'ลากไฟล์สัญญามาวางที่นี่'}</strong>
          <small>หรือคลิกเลือกไฟล์ PDF</small>
        </span>
        <input
          key={file ? `${file.name}:${file.lastModified}` : 'empty'}
          type="file"
          accept="application/pdf,.pdf"
          disabled={pending}
          aria-label="แนบไฟล์สัญญา PDF"
          onChange={(event) => chooseFile(event.target.files?.[0])}
        />
      </label>
      <div className="service-plan-contract-upload__actions">
        {file && <Button type="button" variant="ghost" disabled={pending} onClick={() => chooseFile(undefined)}>ยกเลิกไฟล์ใหม่</Button>}
        <Button type="submit" disabled={pending || !file}>{pending ? 'กำลังบันทึก…' : document ? 'แทนที่ไฟล์สัญญา' : 'บันทึกไฟล์สัญญา'}</Button>
      </div>
    </form>
  )
}
