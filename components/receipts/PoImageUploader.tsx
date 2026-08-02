'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { PoFileDropzone } from '@/components/receipts/PoFileDropzone'
import { getPoImageUrl, uploadPoImage } from '@/lib/receipts/actions'
import { preparePoFile } from '@/lib/receipts/po-file'

export interface PoImageUploaderProps {
  receiptId: string
  hasImage: boolean
  canEdit: boolean
}

export function PoImageUploader({ receiptId, hasImage, canEdit }: PoImageUploaderProps) {
  const router = useRouter()
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        if (!file) throw new Error('กรุณาเลือกไฟล์ PO')
        const preparedFile = await preparePoFile(file)
        const formData = new FormData()
        formData.set('file', preparedFile, preparedFile.name)
        await uploadPoImage(receiptId, formData)
        setFile(null)
        router.refresh()
      } catch (caught) {
        // The draft survives an upload failure; only the image is missing.
        setError(caught instanceof Error ? caught.message : 'อัปโหลดไฟล์ PO ไม่สำเร็จ')
      }
    })
  }

  const preview = () => {
    setError(null)
    startTransition(async () => {
      try {
        const signedUrl = await getPoImageUrl(receiptId)
        setPreviewUrl(signedUrl)
        previewDialogRef.current?.showModal()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปิดไฟล์ PO ไม่สำเร็จ')
      }
    })
  }

  const closePreview = () => {
    previewDialogRef.current?.close()
    setPreviewUrl(null)
  }

  return (
    <div className="po-uploader">
      <p className="po-uploader__status">
        {hasImage ? 'แนบไฟล์ PO แล้ว' : 'ยังไม่ได้แนบไฟล์ PO'}
        <small>{hasImage ? 'เปิดดูไฟล์ในหน้านี้ได้ทันที' : 'เก็บในที่จัดเก็บส่วนตัว เปิดดูผ่านลิงก์ชั่วคราวที่มีสิทธิ์เท่านั้น'}</small>
      </p>

      {canEdit && (
        <form className="po-uploader__form" onSubmit={submit}>
          <div className="field-row">
            <span>ไฟล์ PO</span>
            <PoFileDropzone file={file} onChange={setFile} disabled={isPending} />
          </div>
          <Button type="submit" variant="secondary" disabled={isPending || !file}>
            {isPending ? 'กำลังอัปโหลด…' : hasImage ? 'อัปโหลดแทนไฟล์เดิม' : 'อัปโหลดไฟล์ PO'}
          </Button>
        </form>
      )}

      {hasImage && (
        <div className="po-uploader__preview">
          <Button variant="ghost" onClick={preview} disabled={isPending}>เปิดดูไฟล์ PO</Button>
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <dialog
        ref={previewDialogRef}
        className="app-dialog file-preview-dialog"
        aria-labelledby="po-file-preview-title"
        onCancel={(event) => {
          event.preventDefault()
          closePreview()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePreview()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="po-file-preview-title">ไฟล์ PO</h2>
            <p>แสดงเอกสารจากที่จัดเก็บส่วนตัวในหน้ารายละเอียดนี้</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดตัวอย่างไฟล์ PO" onClick={closePreview}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="app-dialog__body file-preview-dialog__body">
          {previewUrl && <iframe title="ตัวอย่างไฟล์ PO" src={previewUrl} />}
        </div>
      </dialog>
    </div>
  )
}
