'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { PowerIcon } from '@/components/inventory/InventoryDetailIcons'
import { Button } from '@/components/ui/Button'
import { setInventoryItemActive } from '@/lib/inventory/actions'

interface InventoryItemActiveControlProps {
  itemId: string
  isActive: boolean
  /** Table-row footprint: an icon-only action instead of a full button. */
  compact?: boolean
}

export function InventoryItemActiveControl({ itemId, isActive, compact = false }: InventoryItemActiveControlProps) {
  const router = useRouter()
  const [currentIsActive, setCurrentIsActive] = useState(isActive)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const label = currentIsActive ? 'ปิดใช้งาน' : 'เปิดใช้งานอีกครั้ง'

  const toggle = () => {
    const nextIsActive = !currentIsActive
    setError(null)
    startTransition(async () => {
      try {
        await setInventoryItemActive(itemId, { isActive: nextIsActive })
        setCurrentIsActive(nextIsActive)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `${label}ไม่สำเร็จ กรุณาลองใหม่`)
      }
    })
  }

  if (compact) {
    return (
      <span className="inventory-action-control">
        <button
          type="button"
          className={`inventory-action-icon ${isActive ? 'inventory-action-icon--danger' : 'inventory-action-icon--success'}`}
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

  return (
    <div>
      <Button variant={currentIsActive ? 'secondary' : 'primary'} onClick={toggle} disabled={isPending}>
        {isPending ? 'กำลังบันทึก…' : label}
      </Button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
