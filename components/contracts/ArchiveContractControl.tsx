'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { archiveContract } from '@/lib/contracts/actions'

export function ArchiveContractControl({ contractId }: { contractId: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const openDialog = () => {
    setReason('')
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
        await archiveContract(contractId, { reason })
        dialogRef.current?.close()
        router.push('/contracts')
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ลบสัญญาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <section className="archive-zone" aria-labelledby="archive-contract-title">
      <div className="archive-control__copy">
        <p className="archive-control__eyebrow">ADMIN CLEANUP</p>
        <h2 id="archive-contract-title">พบสัญญาที่สร้างผิดหรือซ้ำ?</h2>
        <p>ลบออกจากรายการใช้งานได้ โดยข้อมูลยังเก็บไว้สำหรับตรวจสอบย้อนหลัง</p>
      </div>
      <button
        type="button"
        className="archive-control__trigger"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M4 7h16m-10 4v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 13h10l1-13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        ลบสัญญาที่สร้างผิดหรือซ้ำ
      </button>

      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby="archive-contract-dialog-title"
        aria-describedby="archive-contract-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
      >
        <header className="app-dialog__header">
          <div>
            <p className="archive-control__eyebrow">ADMIN CLEANUP</p>
            <h2 id="archive-contract-dialog-title">ลบสัญญาที่สร้างผิดหรือซ้ำ</h2>
            <p id="archive-contract-description">สัญญาจะหายจากรายการใช้งานปกติ แต่ยังคงประวัติไว้เพื่อการตรวจสอบ</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างลบสัญญา" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <form className="app-dialog__body archive-control__dialog-body" onSubmit={submit}>
          <label>
            เหตุผลที่ลบสัญญา
            <textarea required minLength={1} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={closeDialog} disabled={isPending}>กลับไปตรวจสอบ</Button>
            <Button variant="danger" type="submit" disabled={isPending || !reason.trim()}>{isPending ? 'กำลังลบ…' : 'ยืนยันลบสัญญา'}</Button>
          </div>
        </form>
      </dialog>
    </section>
  )
}
