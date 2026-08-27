'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircleIcon } from '@/components/inventory/InventoryDetailIcons'
import { StockAdjustmentDialog } from '@/components/inventory/StockAdjustmentDialog'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import {
  INACTIVE_STATUS_TONE,
  LOT_EXPIRY_LABELS,
  LOT_EXPIRY_TONES,
  formatQuantity,
  formatThaiDate,
  formatThaiDateTime,
} from '@/lib/inventory/presenter'
import { recordInventoryLotStockCheck } from '@/lib/inventory/actions'
import type {
  InventoryChecklistItemRecord,
  InventoryChecklistLotRecord,
  InventoryLotStockCheckResult,
} from '@/lib/inventory/types'

const WEEKLY_STOCK_CHECK_REASON = 'ตรวจนับสต๊อกประจำสัปดาห์'

interface InventoryChecklistTableProps {
  items: InventoryChecklistItemRecord[]
  currentWeekStart: string
}

interface LotStockCheckButtonProps {
  item: InventoryChecklistItemRecord
  lot: InventoryChecklistLotRecord
  isChecked: boolean
  onChecked: (result: InventoryLotStockCheckResult) => void
}

function LotStockCheckButton({ item, lot, isChecked, onChecked }: LotStockCheckButtonProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleCheck = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await recordInventoryLotStockCheck(item.id, lot.id)
        onChecked(result)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกการตรวจนับล็อตไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <div className="inventory-checklist__check-control">
      <Button
        className={`inventory-checklist__check-button${isChecked ? ' is-checked' : ''}`}
        variant="secondary"
        type="button"
        aria-pressed={isChecked}
        aria-busy={isPending}
        aria-label={isChecked ? `บันทึกการตรวจนับซ้ำ lot ${lot.lotNumber}` : `บันทึกว่าตรวจนับแล้ว lot ${lot.lotNumber}`}
        onClick={handleCheck}
        disabled={isPending}
      >
        <CheckCircleIcon />
        <span>{isPending ? 'กำลังบันทึก…' : isChecked ? 'ตรวจซ้ำ' : 'ตรวจ lot นี้'}</span>
      </Button>
      <small>{isChecked ? 'กดซ้ำเพื่อบันทึกการตรวจครั้งใหม่' : 'ปรับยอดให้ตรงก่อนกดตรวจ'}</small>
      {error && <span className="inventory-checklist__error" role="alert">{error}</span>}
    </div>
  )
}

function ChecklistIdentity({ item, onAdjust }: { item: InventoryChecklistItemRecord; onAdjust: () => void }) {
  return (
    <div className="inventory-checklist__identity">
      <button
        type="button"
        className="inventory-checklist__name"
        onClick={onAdjust}
        aria-haspopup="dialog"
        aria-label={`เปิด popup ปรับยอด ${item.name}`}
        title={`ปรับยอดคงเหลือ ${item.name}`}
      >
        {item.name}
      </button>
      <span className="inventory-checklist__code identifier">{item.lsCode}</span>
      {item.responsibleDepartment && <small className="inventory-checklist__department">{item.responsibleDepartment}</small>}
    </div>
  )
}

function LatestCheck({ checkedAt }: { checkedAt: string | null }) {
  return checkedAt ? (
    <time className="inventory-checklist__latest" dateTime={checkedAt}>{formatThaiDateTime(checkedAt)}</time>
  ) : (
    <span className="inventory-checklist__latest inventory-checklist__latest--empty">ยังไม่เคยตรวจ</span>
  )
}

