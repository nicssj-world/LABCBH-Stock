'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setMinimumStock } from '@/lib/inventory/actions'
import { formatQuantity } from '@/lib/inventory/presenter'

export interface MinimumStockEditorProps {
  itemId: string
  unit: string
  suggestedMinimum: number
  minimumStockOverride: number | null
  minimumStockMonths: number
}

export function MinimumStockEditor({
  itemId,
  unit,
  suggestedMinimum,
  minimumStockOverride,
  minimumStockMonths,
}: MinimumStockEditorProps) {
  const router = useRouter()
  const [useOverride, setUseOverride] = useState(minimumStockOverride !== null)
  const [override, setOverride] = useState(minimumStockOverride?.toString() ?? '')
  const [months, setMonths] = useState(minimumStockMonths.toString())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setSaved(false)

    startTransition(async () => {
      try {
        await setMinimumStock(itemId, {
          minimumStockOverride: useOverride ? Number(override) : null,
          minimumStockMonths: Number(months),
          reason: reason.trim() || null,
        })
        setSaved(true)
        setReason('')
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกค่าขั้นต่ำไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <form className="minimum-stock-editor" onSubmit={submit}>
      <p className="minimum-stock-editor__suggestion">
        ค่าที่ระบบแนะนำ <strong>{formatQuantity(suggestedMinimum, unit)}</strong>
        <small>คำนวณจากค่าเฉลี่ยการเบิก 3 เดือนล่าสุด คูณจำนวนเดือนสำรอง</small>
      </p>

      <label className="field-row">
        จำนวนเดือนสำรอง
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
  )
}
