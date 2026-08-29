'use client'

import { useCallback, useEffect, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { QuantityInput } from '@/components/ui/QuantityInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { roundQuantity } from '@/lib/inventory/balance'
import { getInventoryItemSummary, setStockBalance } from '@/lib/inventory/actions'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import type { InventoryLotRecord } from '@/lib/inventory/types'

interface StockAdjustmentDialogProps {
  itemId: string
  itemName: string
  unit: string
  lots: InventoryLotRecord[]
  defaultReason?: string
  loadLotsOnOpen?: boolean
  autoOpen?: boolean
  showTrigger?: boolean
  onClosed?: () => void
}

const NEW_LOT = '__new_lot__' as const
type LotSelection = string | typeof NEW_LOT

function signedQuantity(value: number, unit: string) {
  if (value === 0) return formatQuantity(0, unit)
  return `${value > 0 ? '+' : '−'}${formatQuantity(Math.abs(value), unit)}`
}

/** Set the physical count for one lot while keeping the ledger append-only. */
export function StockAdjustmentDialog({
  itemId,
  itemName,
  unit,
  lots,
  defaultReason,
  loadLotsOnOpen = false,
  autoOpen = false,
  showTrigger = true,
  onClosed,
}: StockAdjustmentDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [availableLots, setAvailableLots] = useState<InventoryLotRecord[]>(lots)
  const [selectedLot, setSelectedLot] = useState<LotSelection>(lots[0]?.id ?? NEW_LOT)
  const [lotNumber, setLotNumber] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [targetQuantity, setTargetQuantity] = useState('')
  const [occurredOn, setOccurredOn] = useState(bangkokIsoDate())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoadingLots, setIsLoadingLots] = useState(false)
  const [isPending, startTransition] = useTransition()

  const isNewLot = selectedLot === NEW_LOT
  const selectedLotRecord = isNewLot ? undefined : availableLots.find((lot) => lot.id === selectedLot)
  const matchingLotRecord = isNewLot
    ? availableLots.find((lot) => lot.lotNumber.trim().toLocaleUpperCase() === lotNumber.trim().toLocaleUpperCase())
    : selectedLotRecord
  const currentBalance = matchingLotRecord?.balance ?? 0
  const parsedTarget = Number(targetQuantity)
  const delta = Number.isFinite(parsedTarget) ? roundQuantity(parsedTarget - currentBalance) : 0
  const hasValidPrecision = Math.abs(parsedTarget * 1000 - Math.round(parsedTarget * 1000)) < 1e-8
  const canSubmit =
    lotNumber.trim() !== '' &&
    Boolean(expiryDate) &&
    targetQuantity.trim() !== '' &&
    Number.isFinite(parsedTarget) &&
    parsedTarget >= 0 &&
    hasValidPrecision &&
    (!isNewLot || Boolean(matchingLotRecord) || parsedTarget > 0) &&
    delta !== 0 &&
    Boolean(reason.trim()) &&
    Boolean(occurredOn) &&
    !isLoadingLots &&
    !loadError

  const loadLots = useCallback(async () => {
    setIsLoadingLots(true)
    setLoadError(null)

    try {
      const summary = await getInventoryItemSummary(itemId)
      if (!summary) throw new Error('ไม่พบรายการน้ำยานี้ในคลัง')

      const nextLots = summary.lots
      const firstLot = nextLots[0]
      setAvailableLots(nextLots)
      setSelectedLot(firstLot?.id ?? NEW_LOT)
      setLotNumber(firstLot?.lotNumber ?? '')
      setExpiryDate(firstLot?.expiryDate ?? '')
      setTargetQuantity(firstLot ? String(roundQuantity(firstLot.balance)) : '')
      setReason(defaultReason ?? '')
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : 'โหลดข้อมูลล็อตไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setIsLoadingLots(false)
    }
  }, [defaultReason, itemId])

  const openDialog = useCallback(() => {
    const initialLots = loadLotsOnOpen ? [] : lots
    const firstLot = initialLots[0]
    setAvailableLots(initialLots)
    setSelectedLot(firstLot?.id ?? NEW_LOT)
    setLotNumber(firstLot?.lotNumber ?? '')
    setExpiryDate(firstLot?.expiryDate ?? '')
    setTargetQuantity(firstLot ? String(roundQuantity(firstLot.balance)) : '')
    setOccurredOn(bangkokIsoDate())
    setReason(defaultReason ?? '')
    setError(null)
    setLoadError(null)
    setIsLoadingLots(loadLotsOnOpen)
    dialogRef.current?.showModal()
    if (loadLotsOnOpen) void loadLots()
  }, [defaultReason, loadLots, loadLotsOnOpen, lots])

  useEffect(() => {
    if (autoOpen && !dialogRef.current?.open) openDialog()
  }, [autoOpen, openDialog])

  const closeDialog = () => {
    if (!isPending) dialogRef.current?.close()
  }

  const changeLot = (selection: string) => {
    if (selection === NEW_LOT) {
      setSelectedLot(NEW_LOT)
      setLotNumber('')
      setExpiryDate('')
      setTargetQuantity('')
      setError(null)
      return
    }

    const nextLot = availableLots.find((lot) => lot.id === selection)
    setSelectedLot(selection)
    setLotNumber(nextLot?.lotNumber ?? '')
    setExpiryDate(nextLot?.expiryDate ?? '')
    setTargetQuantity(nextLot ? String(roundQuantity(nextLot.balance)) : '')
    setError(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    if (!canSubmit) {
      setError('กรุณาระบุเลขล็อต วันหมดอายุ ยอดที่นับได้จริง เหตุผล และวันที่ให้ครบ โดยยอดใหม่ต้องต่างจากยอดเดิม')
      return
    }

    startTransition(async () => {
      try {
        await setStockBalance(itemId, {
          inventoryLotId: isNewLot ? null : selectedLot,
          lotNumber: lotNumber.trim(),
          expiryDate,
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
      {showTrigger && (
        <Button variant="secondary" onClick={openDialog} aria-haspopup="dialog">
          ปรับยอดคงคลัง
        </Button>
      )}

      <dialog
        ref={dialogRef}
        className="app-dialog stock-adjustment-dialog"
        aria-labelledby="stock-adjustment-dialog-title"
        aria-describedby="stock-adjustment-dialog-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
        onClose={() => onClosed?.()}
      >
        <header className="app-dialog__header">
          <div>
            <p className="section-kicker">STOCK RECONCILIATION</p>
            <h2 id="stock-adjustment-dialog-title">ปรับยอดคงคลังตามล็อต</h2>
            <p id="stock-adjustment-dialog-description">
              {itemName}
            </p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างปรับยอดคงคลัง" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <form className="stock-adjustment-dialog__form" onSubmit={submit}>
          <div className="app-dialog__body stock-adjustment-dialog__body">
            {isLoadingLots && (
              <div className="stock-adjustment-dialog__loading" role="status" aria-live="polite">
                <span className="inventory-summary-dialog__loading-line inventory-summary-dialog__loading-line--wide" aria-hidden="true" />
                <p>กำลังโหลดข้อมูลล็อตและยอดคงเหลือ…</p>
              </div>
            )}

            {!isLoadingLots && loadError && (
              <div className="stock-adjustment-dialog__load-error" role="alert">
                <p>{loadError}</p>
                <Button variant="secondary" onClick={() => void loadLots()}>ลองใหม่</Button>
              </div>
            )}

            {!isLoadingLots && !loadError && (
              <>
                {availableLots.length > 0 && (
                  <label className="field-row">
                    เลือกล็อตที่ต้องการปรับ
                    <select value={selectedLot} onChange={(event) => changeLot(event.target.value)} disabled={isPending}>
                      {availableLots.map((lot) => (
                        <option key={lot.id} value={lot.id}>
                          ล็อต {lot.lotNumber} · หมดอายุ {formatThaiDate(lot.expiryDate)}
                        </option>
                      ))}
                      <option value={NEW_LOT}>＋ เพิ่มล็อตใหม่</option>
                    </select>
                    <small>หากเป็นล็อตเดิมให้เลือกจากรายการ หากยังไม่มีล็อตให้เพิ่มล็อตใหม่</small>
                  </label>
                )}

                {isNewLot && (
                  <p className="inline-alert inline-alert--info">
                    ล็อตนี้ยังไม่มีในระบบ ระบบจะสร้างล็อตพร้อมยอดตั้งต้นจากยอดที่ตรวจนับใน transaction เดียวกัน
                  </p>
                )}

                <div className="stock-adjustment-dialog__facts" aria-live="polite">
                  <div>
                    <span>ล็อตที่ปรับ</span>
                    <strong>{(matchingLotRecord?.lotNumber ?? lotNumber) || 'รอระบุเลขล็อต'}</strong>
                  </div>
                  <div>
                    <span>ยอดตามบัญชีของล็อต</span>
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
                  เลขล็อต
                  <input
                    type="text"
                    required
                    maxLength={200}
                    value={lotNumber}
                    onChange={(event) => setLotNumber(event.target.value)}
                    readOnly={!isNewLot}
                    disabled={isPending}
                  />
                </label>

                <label className="field-row">
                  วันหมดอายุ (Expired)
                  <ThaiDateInput
                    value={expiryDate}
                    onChange={setExpiryDate}
                    required
                    disabled={isPending || (!isNewLot && Boolean(selectedLotRecord?.expiryDate))}
                  />
                  {!isNewLot && !selectedLotRecord?.expiryDate && (
                    <small>ล็อตนี้ยังไม่มีวันหมดอายุ กรุณาระบุให้ครบก่อนบันทึก</small>
                  )}
                </label>

                <label className="field-row">
                  ยอดที่ตรวจนับได้จริง ({unit})
                  <QuantityInput
                    min="0"
                    step="0.001"
                    required
                    value={targetQuantity}
                    onValueChange={setTargetQuantity}
                    disabled={isPending}
                    autoFocus
                  />
                  <small>{isNewLot ? 'ล็อตใหม่ต้องมียอดมากกว่า 0' : 'ใส่ 0 ได้ หากตรวจนับแล้วไม่เหลือในล็อตนี้'}</small>
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
              </>
            )}
          </div>

          <div className="dialog-actions stock-adjustment-dialog__actions">
            {isLoadingLots || loadError ? (
              <Button variant="secondary" onClick={closeDialog}>ยกเลิก</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={closeDialog} disabled={isPending}>ยกเลิก</Button>
                <Button type="submit" disabled={isPending || !canSubmit}>
                  {isPending ? 'กำลังบันทึก…' : 'ยืนยันการปรับยอด'}
                </Button>
              </>
            )}
          </div>
        </form>
      </dialog>
    </>
  )
}
