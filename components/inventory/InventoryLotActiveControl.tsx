'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PowerIcon } from '@/components/inventory/InventoryDetailIcons'
import { setInventoryLotActive } from '@/lib/inventory/actions'

interface InventoryLotActiveControlProps {
  lotId: string
  inventoryItemId: string
  lotNumber: string
  isActive: boolean
}

export function InventoryLotActiveControl({
  lotId,
  inventoryItemId,
  lotNumber,
  isActive,
}: InventoryLotActiveControlProps) {
  const router = useRouter()
  const [currentIsActive, setCurrentIsActive] = useState(isActive)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const label = currentIsActive ? `ปิดใช้งาน Lot ${lotNumber}` : `เปิดใช้งาน Lot ${lotNumber}`

  const toggle = () => {
    const nextIsActive = !currentIsActive
    setError(null)
    startTransition(async () => {
      try {
        await setInventoryLotActive(lotId, inventoryItemId, { isActive: nextIsActive })
        setCurrentIsActive(nextIsActive)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `${label}ไม่สำเร็จ กรุณาลองใหม่`)
      }
    })
  }

  return (
    <span className="inventory-action-control lot-table__action">
      <button
        type="button"
        className={`inventory-action-icon ${currentIsActive ? 'inventory-action-icon--danger' : 'inventory-action-icon--success'}`}
        onClick={toggle}
        disabled={isPending}
        aria-label={isPending ? `กำลัง${label}` : label}
        aria-busy={isPending}
        title={label}
      >
        <PowerIcon />
      </button>
      {error && <small className="field-error" role="alert">{error}</small>}
    </span>
  )
}
