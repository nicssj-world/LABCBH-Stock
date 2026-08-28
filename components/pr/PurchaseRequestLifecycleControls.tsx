'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { cancelPurchaseRequest, hardDeletePurchaseRequest } from '@/lib/pr/actions'
import { isPurchaseRequestActionError } from '@/lib/pr/errors'

interface PurchaseRequestLifecycleControlsProps {
  requestId: string
  documentNumber: string
  canHardDelete: boolean
}

export function PurchaseRequestLifecycleControls({
  requestId,
  documentNumber,
  canHardDelete,
}: PurchaseRequestLifecycleControlsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isHardDeleteConfirming, setIsHardDeleteConfirming] = useState(false)
  const [isPending, startTransition] = useTransition()

  const openDialog = () => {
    setError(null)
    setIsHardDeleteConfirming(false)
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
        setError(caught instanceof Error ? caught.message : 'ยกเลิก PR ไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  const confirmHardDelete = () => {
    if (!canHardDelete) return
    setError(null)
    startTransition(async () => {
      try {
        const result = await hardDeletePurchaseRequest(requestId)
        if (isPurchaseRequestActionError(result)) {
          setError(result.message)
          return
        }
        dialogRef.current?.close()
        router.push('/purchase-requests')
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ลบใบ PR ถาวรไม่สำเร็จ กรุณาลองใหม่')
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
        ยกเลิก PR
      </Button>

      <dialog
        ref={dialogRef}
        className="app-dialog pr-cancel-dialog"
        aria-labelledby="cancel-pr-dialog-title"
        aria-describedby="cancel-pr-dialog-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="cancel-pr-dialog-title">ยืนยันการยกเลิก PR</h2>
            <p id="cancel-pr-dialog-description">
              ใบ {documentNumber} จะถูกยกเลิกและเก็บประวัติไว้ ระบบจะไม่ตัดยอดสัญญา
            </p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างยกเลิก PR" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <form className="app-dialog__body pr-cancel-dialog__body" onSubmit={submit}>
          <div className="decision-panel decision-panel--danger">
            <strong>ยกเลิกแบบเก็บประวัติ</strong>
            <p>ใบ PR จะเปลี่ยนเป็นสถานะยกเลิกและยังเปิดดูย้อนหลังได้ หากต้องการทำรายการใหม่ ให้สร้างใบ PR ใหม่หลังยกเลิกใบนี้</p>
          </div>
          {canHardDelete && (
            <section className="pr-cancel-hard-delete" aria-labelledby="hard-delete-pr-title">
              <div className="pr-cancel-hard-delete__header">
                <div>
                  <h3 id="hard-delete-pr-title">ลบใบ PR ถาวร</h3>
                  <p>เฉพาะผู้ดูแลระบบเท่านั้น การดำเนินการนี้ลบข้อมูลออกจากระบบและย้อนคืนไม่ได้</p>
                </div>
                <span className="pr-cancel-hard-delete__badge">Admin เท่านั้น</span>
              </div>
              {!isHardDeleteConfirming ? (
                <>
                  <p id="hard-delete-pr-warning" className="pr-cancel-hard-delete__warning">
                    ลบใบ {documentNumber} และไฟล์แนบของใบนี้ถาวร โดยจะไม่เหลือประวัติให้กู้คืน
                  </p>
                  <Button
                    className="pr-cancel-hard-delete__trigger"
                    variant="ghost"
                    type="button"
                    aria-describedby="hard-delete-pr-warning"
                    onClick={() => { setError(null); setIsHardDeleteConfirming(true) }}
                    disabled={isPending}
                  >
                    ลบถาวร
                  </Button>
                </>
              ) : (
                <div className="pr-cancel-hard-delete__confirm" role="alert" aria-live="assertive">
                  <strong>ยืนยันการลบถาวร</strong>
                  <p>คุณกำลังจะลบใบ {documentNumber} และข้อมูลที่เกี่ยวข้องทั้งหมด การดำเนินการนี้ไม่สามารถกู้คืนได้</p>
                  <div className="pr-cancel-hard-delete__confirm-actions">
                    <Button variant="secondary" type="button" onClick={() => setIsHardDeleteConfirming(false)} disabled={isPending}>
                      กลับไป
                    </Button>
                    <Button variant="danger" type="button" onClick={confirmHardDelete} disabled={isPending}>
                      {isPending ? 'กำลังลบถาวร…' : 'ยืนยันลบถาวร'}
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="decision-panel__actions pr-cancel-dialog__actions">
            <Button variant="secondary" type="button" onClick={closeDialog} disabled={isPending}>
              ไม่ยกเลิก
            </Button>
            <Button variant="danger" type="submit" disabled={isPending}>
              {isPending ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิก PR'}
            </Button>
          </div>
        </form>
      </dialog>
    </div>
  )
}
