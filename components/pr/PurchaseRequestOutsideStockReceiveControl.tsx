'use client'

import { useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

interface PurchaseRequestOutsideStockReceiveControlProps {
  requestId: string
  documentNumber: string
  canReceive: boolean
  canRetryCleanup: boolean
  receiveAction: (purchaseRequestId: string) => Promise<unknown>
  retryCleanupAction: (purchaseRequestId: string) => Promise<void>
  variant?: 'summary' | 'detail'
}

const subscribeToClientReady = () => () => undefined

export function PurchaseRequestOutsideStockReceiveControl({
  requestId,
  documentNumber,
  canReceive,
  canRetryCleanup,
  receiveAction,
  retryCleanupAction,
  variant = 'detail',
}: PurchaseRequestOutsideStockReceiveControlProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const portalReady = useSyncExternalStore(subscribeToClientReady, () => true, () => false)
  const [error, setError] = useState<{ action: 'receive' | 'retry'; message: string } | null>(null)
  const [pendingAction, setPendingAction] = useState<'receive' | 'retry' | null>(null)
  const [isPending, startTransition] = useTransition()
  const titleId = `outside-stock-receive-title-${requestId}-${variant}`
  const descriptionId = `outside-stock-receive-description-${requestId}-${variant}`

  const openDialog = () => {
    setError(null)
    dialogRef.current?.showModal()
  }

  const closeDialog = () => {
    if (isPending) return
    dialogRef.current?.close()
  }

  const receive = () => {
    setError(null)
    setPendingAction('receive')
    startTransition(async () => {
      try {
        await receiveAction(requestId)
        dialogRef.current?.close()
      } catch (caught) {
        setError({
          action: 'receive',
          message: caught instanceof Error ? caught.message : 'บันทึกว่าหน่วยงานรับของเองไม่สำเร็จ',
        })
      } finally {
        setPendingAction(null)
        router.refresh()
      }
    })
  }

  const retryCleanup = () => {
    setError(null)
    setPendingAction('retry')
    startTransition(async () => {
      try {
        await retryCleanupAction(requestId)
      } catch (caught) {
        setError({
          action: 'retry',
          message: caught instanceof Error ? caught.message : 'ลองล้างไฟล์ PO อีกครั้งไม่สำเร็จ',
        })
      } finally {
        setPendingAction(null)
        router.refresh()
      }
    })
  }

  if (!canReceive && !canRetryCleanup) return null

  return (
    <div className={`pr-outside-stock-control pr-outside-stock-control--${variant}`}>
      {canReceive && (
        <Button type="button" onClick={openDialog} disabled={isPending}>
          หน่วยงานรับของเอง
        </Button>
      )}
      {canRetryCleanup && (
        <Button variant="secondary" type="button" onClick={retryCleanup} disabled={isPending}>
          {pendingAction === 'retry' ? 'กำลังล้างไฟล์ PO…' : 'ลองล้างไฟล์ PO อีกครั้ง'}
        </Button>
      )}
      {error?.action === 'retry' && <p className="form-error" role="alert">{error.message}</p>}

      {portalReady && createPortal(
        <dialog
          ref={dialogRef}
          className="app-dialog outside-stock-dialog"
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
              <h2 id={titleId}>ยืนยันว่าหน่วยงานรับของเอง</h2>
              <p id={descriptionId}>ใบ {documentNumber} จะเปลี่ยนเป็นสถานะรับครบ</p>
            </div>
            <button
              type="button"
              className="app-dialog__close"
              aria-label="ปิดหน้าต่างยืนยันหน่วยงานรับของเอง"
              onClick={closeDialog}
              disabled={isPending}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>
          <div className="app-dialog__body outside-stock-dialog__body">
            <div className="decision-panel">
              <strong>รายการนี้จะไม่ผ่านคลัง</strong>
              <p>
                ระบบจะบันทึกหมายเหตุ “หน่วยงานรับของเอง” และปิดการรับเข้าของ PR นี้
                โดยไม่เพิ่มยอดคงคลัง ไม่สร้างใบรับเข้า LOT หรือ Stock Movement
                สถานะรับครบเป็นสถานะปลายทางและย้อนกลับไม่ได้
              </p>
            </div>
            {error?.action === 'receive' && <p className="form-error" role="alert">{error.message}</p>}
            <div className="decision-panel__actions outside-stock-dialog__actions">
              <Button variant="secondary" type="button" onClick={closeDialog} disabled={isPending}>
                กลับไปตรวจสอบ
              </Button>
              <Button type="button" onClick={receive} disabled={isPending}>
                {pendingAction === 'receive' ? 'กำลังบันทึก…' : 'ยืนยันหน่วยงานรับของเอง'}
              </Button>
            </div>
          </div>
        </dialog>,
        document.body,
      )}
    </div>
  )
}
