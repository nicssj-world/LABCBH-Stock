'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { setStockBalance } from '@/lib/inventory/actions'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import { roundQuantity } from '@/lib/inventory/balance'
import type { InventoryLotRecord } from '@/lib/inventory/types'

interface StockAdjustmentDialogProps {
  itemId: string
  itemName: string
  unit: string
  onHand: number
  lots: InventoryLotRecord[]
}

function signedQuantity(value: number, unit: string) {
  if (value === 0) return formatQuantity(0, unit)
  return `${value > 0 ? '+' : '−'}${formatQuantity(Math.abs(value), unit)}`
}

/** Set the physical count for one lot while keeping the ledger append-only. */
export function StockAdjustmentDialog({ itemId, itemName, unit, onHand, lots }: StockAdjustmentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [selectedLotId, setSelectedLotId] = useState<string | null>(lots[0]?.id ?? null)
  const [targetQuantity, setTargetQuantity] = useState('')
  const [occurredOn, setOccurredOn] = useState(bangkokIsoDate())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const balanceFor = (lotId: string | null) => {
    if (lotId === null) return onHand
    return lots.find((lot) => lot.id === lotId)?.balance ?? 0
  }

  const currentBalance = balanceFor(selectedLotId)
  const parsedTarget = Number(targetQuantity)
  const delta = Number.isFinite(parsedTarget) ? roundQuantity(parsedTarget - currentBalance) : 0
  const canSubmit =
    targetQuantity.trim() !== '' &&
    Number.isFinite(parsedTarget) &&
    parsedTarget >= 0 &&
    Math.abs(parsedTarget * 1000 - Math.round(parsedTarget * 1000)) < 1e-8 &&
    delta !== 0 &&
    Boolean(reason.trim()) &&
    Boolean(occurredOn)

  const openDialog = () => {
    const firstLotId = lots[0]?.id ?? null
    setSelectedLotId(firstLotId)
    setTargetQuantity(String(roundQuantity(balanceFor(firstLotId))))
    setOccurredOn(bangkokIsoDate())
    setReason('')
    setError(null)
    dialogRef.current?.showModal()
  }

  const closeDialog = () => {
    if (!isPending) dialogRef.current?.close()
  }

  const changeLot = (lotId: string) => {
    const nextLotId = lotId || null
    setSelectedLotId(nextLotId)
    setTargetQuantity(String(roundQuantity(balanceFor(nextLotId))))
    setError(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!canSubmit) {
      setError('กรุณากรอกยอดที่นับได้จริง เหตุผล และวันที่ให้ครบ โดยยอดใหม่ต้องต่างจากยอดเดิม')
      return
    }

    startTransition(async () => {
      try {
        await setStockBalance(itemId, {
          inventoryLotId: selectedLotId,
          targetQuantity: roundQuantity(parsedTarget),
          reason: reason.trim(),
          occurredOn,
        })
        dialogRef.current?.close()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ปรับยอดคงคลังไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <>
      <Button variant="secondary" onClick={openDialog} aria-haspopup="dialog">
        ปรับยอดคงคลัง
      </Button>

      <dialog
        ref={dialogRef}
        className="app-dialog stock-adjustment-dialog"
        aria-labelledby="stock-adjustment-dialog-title"
        aria-describedby="stock-adjustment-dialog-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
      >
        <header className="app-dialog__header">
          <div>
            <p className="section-kicker">STOCK RECONCILIATION</p>
            <h2 id="stock-adjustment-dialog-title">ปรับยอดคงคลัง</h2>
            <p id="stock-adjustment-dialog-description">
              {itemName} · กรอกยอดที่ตรวจนับได้จริง ระบบจะบันทึกเฉพาะส่วนต่างลงบัญชีตรวจสอบย้อนหลัง
            </p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างปรับยอดคงคลัง" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <form className="app-dialog__body stock-adjustment-dialog__body" onSubmit={submit}>
          {lots.length > 0 ? (
            <label className="field-row">
              ล็อตที่ต้องการปรับ
              <select value={selectedLotId ?? ''} onChange={(event) => changeLot(event.target.value)} disabled={isPending}>
                {lots.map((lot) => (
                  <option key={lot.id} value={lot.id}>
                    ล็อต {lot.lotNumber} · หมดอายุ {formatThaiDate(lot.expiryDate)}
                  </option>
                ))}
              </select>
              <small>ยอดของแต่ละล็อตต้องตรวจนับและปรับแยกกัน</small>
            </label>
          ) : (
            <p className="inline-alert inline-alert--info">
              รายการนี้ยังไม่มีล็อตในระบบ จึงปรับยอดรวมของรายการได้ก่อน หากต้องการแยกล็อตให้บันทึกรับเข้าพร้อมเลขล็อต
            </p>
          )}

          <div className="stock-adjustment-dialog__facts" aria-live="polite">
            <div>
              <span>ล็อตที่เลือก</span>
              <strong>{selectedLotId ? lots.find((lot) => lot.id === selectedLotId)?.lotNumber : 'ยอดรวมรายการ'}</strong>
            </div>
            <div>
              <span>ยอดตามบัญชี</span>
              <strong>{formatQuantity(currentBalance, unit)}</strong>
            </div>
            <div>
              <span>ส่วนต่างที่จะบันทึก</span>
              <strong className={delta < 0 ? 'stock-adjustment-dialog__delta--decrease' : 'stock-adjustment-dialog__delta--increase'}>
                {signedQuantity(delta, unit)}
              </strong>
            </div>
          </div>

          <label className="field-row">
            ยอดที่ตรวจนับได้จริง ({unit})
            <input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              required
              value={targetQuantity}
              onChange={(event) => setTargetQuantity(event.target.value)}
              disabled={isPending}
              autoFocus
            />
            <small>ใส่ 0 ได้ หากตรวจนับแล้วไม่เหลือในล็อตนี้</small>
          </label>

          <label className="field-row">
            วันที่ตรวจนับ/มีผล
            <ThaiDateInput value={occurredOn} onChange={setOccurredOn} required disabled={isPending} />
          </label>

          <label className="field-row">
            เหตุผลในการปรับยอด
            <textarea
              required
              minLength={1}
              maxLength={1000}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={isPending}
              placeholder="เช่น ตรวจนับประจำเดือน พบยอดไม่ตรงกับบัญชี"
            />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="dialog-actions">
            <Button variant="secondary" onClick={closeDialog} disabled={isPending}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending || !canSubmit}>
              {isPending ? 'กำลังบันทึก…' : 'ยืนยันการปรับยอด'}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
