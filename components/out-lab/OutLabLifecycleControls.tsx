'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  archiveOutLabContract,
  expireOutLabContract,
  restoreOutLabContract,
} from '@/lib/out-lab/actions'

interface ReasonDialogProps {
  contractId: string
  variant: 'archive' | 'expire'
}

const COPY = {
  archive: {
    trigger: 'ลบออกจากทะเบียน',
    title: 'ยืนยันการลบสัญญาออกจากทะเบียน',
    // Archiving is for a record that should never have existed. A contract that
    // simply ended is expired instead, so its history stays in the register.
    description: 'ใช้เมื่อสร้างผิดหรือซ้ำเท่านั้น สัญญาที่สิ้นสุดตามปกติให้ใช้ “สิ้นสุดสัญญา”',
    label: 'เหตุผลที่ลบ',
    failure: 'ลบสัญญาไม่สำเร็จ กรุณาลองใหม่',
  },
  expire: {
    trigger: 'สิ้นสุดสัญญา',
    title: 'ยืนยันการสิ้นสุดสัญญา',
    description: 'การดำเนินการนี้จะหยุดการบันทึกยอดใช้จ่ายใหม่ในสัญญานี้',
    label: 'เหตุผลที่สิ้นสุด',
    failure: 'เปลี่ยนสถานะสัญญาไม่สำเร็จ กรุณาลองใหม่',
  },
} as const

function ReasonDialog({ contractId, variant }: ReasonDialogProps) {
  const copy = COPY[variant]
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const open = () => {
    setReason('')
    setError(null)
    dialogRef.current?.showModal()
  }

  const close = () => {
    if (isPending) return
    dialogRef.current?.close()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        if (variant === 'archive') {
          await archiveOutLabContract(contractId, { reason })
          dialogRef.current?.close()
          router.push('/out-lab')
        } else {
          await expireOutLabContract(contractId, { reason })
          dialogRef.current?.close()
        }
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : copy.failure)
      }
    })
  }

  return (
    <>
      <Button variant="danger" onClick={open}>{copy.trigger}</Button>
      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby={`out-lab-${variant}-title`}
        onCancel={(event) => { event.preventDefault(); close() }}
        onClick={(event) => { if (event.target === event.currentTarget) close() }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id={`out-lab-${variant}-title`}>{copy.title}</h2>
            <p>{copy.description}</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่าง" onClick={close}>×</button>
        </header>
        <form className="app-dialog__body" onSubmit={submit}>
          <label>
            {copy.label}
            <textarea
              required
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="decision-panel__actions">
            <Button variant="secondary" onClick={close} disabled={isPending}>ยกเลิก</Button>
            <Button type="submit" variant="danger" disabled={isPending}>
              {isPending ? 'กำลังบันทึก…' : 'ยืนยัน'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}

export function ArchiveOutLabControl({ contractId }: { contractId: string }) {
  return <ReasonDialog contractId={contractId} variant="archive" />
}

export function ExpireOutLabControl({ contractId }: { contractId: string }) {
  return <ReasonDialog contractId={contractId} variant="expire" />
}

export function RestoreOutLabControl({ contractId }: { contractId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const restore = () => {
    setError(null)
    startTransition(async () => {
      try {
        await restoreOutLabContract(contractId)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'กู้คืนสัญญาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <div className="decision-control">
      <Button onClick={restore} disabled={isPending}>
        {isPending ? 'กำลังกู้คืน…' : 'กู้คืนสัญญา'}
      </Button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
