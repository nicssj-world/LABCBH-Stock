'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { formatQuantity } from '@/lib/inventory/presenter'
import { cancelGoodsReceipt, postGoodsReceipt } from '@/lib/receipts/actions'
import type { GoodsReceiptRecord } from '@/lib/receipts/types'

export function ReceiptPostPanel({ receipt }: { receipt: GoodsReceiptRecord }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancellationNote, setCancellationNote] = useState('')
  const [isPending, startTransition] = useTransition()

  if (receipt.status !== 'draft') {
    return (
      <p className="empty-state">
        {receipt.status === 'cancelled'
          ? 'ใบรับเข้านี้ถูกยกเลิกแล้ว และไม่กระทบยอดรับสะสมหรือยอดคงคลัง'
          : 'ใบรับนี้บันทึกเข้าคลังแล้ว ยอดคงเหลือแก้ไขได้ด้วยการปรับยอดที่มีเหตุผลกำกับเท่านั้น'}
      </p>
    )
  }

  const cancel = () => {
    setError(null)
    startTransition(async () => {
      try {
        await cancelGoodsReceipt(receipt.id, { note: cancellationNote.trim() || null })
        setIsCancelling(false)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ยกเลิกใบรับเข้าไม่สำเร็จ')
      }
    })
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
          ยังไม่ได้แนบไฟล์ PO แนะนำให้แนบก่อนบันทึกเข้าคลังเพื่อใช้อ้างอิงภายหลัง
        </p>
      )}
      {isCancelling && (
        <label className="field-row receipt-post__cancel-note">
          หมายเหตุการยกเลิก (ไม่บังคับ)
          <textarea
            rows={3}
            maxLength={1000}
            value={cancellationNote}
            onChange={(event) => setCancellationNote(event.target.value)}
          />
        </label>
      )}
      <div className="receipt-post__actions">
        <Button type="button" onClick={post} disabled={isPending || isCancelling}>
          {isPending && !isCancelling ? 'กำลังบันทึกเข้าคลัง…' : 'บันทึกเข้าคลัง'}
        </Button>
        {isCancelling ? (
          <>
            <Button type="button" variant="secondary" onClick={() => setIsCancelling(false)} disabled={isPending}>
              กลับไปตรวจสอบ
            </Button>
            <Button type="button" variant="danger" onClick={cancel} disabled={isPending}>
              {isPending ? 'กำลังยกเลิก…' : 'ยืนยันยกเลิกใบรับเข้า'}
            </Button>
          </>
        ) : (
          <Button type="button" variant="danger" onClick={() => setIsCancelling(true)} disabled={isPending}>
            ยกเลิกใบรับเข้า
          </Button>
        )}
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
