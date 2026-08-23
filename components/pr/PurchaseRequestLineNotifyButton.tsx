'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { formatThaiDateTime } from '@/lib/inventory/presenter'
import { notifyPurchaseRequestInLine } from '@/lib/pr/line-notification-actions'
import type { PurchaseRequestLineNotificationSummary } from '@/lib/pr/types'

interface PurchaseRequestLineNotifyButtonProps {
  requestId: string
  documentNumber: string
  poNumber: string
  latest: PurchaseRequestLineNotificationSummary | null
  configured: boolean
}

function statusLabel(status: PurchaseRequestLineNotificationSummary['status']): string {
  switch (status) {
    case 'pending':
      return 'กำลังส่ง…'
    case 'succeeded':
      return 'ส่งสำเร็จ'
    case 'failed':
      return 'ส่งไม่สำเร็จ'
    case 'unknown':
      return 'ยังไม่ทราบผล'
  }
}

function statusClass(status: PurchaseRequestLineNotificationSummary['status']): string {
  return `line-notify-action__status line-notify-action__status--${status}`
}

export function PurchaseRequestLineNotifyButton({
  requestId,
  documentNumber,
  poNumber,
  latest,
  configured,
}: PurchaseRequestLineNotifyButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const titleId = `line-notify-dialog-title-${useId().replaceAll(':', '')}`
  const descriptionId = `${titleId}-description`
  const confirmedAttemptId = latest?.id ?? null
  const hasAttempt = latest !== null
  const canStart = configured && latest?.status !== 'pending'

  const openDialog = () => {
    setError(null)
    dialogRef.current?.showModal()
  }

  const closeDialog = () => {
    if (isPending) return
    dialogRef.current?.close()
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      try {
        await notifyPurchaseRequestInLine(requestId, confirmedAttemptId)
        dialogRef.current?.close()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'แจ้งเอกสาร PO ใน LINE ไม่สำเร็จ')
      } finally {
        router.refresh()
      }
    })
  }

  return (
    <div className="line-notify-action">
      <Button
        variant="secondary"
        type="button"
        className="document-open-button line-notify-button"
        onClick={openDialog}
        disabled={!canStart || isPending}
        aria-haspopup="dialog"
      >
        {isPending ? 'กำลังแจ้ง…' : latest?.status === 'pending' ? 'กำลังส่ง…' : 'แจ้งใน Line'}
      </Button>

      {!configured && (
        <p className="line-notify-action__hint" role="note">
          ยังไม่ได้ตั้งค่า LINE OA ในสภาพแวดล้อมนี้
        </p>
      )}
      {latest && (
        <p className={statusClass(latest.status)} role="status">
          {statusLabel(latest.status)} โดย {latest.sentByName ?? 'ผู้ใช้งาน'} · {formatThaiDateTime(latest.completedAt ?? latest.createdAt)}
        </p>
      )}
      {latest?.errorMessage && latest.status !== 'succeeded' && (
        <p className="line-notify-action__error" role="alert">{latest.errorMessage}</p>
      )}

      <dialog
        ref={dialogRef}
        className="app-dialog line-notify-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          event.preventDefault()
          closeDialog()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id={titleId}>{hasAttempt ? 'ยืนยันส่งเอกสาร PO ซ้ำ' : 'ยืนยันแจ้งเอกสาร PO ใน Line'}</h2>
            <p id={descriptionId}>ส่งข้อมูลสรุปของใบ {documentNumber} ไปยังกลุ่ม LINE ที่กำหนดไว้</p>
          </div>
          <button
            type="button"
            className="app-dialog__close"
            aria-label="ปิดหน้าต่างแจ้งเอกสาร PO ใน Line"
            onClick={closeDialog}
            disabled={isPending}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="app-dialog__body">
          <dl className="line-notify-dialog__facts">
            <div><dt>เลข PR</dt><dd className="identifier">{documentNumber}</dd></div>
            <div><dt>เลข PO</dt><dd className="identifier">{poNumber}</dd></div>
          </dl>

          {latest && (
            <div className={`decision-panel${latest.status === 'failed' || latest.status === 'unknown' ? ' decision-panel--danger' : ''}`}>
              <strong>{statusLabel(latest.status)}</strong>
              <p>
                ครั้งล่าสุดโดย {latest.sentByName ?? 'ผู้ใช้งาน'} เมื่อ {formatThaiDateTime(latest.completedAt ?? latest.createdAt)}
                {latest.status === 'unknown'
                  ? ' ผลจาก LINE ยังไม่แน่ชัด ควรตรวจสอบกลุ่มก่อนยืนยันส่งซ้ำ'
                  : latest.status === 'succeeded'
                    ? ' การยืนยันนี้จะส่งข้อความใหม่อีกครั้ง'
                    : latest.status === 'failed'
                      ? ' การยืนยันนี้จะลองส่งใหม่'
                      : ' ระบบกำลังมีการส่งรายการนี้อยู่'}
              </p>
              {latest.errorMessage && <p className="line-notify-action__error" role="alert">{latest.errorMessage}</p>}
            </div>
          )}

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="decision-panel__actions line-notify-dialog__actions">
            <Button variant="secondary" type="button" onClick={closeDialog} disabled={isPending}>
              กลับไปตรวจสอบ
            </Button>
            <Button type="button" onClick={submit} disabled={isPending || !configured || latest?.status === 'pending'}>
              {isPending ? 'กำลังแจ้ง…' : hasAttempt ? 'ยืนยันส่งซ้ำ' : 'ยืนยันแจ้งใน Line'}
            </Button>
          </div>
        </div>
      </dialog>
    </div>
  )
}