function LotChecklist({
  item,
  isLotChecked,
  getLotCheckedAt,
  onChecked,
}: {
  item: InventoryChecklistItemRecord
  isLotChecked: (lot: InventoryChecklistLotRecord) => boolean
  getLotCheckedAt: (lot: InventoryChecklistLotRecord) => string | null
  onChecked: (result: InventoryLotStockCheckResult) => void
}) {
  const checkedCount = item.checklistLots.filter(isLotChecked).length

  if (item.checklistLots.length === 0) {
    return (
      <div className="inventory-checklist__lot-empty">
        <strong>ไม่พบ lot ที่มี stock</strong>
        <small>กรุณาตรวจสอบและผูกยอดคงเหลือกับ lot ก่อน</small>
      </div>
    )
  }

  return (
    <details className="inventory-checklist__lots" open>
      <summary>
        <span>ตรวจ lot แล้ว {checkedCount}/{item.checklistLots.length}</span>
        <span className="inventory-checklist__lots-summary-hint">ดูรายละเอียด</span>
      </summary>
      <ul className="inventory-checklist__lot-list">
        {item.checklistLots.map((lot) => {
          const isChecked = isLotChecked(lot)
          return (
            <li className={`inventory-checklist__lot${isChecked ? ' is-checked' : ''}`} key={lot.id}>
              <div className="inventory-checklist__lot-copy">
                <div className="inventory-checklist__lot-heading">
                  <strong className="identifier">LOT {lot.lotNumber}</strong>
                  {!lot.isActive ? (
                    <StatusChip tone={INACTIVE_STATUS_TONE}>ปิดใช้งาน</StatusChip>
                  ) : (
                    <StatusChip tone={LOT_EXPIRY_TONES[lot.expiryStatus]}>
                      {LOT_EXPIRY_LABELS[lot.expiryStatus]}
                    </StatusChip>
                  )}
                </div>
                <div className="inventory-checklist__lot-facts">
                  <span>หมดอายุ {formatThaiDate(lot.expiryDate)}</span>
                  <span className="identifier">ระบบ {formatQuantity(lot.balance, item.baseUnit)}</span>
                </div>
                <LatestCheck checkedAt={getLotCheckedAt(lot)} />
              </div>
              <LotStockCheckButton item={item} lot={lot} isChecked={isChecked} onChecked={onChecked} />
            </li>
          )
        })}
      </ul>
    </details>
  )
}

