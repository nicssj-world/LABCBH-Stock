'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelPurchaseRequest } from '@/lib/pr/actions'

interface PurchaseRequestLifecycleControlsProps {
  requestId: string
  documentNumber: string
}

export function PurchaseRequestLifecycleControls({
  requestId,
  documentNumber,
}: PurchaseRequestLifecycleControlsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const openDialog = () => {
    setError(null)
    dialogRef.current?.showModal()
  }

  const closeDialog = () => {
    if (isPending) return
    dialogRef.current?.close()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await cancelPurchaseRequest(requestId)
        dialogRef.current?.close()
        router.push('/purchase-requests')
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ลบใบ PR ไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <div className="pr-lifecycle-controls">
      <Link
        className="lab-link-button lab-link-button--secondary"
        href={`/purchase-requests/${requestId}/edit`}
      >
        แก้ไขใบ PR
      </Link>
      <Button variant="danger" type="button" onClick={openDialog}>
        ลบใบ PR
      </Button>

      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby="cancel-pr-dialog-title"
        aria-describedby="cancel-pr-dialog-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="cancel-pr-dialog-title">ยืนยันการลบใบ PR</h2>
            <p id="cancel-pr-dialog-description">
              ใบ {documentNumber} จะถูกยกเลิกและเก็บประวัติไว้ ระบบจะไม่ตัดยอดสัญญา
            </p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างลบใบ PR" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <form className="app-dialog__body" onSubmit={submit}>
          <div className="decision-panel decision-panel--danger">
            <strong>การดำเนินการนี้ใช้ได้เฉพาะ PR ที่ยังรอการยืนยัน</strong>
            <p>หากต้องการทำรายการใหม่ ให้สร้างใบ PR ใหม่หลังยกเลิกใบนี้</p>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="decision-panel__actions">
            <Button variant="secondary" type="button" onClick={closeDialog} disabled={isPending}>
              กลับไปตรวจสอบ
            </Button>
            <Button variant="danger" type="submit" disabled={isPending}>
              {isPending ? 'กำลังลบ…' : 'ยืนยันลบใบ PR'}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
