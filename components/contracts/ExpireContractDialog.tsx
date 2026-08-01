'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { expireContract } from '@/lib/contracts/actions'

export function ExpireContractDialog({ contractId }: { contractId: number }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const close = () => {
    if (isPending) return
    dialogRef.current?.close()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await expireContract(contractId, { reason })
        dialogRef.current?.close()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปลี่ยนสถานะสัญญาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <>
      <Button variant="danger" onClick={() => dialogRef.current?.showModal()}>สิ้นสุดสัญญา</Button>
      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby="expire-contract-title"
        onCancel={(event) => { event.preventDefault(); close() }}
        onClick={(event) => { if (event.target === event.currentTarget) close() }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="expire-contract-title">ยืนยันการสิ้นสุดสัญญา</h2>
            <p>การดำเนินการนี้จะหยุดการบันทึกค่าใช้จ่ายใหม่ในสัญญานี้</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างสิ้นสุดสัญญา" onClick={close}>×</button>
        </header>
        <form className="app-dialog__body route-stack" onSubmit={submit}>
          <label>
            เหตุผลที่สิ้นสุดสัญญา
            <textarea required minLength={1} maxLength={500} rows={4} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={close} disabled={isPending}>กลับไปตรวจสอบ</Button>
            <Button variant="danger" type="submit" disabled={isPending || !reason.trim()}>{isPending ? 'กำลังบันทึก…' : 'ยืนยันสิ้นสุดสัญญา'}</Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
