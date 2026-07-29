'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { formatQuantity } from '@/lib/inventory/presenter'
import { postGoodsReceipt } from '@/lib/receipts/actions'
import type { GoodsReceiptRecord } from '@/lib/receipts/types'

export function ReceiptPostPanel({ receipt }: { receipt: GoodsReceiptRecord }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (receipt.status !== 'draft') {
    return (
      <p className="empty-state">
        ใบรับนี้บันทึกเข้าคลังแล้ว ยอดคงเหลือแก้ไขได้ด้วยการปรับยอดที่มีเหตุผลกำกับเท่านั้น
      </p>
    )
  }

  const post = () => {
    setError(null)
    startTransition(async () => {
      try {
        await postGoodsReceipt(receipt.id)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกรับเข้าคลังไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="receipt-post">
      <p className="receipt-post__intro">
        บันทึกแล้วระบบจะสร้างล็อตและลงบัญชีรับเข้า {formatQuantity(receipt.totalQuantity)} หน่วย จาก{' '}
        {receipt.items.length} รายการ · กดซ้ำจะไม่ทำให้ยอดเพิ่มซ้ำ
      </p>
      {!receipt.poImagePath && (
        <p className="inline-alert" role="status">
          ยังไม่ได้แนบภาพใบสั่งซื้อ แนะนำให้แนบก่อนบันทึกเข้าคลังเพื่อใช้อ้างอิงภายหลัง
        </p>
      )}
      <Button type="button" onClick={post} disabled={isPending}>
        {isPending ? 'กำลังบันทึกเข้าคลัง…' : 'บันทึกเข้าคลัง'}
      </Button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
