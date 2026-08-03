'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { LotPicker, type LotSelection } from '@/components/requisitions/LotPicker'
import { formatQuantity } from '@/lib/inventory/presenter'
import { fulfillRequisition } from '@/lib/requisitions/actions'
import { defaultLotSelection, requiresOverrideReason, validateLotAllocations } from '@/lib/requisitions/fifo'
import type { RequisitionItemRecord, SelectableLot } from '@/lib/requisitions/types'

export interface FulfillmentPanelProps {
  requisitionId: string
  items: RequisitionItemRecord[]
  lotsByItem: Record<string, SelectableLot[]>
  today: string
}

export function FulfillmentPanel({
  requisitionId,
  items,
  lotsByItem,
  today,
}: FulfillmentPanelProps) {
  const router = useRouter()
  // Pre-fill the lot the officer should take first (rank 1 — earliest to
  // expire) at the full requested quantity, capped to what that lot actually
  // has. Saves a click for the common case where one lot covers the request;
  // anything left over still has to be picked manually from later lots.
  const [selections, setSelections] = useState<Record<string, LotSelection[]>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.id,
        defaultLotSelection(lotsByItem[item.inventoryItemId] ?? [], item.requestedQuantity).map(
          (allocation) => ({ inventoryLotId: allocation.lotId, quantity: allocation.quantity }),
        ),
      ]),
    ),
  )
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const toggle = (itemId: string, lot: SelectableLot) => {
    setSelections((current) => {
      const existing = current[itemId] ?? []
      const already = existing.some((entry) => entry.inventoryLotId === lot.id)
      return {
        ...current,
        [itemId]: already
          ? existing.filter((entry) => entry.inventoryLotId !== lot.id)
          : [...existing, { inventoryLotId: lot.id, quantity: Math.min(lot.balance, 1) }],
      }
    })
  }

  const changeQuantity = (itemId: string, lotId: string, quantity: number) => {
    setSelections((current) => ({
      ...current,
      [itemId]: (current[itemId] ?? []).map((entry) =>
        entry.inventoryLotId === lotId ? { ...entry, quantity } : entry,
      ),
    }))
  }

  // Every line must balance and every skipped-ahead lot must be explained before
  // the officer can post; the RPC re-checks all of it anyway.
  const problems: string[] = []
  const overridesNeeded = new Set<string>()

  for (const item of items) {
    const lots = lotsByItem[item.inventoryItemId] ?? []
    const chosen = selections[item.id] ?? []
    if (chosen.length === 0) {
      problems.push(`${item.name}: ยังไม่ได้เลือกล็อต`)
      continue
    }

    problems.push(
      ...validateLotAllocations({
        requestedQuantity: item.requestedQuantity,
        allocations: chosen.map((entry) => ({ lotId: entry.inventoryLotId, quantity: entry.quantity })),
        lotBalances: new Map(lots.map((lot) => [lot.id, lot.balance])),
      }).map((message) => `${item.name}: ${message}`),
    )

    if (requiresOverrideReason(lots, chosen.map((entry) => entry.inventoryLotId), today)) {
      overridesNeeded.add(item.id)
      if (!reasons[item.id]?.trim()) {
        problems.push(`${item.name}: ข้ามล็อตที่ควรจ่ายก่อน ต้องระบุเหตุผล`)
      }
    }
  }

  const submit = () => {
    setError(null)
    startTransition(async () => {
      try {
        await fulfillRequisition(requisitionId, {
          allocations: items.flatMap((item) =>
            (selections[item.id] ?? []).map((entry) => ({
              requisitionItemId: item.id,
              inventoryLotId: entry.inventoryLotId,
              quantity: entry.quantity,
              overrideReason: overridesNeeded.has(item.id) ? reasons[item.id].trim() : null,
            })),
          ),
        })
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'จ่ายของตามใบเบิกไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="fulfillment-panel">
      {items.map((item) => (
        <section key={item.id} className="fulfillment-item" aria-labelledby={`fulfil-${item.id}`}>
          <div className="fulfillment-item__header">
            <div>
              <span className="identifier">{item.lsCode}</span>
              <h3 id={`fulfil-${item.id}`}>{item.name}</h3>
            </div>
            <p className="fulfillment-item__requested">
              <span>ขอเบิก</span>
              <strong>{formatQuantity(item.requestedQuantity, item.unit)}</strong>
            </p>
          </div>

          <LotPicker
            lots={lotsByItem[item.inventoryItemId] ?? []}
            selections={selections[item.id] ?? []}
            onToggle={(lot) => toggle(item.id, lot)}
            onQuantityChange={(lotId, quantity) => changeQuantity(item.id, lotId, quantity)}
          />

          {overridesNeeded.has(item.id) && (
            <label className="field-row fulfillment-item__override">
              เหตุผลที่ข้ามล็อตที่ควรจ่ายก่อน
              <input
                type="text"
                required
                value={reasons[item.id] ?? ''}
                onChange={(event) => setReasons((current) => ({ ...current, [item.id]: event.target.value }))}
              />
            </label>
          )}
        </section>
      ))}

      {problems.length > 0 && (
        <ul className="fulfillment-problems" role="status">
          {problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}

      <Button type="button" onClick={submit} disabled={isPending || problems.length > 0}>
        {isPending ? 'กำลังจ่ายของ…' : 'ยืนยันการจ่ายของ'}
      </Button>
    </div>
  )
}
