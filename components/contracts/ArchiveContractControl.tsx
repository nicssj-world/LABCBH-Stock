'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { archiveContract } from '@/lib/contracts/actions'

export function ArchiveContractControl({ contractId }: { contractId: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await archiveContract(contractId, { reason })
        router.push('/contracts')
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ยกเลิกสัญญาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <div className="archive-zone">
      {!open ? (
        <Button variant="ghost" onClick={() => setOpen(true)}>ยกเลิกและเก็บสัญญาถาวร</Button>
      ) : (
        <form className="decision-panel decision-panel--danger" onSubmit={submit}>
          <div>
            <strong>ยืนยันการเก็บสัญญาถาวร</strong>
            <p>รายการจะไม่แสดงในงานปัจจุบัน แต่ยังคงประวัติไว้เพื่อตรวจสอบย้อนหลัง</p>
          </div>
          <label>
            เหตุผลที่ยกเลิก / เก็บถาวร
            <textarea required minLength={1} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="decision-panel__actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>กลับไปตรวจสอบ</Button>
            <Button variant="danger" type="submit" disabled={isPending || !reason.trim()}>{isPending ? 'กำลังดำเนินการ…' : 'ยืนยันเก็บถาวร'}</Button>
          </div>
        </form>
      )}
    </div>
  )
}
