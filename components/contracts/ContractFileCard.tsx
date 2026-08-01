'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  contractFileUrl,
  removeContractFile,
  uploadContractFile,
} from '@/lib/contracts/file-actions'

export interface ContractFileCardProps {
  contractId: number
  filePath: string | null
  canEdit: boolean
}

export function ContractFileCard({ contractId, filePath, canEdit }: ContractFileCardProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)

    startTransition(async () => {
      try {
        await uploadContractFile(contractId, formData)
        setOpenUrl(null)
        router.refresh()
      } catch (caught) {
        // The contract survives an upload failure; only the document is missing.
        setError(caught instanceof Error ? caught.message : 'อัปโหลดไฟล์สัญญาไม่สำเร็จ')
      }
    })
  }

  const open = () => {
    if (!filePath) return
    setError(null)
    startTransition(async () => {
      try {
        setOpenUrl(await contractFileUrl(contractId, filePath))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปิดไฟล์สัญญาไม่สำเร็จ')
      }
    })
  }

  const detach = () => {
    setError(null)
    startTransition(async () => {
      try {
        await removeContractFile(contractId)
        setOpenUrl(null)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ลบไฟล์สัญญาไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="po-uploader">
      <p className="po-uploader__status">
        {filePath ? 'แนบไฟล์สัญญาแล้ว' : 'ยังไม่ได้แนบไฟล์สัญญา'}
        <small>เก็บในที่จัดเก็บส่วนตัว เปิดดูผ่านลิงก์ชั่วคราวที่มีสิทธิ์เท่านั้น</small>
      </p>

      {canEdit && (
        <form className="po-uploader__form" onSubmit={submit}>
          <label className="field-row">
            เลือกไฟล์ PDF หรือรูปภาพ
            <input
              type="file"
              name="file"
              required
              accept="application/pdf,image/jpeg,image/png,image/webp"
            />
          </label>
          <Button type="submit" variant="secondary" disabled={isPending}>
            {isPending ? 'กำลังอัปโหลด…' : filePath ? 'อัปโหลดแทนไฟล์เดิม' : 'อัปโหลดไฟล์สัญญา'}
          </Button>
        </form>
      )}

      {filePath && (
        <div className="po-uploader__preview">
          <Button variant="ghost" onClick={open} disabled={isPending}>
            เปิดดูไฟล์สัญญา
          </Button>
          {openUrl && (
            <a className="text-link" href={openUrl} target="_blank" rel="noreferrer">
              เปิดในแท็บใหม่ (ลิงก์หมดอายุใน 5 นาที)
            </a>
          )}
          {canEdit && (
            <Button variant="ghost" onClick={detach} disabled={isPending}>
              นำไฟล์ออก
            </Button>
          )}
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
