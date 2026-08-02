'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setInventoryMinimumStockMonths } from '@/lib/inventory/actions'

export interface InventoryMinimumStockSettingsProps {
  minimumStockMonths: number
}

export function InventoryMinimumStockSettings({ minimumStockMonths }: InventoryMinimumStockSettingsProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [months, setMonths] = useState(minimumStockMonths.toString())
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  const open = () => {
    setMonths(minimumStockMonths.toString())
    setError(null)
    setSaved(false)
    dialogRef.current?.showModal()
  }

  const close = () => dialogRef.current?.close()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSaved(false)
    startTransition(async () => {
      try {
        await setInventoryMinimumStockMonths({ minimumStockMonths: Number(months) })
        setSaved(true)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <>
      <Button variant="secondary" onClick={open}>ตั้งค่าขั้นต่ำระบบ</Button>

      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby="minimum-stock-settings-title"
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
            <h2 id="minimum-stock-settings-title">ตั้งค่าขั้นต่ำของระบบ</h2>
            <p>ใช้คำนวณค่าขั้นต่ำที่ระบบแนะนำของน้ำยาทุกรายการ ไม่ใช่รายการใดรายการหนึ่ง</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดตั้งค่าขั้นต่ำของระบบ" onClick={close}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <form className="app-dialog__body" onSubmit={submit}>
          <label className="field-row">
            จำนวนเดือนสำรอง (ทุกรายการ)
            <input
              type="number"
              inputMode="decimal"
              min="0.5"
              max="60"
              step="0.5"
              required
              value={months}
              onChange={(event) => setMonths(event.target.value)}
            />
          </label>
          <small>คำนวณค่าขั้นต่ำที่ระบบแนะนำ = ค่าเฉลี่ยการเบิก 3 เดือนล่าสุด × จำนวนเดือนสำรองนี้</small>

          {error && <p className="form-error" role="alert">{error}</p>}
          {saved && <p className="form-success" role="status">บันทึกเรียบร้อยแล้ว มีผลกับน้ำยาทุกรายการ</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </form>
      </dialog>
    </>
  )
}
