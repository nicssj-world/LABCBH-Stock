'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircleIcon } from '@/components/inventory/InventoryDetailIcons'
import { StockAdjustmentDialog } from '@/components/inventory/StockAdjustmentDialog'
import { Button } from '@/components/ui/Button'
import { formatQuantity, formatThaiDateTime } from '@/lib/inventory/presenter'
import { recordInventoryStockCheck } from '@/lib/inventory/actions'
import type { InventoryItemRecord, InventoryStockCheckResult } from '@/lib/inventory/types'

const WEEKLY_STOCK_CHECK_REASON = 'ตรวจนับสต๊อกประจำสัปดาห์'

interface InventoryChecklistTableProps {
  items: InventoryItemRecord[]
  currentWeekStart: string
}

interface StockCheckButtonProps {
  item: InventoryItemRecord
  isChecked: boolean
  onChecked: (result: InventoryStockCheckResult) => void
}

function StockCheckButton({ item, isChecked, onChecked }: StockCheckButtonProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const handleCheck = () => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await recordInventoryStockCheck(item.id)
        onChecked(result)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกการตรวจนับไม่สำเร็จ กรุณาลองใหม่')
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
        aria-label={isChecked ? `บันทึกการตรวจนับซ้ำ ${item.name}` : `บันทึกว่าตรวจนับแล้ว ${item.name}`}
        onClick={handleCheck}
        disabled={isPending}
      >
        <CheckCircleIcon />
        <span>{isPending ? 'กำลังบันทึก…' : 'ตรวจแล้ว'}</span>
      </Button>
      <small>{isChecked ? 'กดซ้ำเพื่อบันทึกการตรวจครั้งใหม่' : 'ปรับยอดให้ตรงก่อนกดตรวจ'}</small>
      {error && <span className="inventory-checklist__error" role="alert">{error}</span>}
    </div>
  )
}

function ChecklistIdentity({ item, onAdjust }: { item: InventoryItemRecord; onAdjust: () => void }) {
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

export function InventoryChecklistTable({ items, currentWeekStart }: InventoryChecklistTableProps) {
  const [adjustmentItemId, setAdjustmentItemId] = useState<string | null>(null)
  const [activeWeekStart, setActiveWeekStart] = useState(currentWeekStart)
  const [checkOverrides, setCheckOverrides] = useState<Record<string, InventoryStockCheckResult>>({})

  // The server supplies the business-week boundary. If a check crosses the
  // boundary while this page is still open, the returned week_start becomes
  // authoritative immediately; the following refresh then remounts the table
  // with the new server-derived week.
  const getOverride = (itemId: string) => {
    const override = checkOverrides[itemId]
    return override?.weekStart === activeWeekStart ? override : undefined
  }

  const orderedItems = [...items].sort((left, right) => {
    const leftChecked = Boolean(getOverride(left.id)) || (activeWeekStart === currentWeekStart && left.isStockCheckedThisWeek)
    const rightChecked = Boolean(getOverride(right.id)) || (activeWeekStart === currentWeekStart && right.isStockCheckedThisWeek)
    if (leftChecked !== rightChecked) return Number(leftChecked) - Number(rightChecked)
    return left.lsCode.localeCompare(right.lsCode, 'th', { numeric: true, sensitivity: 'base' })
  })

  const checkedCount = orderedItems.filter((item) => Boolean(getOverride(item.id)) || (activeWeekStart === currentWeekStart && item.isStockCheckedThisWeek)).length
  const adjustmentItem = orderedItems.find((item) => item.id === adjustmentItemId) ?? null

  const getCheckedAt = (item: InventoryItemRecord) => getOverride(item.id)?.checkedAt ?? ((activeWeekStart === currentWeekStart) ? item.lastStockCheckedAt : null)
  const isChecked = (item: InventoryItemRecord) => Boolean(getOverride(item.id)) || (activeWeekStart === currentWeekStart && item.isStockCheckedThisWeek)
  const markChecked = (itemId: string, result: InventoryStockCheckResult) => {
    setActiveWeekStart(result.weekStart)
    setCheckOverrides((current) => ({ ...current, [itemId]: result }))
  }

  return (
    <>
      <div className="inventory-checklist__progress" aria-live="polite">
        <strong>{checkedCount} / {orderedItems.length}</strong>
        <span>รายการตรวจแล้วในสัปดาห์นี้</span>
      </div>

      <div className="inventory-checklist-table--desktop">
        <table className="data-table">
          <thead>
            <tr>
              <th>น้ำยา / รหัส LS</th>
              <th className="numeric-cell">ยอดคงเหลือปัจจุบัน</th>
              <th>ตรวจนับล่าสุด</th>
              <th>สถานะและการดำเนินการ</th>
            </tr>
          </thead>
          <tbody>
            {orderedItems.map((item) => {
              const currentIsChecked = isChecked(item)
              return (
                <tr key={item.id}>
                  <td><ChecklistIdentity item={item} onAdjust={() => setAdjustmentItemId(item.id)} /></td>
                  <td className="numeric-cell identifier inventory-checklist__balance">
                    {formatQuantity(item.onHand, item.baseUnit)}
                  </td>
                  <td><LatestCheck checkedAt={getCheckedAt(item)} /></td>
                  <td>
                    <div className="inventory-checklist__status">
                      <span className={`inventory-checklist__status-copy${currentIsChecked ? ' is-complete' : ''}`}>
                        {currentIsChecked ? 'ตรวจแล้วในสัปดาห์นี้' : 'ยังไม่ได้ตรวจสัปดาห์นี้'}
                      </span>
                      <StockCheckButton item={item} isChecked={currentIsChecked} onChecked={(result) => markChecked(item.id, result)} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <ul className="inventory-checklist-cards">
        {orderedItems.map((item) => {
          const currentIsChecked = isChecked(item)
          return (
            <li className="inventory-checklist__card" key={item.id}>
              <div className="inventory-checklist__card-topline">
                <ChecklistIdentity item={item} onAdjust={() => setAdjustmentItemId(item.id)} />
                <span className={`inventory-checklist__status-copy${currentIsChecked ? ' is-complete' : ''}`}>
                  {currentIsChecked ? 'ตรวจแล้ว' : 'รอตรวจ'}
                </span>
              </div>
              <dl className="inventory-checklist__card-facts">
                <div>
                  <dt>ยอดคงเหลือปัจจุบัน</dt>
                  <dd className="identifier">{formatQuantity(item.onHand, item.baseUnit)}</dd>
                </div>
                <div>
                  <dt>ตรวจนับล่าสุด</dt>
                  <dd><LatestCheck checkedAt={getCheckedAt(item)} /></dd>
                </div>
              </dl>
              <StockCheckButton item={item} isChecked={currentIsChecked} onChecked={(result) => markChecked(item.id, result)} />
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
