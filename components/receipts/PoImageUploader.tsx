'use client'

import { useState, useTransition, type FormEvent } from 'react'
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
        setPreviewUrl(await getPoImageUrl(receiptId))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปิดไฟล์ PO ไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="po-uploader">
      <p className="po-uploader__status">
        {hasImage ? 'แนบไฟล์ PO แล้ว' : 'ยังไม่ได้แนบไฟล์ PO'}
        <small>เก็บในที่จัดเก็บส่วนตัว เปิดดูผ่านลิงก์ชั่วคราวที่มีสิทธิ์เท่านั้น</small>
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
          {previewUrl && (
            <a className="text-link" href={previewUrl} target="_blank" rel="noreferrer">
              เปิดในแท็บใหม่ (ลิงก์หมดอายุใน 5 นาที)
            </a>
          )}
        </div>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
