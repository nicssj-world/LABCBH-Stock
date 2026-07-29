'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { getPoImageUrl, uploadPoImage } from '@/lib/receipts/actions'

export interface PoImageUploaderProps {
  receiptId: string
  hasImage: boolean
  canEdit: boolean
}

export function PoImageUploader({ receiptId, hasImage, canEdit }: PoImageUploaderProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      try {
        await uploadPoImage(receiptId, formData)
        router.refresh()
      } catch (caught) {
        // The draft survives an upload failure; only the image is missing.
        setError(caught instanceof Error ? caught.message : 'อัปโหลดภาพใบสั่งซื้อไม่สำเร็จ')
      }
    })
  }

  const preview = () => {
    setError(null)
    startTransition(async () => {
      try {
        setPreviewUrl(await getPoImageUrl(receiptId))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปิดภาพใบสั่งซื้อไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="po-uploader">
      <p className="po-uploader__status">
        {hasImage ? 'แนบภาพใบสั่งซื้อแล้ว' : 'ยังไม่ได้แนบภาพใบสั่งซื้อ'}
        <small>เก็บในที่จัดเก็บส่วนตัว เปิดดูผ่านลิงก์ชั่วคราวที่มีสิทธิ์เท่านั้น</small>
      </p>

      {canEdit && (
        <form className="po-uploader__form" onSubmit={submit}>
          <label className="field-row">
            เลือกไฟล์ภาพหรือ PDF
            <input
              type="file"
              name="file"
              required
              accept="image/jpeg,image/png,image/webp,application/pdf"
            />
          </label>
          <Button type="submit" variant="secondary" disabled={isPending}>
            {isPending ? 'กำลังอัปโหลด…' : hasImage ? 'อัปโหลดแทนไฟล์เดิม' : 'อัปโหลดภาพใบสั่งซื้อ'}
          </Button>
        </form>
      )}

      {hasImage && (
        <div className="po-uploader__preview">
          <Button variant="ghost" onClick={preview} disabled={isPending}>เปิดดูภาพใบสั่งซื้อ</Button>
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
