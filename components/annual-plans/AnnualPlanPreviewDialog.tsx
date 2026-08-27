'use client'

import { useEffect, useRef, useState } from 'react'
import { DocumentPreview } from '@/components/ui/DocumentPreview'

export interface AnnualPlanPreviewDialogProps {
  planId: string | null
  planVersionId?: string | null
  fileName: string | null
  open: boolean
  onCancel: () => void
}

export function AnnualPlanPreviewDialog({ planId, planVersionId = null, fileName, open, onCancel }: AnnualPlanPreviewDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null)
  const [loadError, setLoadError] = useState<{ key: string; message: string } | null>(null)

  const sourceKey = planVersionId ? `version:${planVersionId}` : planId ? `plan:${planId}` : null
  const url = open && sourceKey && resolved?.key === sourceKey ? resolved.url : null
  const error = open && sourceKey && loadError?.key === sourceKey ? loadError.message : null
  const loading = Boolean(open && sourceKey && !url && !error)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !sourceKey) {
      if (dialog?.open) dialog.close()
      return
    }

    if (dialog && !dialog.open) dialog.showModal()
    let cancelled = false
    const request = Promise.resolve(planVersionId
      ? `/api/annual-plans/versions/${encodeURIComponent(planVersionId)}/file`
      : planId
        ? `/api/annual-plans/${encodeURIComponent(planId)}/file`
        : '')
    void request
      .then((signedUrl) => {
        if (!cancelled) setResolved({ key: sourceKey, url: signedUrl })
      })
      .catch((caught) => {
        if (!cancelled) {
          setLoadError({
            key: sourceKey,
            message: caught instanceof Error ? caught.message : 'เปิดดูแผนประจำปีไม่สำเร็จ',
          })
        }
      })

    return () => {
      cancelled = true
    }
  }, [open, planId, planVersionId, sourceKey])

  const close = () => {
    dialogRef.current?.close()
    setResolved(null)
    setLoadError(null)
    onCancel()
  }

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog file-preview-dialog annual-plan-preview-dialog"
      aria-labelledby="annual-plan-preview-title"
      onCancel={(event) => {
        event.preventDefault()
        close()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <header className="app-dialog__header">
        <div>
          <p className="section-kicker">DOCUMENT PREVIEW</p>
          <h2 id="annual-plan-preview-title">{fileName ?? 'แผนประจำปี'}</h2>
          <p>แสดงเอกสารจากที่จัดเก็บส่วนตัวในหน้าต่างนี้ ลิงก์จะหมดอายุในเวลาไม่นาน</p>
        </div>
        <button type="button" className="app-dialog__close" aria-label="ปิดตัวอย่างแผนประจำปี" onClick={close}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="app-dialog__body file-preview-dialog__body annual-plan-preview-dialog__body">
        <div className="annual-plan-preview-dialog__toolbar">
          {url && (
            <>
              <a className="lab-link-button lab-link-button--secondary" href={url} download={fileName ?? undefined}>
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                  <path d="M12 3v12m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ดาวน์โหลด
              </a>
              <a className="lab-link-button lab-link-button--secondary" href={url} target="_blank" rel="noreferrer">
                เปิดแท็บใหม่
              </a>
            </>
          )}
        </div>
        {loading && <p className="annual-plan-preview-dialog__status" role="status" aria-live="polite">กำลังเตรียมตัวอย่างเอกสาร…</p>}
        {error && <p className="annual-plan-preview-dialog__error" role="alert">{error}</p>}
        {url && <DocumentPreview src={url} title={`ตัวอย่าง ${fileName ?? 'แผนประจำปี'}`} fileName={fileName} />}
        {url && <p className="annual-plan-preview-dialog__fallback">หากตัวอย่างไม่แสดง ให้ใช้ <a href={url} target="_blank" rel="noreferrer">เปิดแท็บใหม่</a></p>}
      </div>
    </dialog>
  )
}
