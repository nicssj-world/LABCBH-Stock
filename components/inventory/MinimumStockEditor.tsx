'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setMinimumStock } from '@/lib/inventory/actions'
import { formatQuantity } from '@/lib/inventory/presenter'

export interface MinimumStockEditorProps {
  itemId: string
  itemName: string
  unit: string
  suggestedMinimum: number
  minimumStockOverride: number | null
}

/**
 * A compact, per-item exception: most items rely on the system-wide reserve
 * months (set once, admin-only, from the inventory catalog header) for their
 * suggested minimum. This only covers the rare item that needs an absolute
 * override instead of the computed suggestion.
 */
export function MinimumStockEditor({
  itemId,
  itemName,
  unit,
  suggestedMinimum,
  minimumStockOverride,
}: MinimumStockEditorProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [useOverride, setUseOverride] = useState(minimumStockOverride !== null)
  const [override, setOverride] = useState(minimumStockOverride?.toString() ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  const open = () => {
    setUseOverride(minimumStockOverride !== null)
    setOverride(minimumStockOverride?.toString() ?? '')
    setReason('')
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
        await setMinimumStock(itemId, {
          minimumStockOverride: useOverride ? Number(override) : null,
          reason: reason.trim() || null,
        })
        setSaved(true)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกค่าขั้นต่ำไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <>
      <button type="button" className="text-link inventory-override-trigger" onClick={open}>
        {minimumStockOverride === null ? 'กำหนดค่าขั้นต่ำเอง' : 'แก้ไขค่าที่กำหนดเอง'}
      </button>

      <dialog
        ref={dialogRef}
        className="app-dialog"
        aria-labelledby="minimum-stock-editor-title"
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
            <h2 id="minimum-stock-editor-title">ค่าขั้นต่ำของ {itemName}</h2>
            <p>ใช้เฉพาะเมื่อรายการนี้ต้องการค่าขั้นต่ำต่างจากค่าที่ระบบแนะนำ</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดตั้งค่าขั้นต่ำ" onClick={close}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <form className="app-dialog__body minimum-stock-editor" onSubmit={submit}>
          <p className="minimum-stock-editor__suggestion">
            ค่าที่ระบบแนะนำ <strong>{formatQuantity(suggestedMinimum, unit)}</strong>
            <small>คำนวณจากค่าเฉลี่ยการเบิก 3 เดือนล่าสุด คูณจำนวนเดือนสำรองของระบบ</small>
          </p>

          <label className="field-toggle">
            <input
              type="checkbox"
              checked={useOverride}
              onChange={(event) => setUseOverride(event.target.checked)}
            />
            กำหนดค่าขั้นต่ำเองแทนค่าที่ระบบแนะนำ
          </label>

          {useOverride && (
            <label className="field-row">
              ค่าขั้นต่ำที่กำหนดเอง ({unit})
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                required
                value={override}
                onChange={(event) => setOverride(event.target.value)}
              />
            </label>
          )}

          <label className="field-row">
            เหตุผล (บันทึกไว้ตรวจสอบย้อนหลัง)
            <input
              type="text"
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}
          {saved && <p className="form-success" role="status">บันทึกค่าขั้นต่ำเรียบร้อยแล้ว</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? 'กำลังบันทึก…' : 'บันทึกค่าขั้นต่ำ'}
          </Button>
        </form>
      </dialog>
    </>
  )
}
