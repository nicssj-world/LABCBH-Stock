'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { DocumentOpenIcon } from '@/components/ui/DocumentOpenIcon'

export function PurchaseRequestPoFileOpenButton({ requestId }: { requestId: string }) {
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const titleId = `pr-po-file-open-preview-title-${useId().replaceAll(':', '')}`

  const open = () => {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch(
          `/api/purchase-requests/${encodeURIComponent(requestId)}/po-file`,
          { cache: 'no-store', headers: { Accept: 'application/json' } },
        )
        const body = (await response.json()) as { url?: string; error?: string }
        if (!response.ok) throw new Error(body.error ?? 'เปิดไฟล์ PO ไม่สำเร็จ')
        if (!body.url) throw new Error('ไม่พบไฟล์ PO ที่เปิดดูได้')
        setPreviewUrl(body.url)
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
    <>
      <div className="po-file-open-action">
        <Button
          variant="secondary"
          className="document-open-button"
          onClick={open}
          disabled={isPending}
        >
          <DocumentOpenIcon className="document-open-button__icon" />
          {isPending ? 'กำลังเปิด…' : 'เปิดไฟล์ PO'}
        </Button>
        {error && <p className="form-error po-file-open-action__error" role="alert">{error}</p>}
      </div>

      <dialog
        ref={previewDialogRef}
        className="app-dialog file-preview-dialog"
        aria-labelledby={titleId}
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
            <h2 id={titleId}>ไฟล์ PO</h2>
            <p>แสดงเอกสารจากที่จัดเก็บส่วนตัวในหน้ารายละเอียดใบ PR</p>
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
    </>
  )
}
