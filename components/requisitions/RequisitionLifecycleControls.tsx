'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelRequisition } from '@/lib/requisitions/actions'

interface RequisitionLifecycleControlsProps {
  requisitionId: string
  documentNumber: string
}

export function RequisitionLifecycleControls({
  requisitionId,
  documentNumber,
}: RequisitionLifecycleControlsProps) {
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
        await cancelRequisition(requisitionId)
        dialogRef.current?.close()
        router.push('/requisitions')
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ยกเลิกใบเบิกไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <div className="requisition-lifecycle-controls">
      <Link
        className="lab-link-button lab-link-button--secondary"
        href={`/requisitions/${requisitionId}/edit`}
      >
        แก้ไขใบเบิก
      </Link>
      <Button variant="danger" type="button" onClick={openDialog}>
        ยกเลิกใบเบิก
      </Button>

      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby="cancel-requisition-dialog-title"
        aria-describedby="cancel-requisition-dialog-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="cancel-requisition-dialog-title">ยืนยันการยกเลิกใบเบิก</h2>
            <p id="cancel-requisition-dialog-description">
              ใบ {documentNumber} จะถูกยกเลิกและเก็บประวัติไว้ ยอดคงคลังไม่เปลี่ยนแปลงเพราะยังไม่ได้จ่ายของ
            </p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างยกเลิกใบเบิก" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <form className="app-dialog__body" onSubmit={submit}>
          <div className="decision-panel decision-panel--danger">
            <strong>การดำเนินการนี้ใช้ได้เฉพาะใบเบิกที่ยังรอจ่าย</strong>
            <p>หากต้องการเบิกใหม่ ให้สร้างใบเบิกใบใหม่หลังยกเลิกใบนี้</p>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="decision-panel__actions">
            <Button variant="secondary" type="button" onClick={closeDialog} disabled={isPending}>
              กลับไปตรวจสอบ
            </Button>
            <Button variant="danger" type="submit" disabled={isPending}>
              {isPending ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกใบเบิก'}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