export function InventoryChecklistTable({ items, currentWeekStart }: InventoryChecklistTableProps) {
  const [adjustmentItemId, setAdjustmentItemId] = useState<string | null>(null)
  const [activeWeekStart, setActiveWeekStart] = useState(currentWeekStart)
  const [checkOverrides, setCheckOverrides] = useState<Record<string, InventoryLotStockCheckResult>>({})

  // The server supplies the business-week boundary. If a check crosses the
  // boundary while this page is still open, the returned week_start becomes
  // authoritative immediately; the following refresh then remounts the table
  // with the new server-derived week.
  const getOverride = (lotId: string) => {
    const override = checkOverrides[lotId]
    return override?.weekStart === activeWeekStart ? override : undefined
  }

  const isLotChecked = (lot: InventoryChecklistLotRecord) => (
    Boolean(getOverride(lot.id)) || (activeWeekStart === currentWeekStart && lot.isStockCheckedThisWeek)
  )

  const getLotCheckedAt = (lot: InventoryChecklistLotRecord) => (
    getOverride(lot.id)?.checkedAt ?? ((activeWeekStart === currentWeekStart) ? lot.lastStockCheckedAt : null)
  )

  const isItemChecked = (item: InventoryChecklistItemRecord) => (
    item.checklistLots.length > 0 && item.checklistLots.every(isLotChecked)
  )

  const getItemCheckedAt = (item: InventoryChecklistItemRecord) => {
    const latestLotCheck = item.checklistLots
      .map(getLotCheckedAt)
      .filter((checkedAt): checkedAt is string => Boolean(checkedAt))
      .sort()
      .at(-1)

    return latestLotCheck ?? ((activeWeekStart === currentWeekStart) ? item.lastStockCheckedAt : null)
  }

  const orderedItems = [...items].sort((left, right) => {
    const leftChecked = isItemChecked(left)
    const rightChecked = isItemChecked(right)
    if (leftChecked !== rightChecked) return Number(leftChecked) - Number(rightChecked)
    return left.lsCode.localeCompare(right.lsCode, 'th', { numeric: true, sensitivity: 'base' })
  })

  const checkedCount = orderedItems.filter(isItemChecked).length
  const checkedLotCount = orderedItems.reduce((total, item) => total + item.checklistLots.filter(isLotChecked).length, 0)
  const totalLotCount = orderedItems.reduce((total, item) => total + item.checklistLots.length, 0)
  const adjustmentItem = orderedItems.find((item) => item.id === adjustmentItemId) ?? null
  const markLotChecked = (result: InventoryLotStockCheckResult) => {
    setActiveWeekStart(result.weekStart)
    setCheckOverrides((current) => ({ ...current, [result.inventoryLotId]: result }))
  }

  return (
    <>
      <div className="inventory-checklist__progress" aria-live="polite">
        <strong>{checkedCount} / {orderedItems.length}</strong>
        <span>รายการตรวจครบทุก lot ในสัปดาห์นี้ · {checkedLotCount}/{totalLotCount} lot</span>
      </div>

      <div className="inventory-checklist-table--desktop">
        <table className="data-table">
          <thead>
            <tr>
              <th>น้ำยา / รหัส LS</th>
              <th className="numeric-cell">ยอดคงเหลือรวม</th>
              <th>รายการ lot</th>
              <th>ตรวจนับล่าสุด</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {orderedItems.map((item) => {
              const currentIsChecked = isItemChecked(item)
              const checkedLots = item.checklistLots.filter(isLotChecked).length
              return (
                <tr key={item.id}>
                  <td><ChecklistIdentity item={item} onAdjust={() => setAdjustmentItemId(item.id)} /></td>
                  <td className="numeric-cell identifier inventory-checklist__balance">
                    {formatQuantity(item.onHand, item.baseUnit)}
                  </td>
                  <td className="inventory-checklist__lot-cell">
                    <LotChecklist
                      item={item}
                      isLotChecked={isLotChecked}
                      getLotCheckedAt={getLotCheckedAt}
                      onChecked={markLotChecked}
                    />
                    {item.checklistLots.length > 0 && (
                      <span className="inventory-checklist__lot-count">{checkedLots}/{item.checklistLots.length} lot ตรวจแล้ว</span>
                    )}
                  </td>
                  <td><LatestCheck checkedAt={getItemCheckedAt(item)} /></td>
                  <td>
                    <span className={`inventory-checklist__status-copy${currentIsChecked ? ' is-complete' : ''}`}>
                      {currentIsChecked ? 'ตรวจครบทุก lot แล้ว' : item.checklistLots.length > 0 ? `ตรวจแล้ว ${checkedLots}/${item.checklistLots.length} lot` : 'ต้องจัดการ lot ก่อนตรวจ'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="inventory-checklist-cards">
        {orderedItems.map((item) => {
          const currentIsChecked = isItemChecked(item)
          const checkedLots = item.checklistLots.filter(isLotChecked).length
          return (
            <li className="inventory-checklist__card" key={item.id}>
              <div className="inventory-checklist__card-topline">
                <ChecklistIdentity item={item} onAdjust={() => setAdjustmentItemId(item.id)} />
                <span className={`inventory-checklist__status-copy${currentIsChecked ? ' is-complete' : ''}`}>
                  {currentIsChecked ? 'ตรวจครบทุก lot' : item.checklistLots.length > 0 ? `${checkedLots}/${item.checklistLots.length} lot` : 'ต้องจัดการ lot'}
                </span>
              </div>
              <dl className="inventory-checklist__card-facts">
                <div>
                  <dt>ยอดคงเหลือรวม</dt>
                  <dd className="identifier">{formatQuantity(item.onHand, item.baseUnit)}</dd>
                </div>
                <div>
                  <dt>ตรวจนับล่าสุด</dt>
                  <dd><LatestCheck checkedAt={getItemCheckedAt(item)} /></dd>
                </div>
              </dl>
              <LotChecklist
                item={item}
                isLotChecked={isLotChecked}
                getLotCheckedAt={getLotCheckedAt}
                onChecked={markLotChecked}
              />
            </li>
          )
        })}
      </ul>

      {adjustmentItem && (
        <StockAdjustmentDialog
          itemId={adjustmentItem.id}
          itemName={adjustmentItem.name}
          unit={adjustmentItem.baseUnit}
          lots={[]}
          defaultReason={WEEKLY_STOCK_CHECK_REASON}
          loadLotsOnOpen
          autoOpen
          showTrigger={false}
          onClosed={() => setAdjustmentItemId(null)}
        />
      )}
    </>
  )
}
