'use client'

import { getInventoryItemSummary } from '@/lib/inventory/actions'
import {
  INACTIVE_STATUS_TONE,
  LOT_EXPIRY_LABELS,
  LOT_EXPIRY_TONES,
  STOCK_LEVEL_LABELS,
  STOCK_LEVEL_TONES,
  formatBaht,
  formatQuantity,
  formatThaiDate,
  formatThaiDateTime,
} from '@/lib/inventory/presenter'
import type { InventoryItemRecord, InventoryItemSummary } from '@/lib/inventory/types'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { Button } from '@/components/ui/Button'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { useState, useTransition } from 'react'

interface InventoryItemSummaryDialogProps {
  item: InventoryItemRecord
  variant?: 'table' | 'card'
}

export function InventoryItemSummaryDialog({ item, variant = 'table' }: InventoryItemSummaryDialogProps) {
  const { dialogRef, isRendered, open: openDialog, unmount: unmountDialog } = useDeferredDialog()
  const [summary, setSummary] = useState<InventoryItemSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const dialogId = `inventory-summary-dialog-${item.id}-${variant}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`

  const loadSummary = () => {
    setSummary(null)
    setError(null)
    if (!dialogRef.current?.open) openDialog()

    startTransition(async () => {
      try {
        const nextSummary = await getInventoryItemSummary(item.id)
        if (!nextSummary) throw new Error('ไม่พบรายการน้ำยานี้ในคลัง')
        setSummary(nextSummary)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'โหลดรายละเอียดน้ำยาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  const closeSummary = () => {
    unmountDialog()
    setSummary(null)
    setError(null)
  }

  return (
    <>
      <button
        type="button"
        className={`list-summary-trigger list-summary-trigger--${variant}`}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        aria-label={`ดูรายละเอียดแบบย่อ ${item.name}`}
        title="ดูรายละเอียดน้ำยาแบบย่อ"
        onClick={loadSummary}
      >
        {variant === 'table' ? <strong>{item.name}</strong> : item.name}
      </button>

      {isRendered && (
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog list-summary-dialog inventory-summary-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          aria-busy={isPending}
          onCancel={(event) => {
            event.preventDefault()
            closeSummary()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeSummary()
          }}
        >
          <header className="app-dialog__header">
            <div>
              <h2 id={titleId}>{item.name}</h2>
              <p id={descriptionId}>รายละเอียดน้ำยาแบบย่อ · {item.lsCode}</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดรายละเอียดน้ำยา" onClick={closeSummary}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body list-summary-dialog__body inventory-summary-dialog__body">
            {isPending && (
              <div className="inventory-summary-dialog__loading" role="status" aria-live="polite">
                <span className="inventory-summary-dialog__loading-line inventory-summary-dialog__loading-line--wide" aria-hidden="true" />
                <span className="inventory-summary-dialog__loading-line" aria-hidden="true" />
                <p>กำลังโหลดข้อมูล lot และยอดคงเหลือ…</p>
              </div>
            )}

            {!isPending && error && (
              <div className="inventory-summary-dialog__error" role="alert">
                <p>{error}</p>
                <Button variant="secondary" onClick={loadSummary}>ลองใหม่</Button>
              </div>
            )}

            {!isPending && !error && summary && (
              <>
                <dl className="list-summary-dialog__facts inventory-summary-dialog__facts">
                  <div>
                    <dt>รหัสพัสดุ</dt>
                    <dd className="identifier">{summary.lsCode}</dd>
                  </div>
                  <div>
                    <dt>หน่วยนับ</dt>
                    <dd>{summary.baseUnit}</dd>
                  </div>
                  <div>
                    <dt>หน่วยงานที่รับผิดชอบ</dt>
                    <dd>{summary.responsibleDepartment ?? 'ไม่ระบุ'}</dd>
                  </div>
                  <div>
                    <dt>ราคาต่อหน่วย</dt>
                    <dd className="identifier">{formatBaht(summary.defaultUnitPrice)}</dd>
                  </div>
                  <div className="list-summary-dialog__fact--wide inventory-summary-dialog__fact--balance">
                    <dt>คงเหลือรวม</dt>
                    <dd className="identifier">{formatQuantity(summary.onHand, summary.baseUnit)}</dd>
                  </div>
                  <div className="list-summary-dialog__fact--wide inventory-summary-dialog__fact--check">
                    <dt>ตรวจนับสต๊อกล่าสุด</dt>
                    <dd className="identifier">
                      {summary.lastStockCheckedAt ? formatThaiDateTime(summary.lastStockCheckedAt) : 'ยังไม่เคยตรวจ'}
                    </dd>
                    <small>
                      {summary.isStockCheckedThisWeek ? 'ตรวจครบทุก lot ในสัปดาห์นี้' : 'ยังตรวจไม่ครบทุก lot ในสัปดาห์นี้'}
                    </small>
                  </div>
                  <div>
                    <dt>ขั้นต่ำ</dt>
                    <dd className="identifier">{formatQuantity(summary.minimumStock, summary.baseUnit)}</dd>
                  </div>
                  <div>
                    <dt>สถานะ</dt>
                    <dd className="inventory-summary-dialog__status">
                      {!summary.isActive ? (
                        <StatusChip tone={INACTIVE_STATUS_TONE}>ปิดใช้งาน</StatusChip>
                      ) : (
                        <StatusChip tone={STOCK_LEVEL_TONES[summary.stockLevel]}>
                          {STOCK_LEVEL_LABELS[summary.stockLevel]}
                        </StatusChip>
                      )}
                    </dd>
                  </div>
                  {summary.note && (
                    <div className="list-summary-dialog__fact--wide inventory-summary-dialog__fact--note">
                      <dt>หมายเหตุ</dt>
                      <dd>{summary.note}</dd>
                    </div>
                  )}
                </dl>

                <section className="list-summary-dialog__items inventory-summary-dialog__lots" aria-labelledby={`${dialogId}-lots-title`}>
                  <div className="list-summary-dialog__items-heading">
                    <h3 id={`${dialogId}-lots-title`}>Lot และวันหมดอายุ</h3>
                    <span>{summary.lots.length} lot</span>
                  </div>
                  {summary.lots.length > 0 ? (
                    <ul className="list-summary-dialog__item-list inventory-summary-dialog__lot-list">
                      {summary.lots.map((lot) => (
                        <li key={lot.id} className="list-summary-dialog__item">
                          <div className="list-summary-dialog__item-identity">
                            <strong>{lot.lotNumber}</strong>
                            <small>หมดอายุ {formatThaiDate(lot.expiryDate)}</small>
                          </div>
                          <div className="list-summary-dialog__item-value inventory-summary-dialog__lot-value">
                            <strong>{formatQuantity(lot.balance, summary.baseUnit)}</strong>
                            {!lot.isActive ? (
                              <StatusChip tone={INACTIVE_STATUS_TONE}>ปิดใช้งาน</StatusChip>
                            ) : (
                              <StatusChip tone={LOT_EXPIRY_TONES[lot.expiryStatus]}>{LOT_EXPIRY_LABELS[lot.expiryStatus]}</StatusChip>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="list-summary-dialog__items-empty">ยังไม่มี lot ของรายการนี้</p>
                  )}
                </section>
              </>
            )}
          </div>

          <footer className="list-summary-dialog__footer">
            <DetailIconLink
              href={`/inventory/${item.id}`}
              label={`เปิดรายละเอียดเต็มของ ${item.name}`}
              title="เปิดรายละเอียดเต็ม"
              onClick={closeSummary}
            />
            <Button variant="secondary" onClick={closeSummary}>ปิด</Button>
          </footer>
        </dialog>
      )}
    </>
  )
}
