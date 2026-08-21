'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { formatQuantity, formatThaiDateTime } from '@/lib/inventory/presenter'
import { closePurchaseRequestRemaining } from '@/lib/pr/actions'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

export function PurchaseRequestRemainingClosePanel({ request }: { request: PurchaseRequestRecord }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const hasDraftReceipt = request.receiptHistory.some((receipt) => receipt.status === 'draft')
  const remainingItems = request.items.filter((item) => item.remainingQuantity > 0)

  const submit = () => {
    setError(null)
    startTransition(async () => {
      try {
        await closePurchaseRequestRemaining(request.id, { reason })
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ปิดยอดคงเหลือไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="decision-panel decision-panel--danger pr-short-close">
      <div>
        <strong>ปิดยอดคงเหลือที่ยังไม่ได้รับ</strong>
        <p>
          การดำเนินการนี้จะหยุดการรับเข้าต่อของ PR นี้ แต่ไม่เปลี่ยนยอดรับสะสมและไม่ลบประวัติใบรับเข้า
          ยอดที่เหลือจะถูกเก็บไว้เพื่อการตรวจสอบย้อนหลัง
        </p>
      </div>

      <div className="pr-short-close__remaining">
        <span>รายการที่ยังเหลือ</span>
        <strong>{remainingItems.length} รายการ</strong>
        <ul>
          {remainingItems.map((item) => (
            <li key={item.id}>
              <span>{item.name}</span>
              <strong>{formatQuantity(item.remainingQuantity, item.unit)}</strong>
            </li>
          ))}
        </ul>
      </div>

      {hasDraftReceipt && (
        <p className="inline-alert" role="alert">
          ต้องยกเลิกใบรับเข้าฉบับร่างของ PR นี้ก่อน จึงจะปิดยอดคงเหลือได้
        </p>
      )}

      <label className="field-row">
        เหตุผลในการปิดยอดคงเหลือ
        <textarea
          required
          minLength={1}
          maxLength={1000}
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={isPending || hasDraftReceipt}
          placeholder="เช่น ผู้ขายยืนยันยกเลิกยอดที่เหลือใน PO"
        />
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="decision-panel__actions">
        <Button
          variant="danger"
          type="button"
          disabled={isPending || hasDraftReceipt || !reason.trim()}
          onClick={submit}
        >
          {isPending ? 'กำลังปิดยอด…' : 'ยืนยันปิดยอดไม่ครบ'}
        </Button>
      </div>
    </div>
  )
}

export function PurchaseRequestShortClosedAudit({ request }: { request: PurchaseRequestRecord }) {
  return (
    <div className="pr-review__closed">
      <p className="pr-review__intro">
        ปิดยอดไม่ครบโดย {request.closedShortByName ?? 'เจ้าหน้าที่คลัง'} · {formatThaiDateTime(request.closedShortAt)}
      </p>
      {request.closedShortReason && (
        <p className="pr-review__intro">เหตุผลที่ปิดยอด: {request.closedShortReason}</p>
      )}
      <p className="pr-review__intro">PR นี้ไม่เปิดให้สร้างใบรับเข้าเพิ่มเติมแล้ว</p>
    </div>
  )
}
