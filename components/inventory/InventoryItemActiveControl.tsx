'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setInventoryItemActive } from '@/lib/inventory/actions'

interface InventoryItemActiveControlProps {
  itemId: string
  isActive: boolean
  /** Table-row footprint: a small text link instead of a full button. */
  compact?: boolean
}

export function InventoryItemActiveControl({ itemId, isActive, compact = false }: InventoryItemActiveControlProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const label = isActive ? 'ปิดใช้งาน' : 'เปิดใช้งานอีกครั้ง'

  const toggle = () => {
    setError(null)
    startTransition(async () => {
      try {
        await setInventoryItemActive(itemId, { isActive: !isActive })
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `${label}ไม่สำเร็จ กรุณาลองใหม่`)
      }
    })
  }

  if (compact) {
    return (
      <>
        <button type="button" className="text-link" onClick={toggle} disabled={isPending}>
          {isPending ? 'กำลังบันทึก…' : label}
        </button>
        {error && <small className="field-error">{error}</small>}
      </>
    )
  }

  return (
    <div>
      <Button variant={isActive ? 'secondary' : 'primary'} onClick={toggle} disabled={isPending}>
        {isPending ? 'กำลังบันทึก…' : label}
      </Button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
