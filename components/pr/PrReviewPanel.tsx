'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { formatQuantity } from '@/lib/inventory/presenter'
import {
  confirmPurchaseRequest,
  reversePurchaseRequest,
  setPurchaseOrderNumber,
} from '@/lib/pr/actions'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

export function PrReviewPanel({ request }: { request: PurchaseRequestRecord }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')
  const [poNumber, setPoNumber] = useState(request.poNumber ?? '')
  const [isPending, startTransition] = useTransition()

  const run = (operation: () => Promise<unknown>, fallback: string) => {
    setError(null)
    startTransition(async () => {
      try {
        await operation()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : fallback)
      }
    })
  }

  return (
    <div className="pr-review">
      {request.status === 'pending' && (
        <>
          <p className="pr-review__intro">
            ยืนยันแล้วยอดในสัญญาจะถูกตัดทันทีและย้อนกลับได้ด้วยการกลับรายการเท่านั้น
          </p>
          <div className="detail-items-table">
            <table className="data-table">
              <caption className="visually-hidden">ผลกระทบต่อยอดคงเหลือในสัญญา</caption>
              <thead>
                <tr>
                  <th>รายการ</th>
                  <th className="numeric-cell">คงเหลือปัจจุบัน</th>
                  <th className="numeric-cell">ขอตัด</th>
                  <th className="numeric-cell">คงเหลือหลังยืนยัน</th>
                </tr>
              </thead>
              <tbody>
                {request.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small className="identifier">{item.lsCode}</small>
                    </td>
                    <td className="numeric-cell identifier">
                      {item.contractRemaining === null
                        ? 'ไม่ตัดยอดสัญญา'
                        : formatQuantity(item.contractRemaining, item.unit)}
                    </td>
                    <td className="numeric-cell identifier">
                      {formatQuantity(item.requestedQuantity, item.unit)}
                    </td>
                    <td className="numeric-cell identifier">
                      {item.contractRemaining === null ? (
                        '—'
                      ) : (
                        <strong>
                          {formatQuantity(item.contractRemaining - item.requestedQuantity, item.unit)}
                        </strong>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button
            type="button"
            disabled={isPending}
            onClick={() => run(() => confirmPurchaseRequest(request.id), 'ยืนยันใบ PR ไม่สำเร็จ')}
          >
            {isPending ? 'กำลังยืนยัน…' : 'ยืนยันใบ PR'}
          </Button>
        </>
      )}

      {request.status === 'completed' && (
        <>
          <label className="field-row">
            เลขที่ใบสั่งซื้อ (บันทึกภายหลังได้ ไม่กระทบยอดที่ตัดไปแล้ว)
            <input type="text" value={poNumber} onChange={(event) => setPoNumber(event.target.value)} />
          </label>
          <div className="pr-review__actions">
            <Button
              variant="secondary"
              type="button"
              disabled={isPending || !poNumber.trim()}
              onClick={() =>
                run(
                  () => setPurchaseOrderNumber(request.id, { poNumber }),
                  'บันทึกเลขที่ใบสั่งซื้อไม่สำเร็จ',
                )
              }
            >
              บันทึกเลขที่ใบสั่งซื้อ
            </Button>
            {!reversing && (
              <Button variant="ghost" type="button" onClick={() => setReversing(true)}>
                กลับรายการใบ PR
              </Button>
            )}
          </div>

          {reversing && (
            <div className="decision-panel decision-panel--danger">
              <div>
                <strong>ยืนยันการกลับรายการ</strong>
                <p>ระบบจะบันทึกรายการตรงข้ามเพื่อคืนยอดสัญญา โดยไม่ลบประวัติเดิม</p>
              </div>
              <label>
                เหตุผลในการกลับรายการ
                <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="decision-panel__actions">
                <Button variant="secondary" type="button" onClick={() => setReversing(false)} disabled={isPending}>
                  กลับไปตรวจสอบ
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  disabled={isPending || !reason.trim()}
                  onClick={() =>
                    run(
                      () => reversePurchaseRequest(request.id, { reason }),
                      'กลับรายการใบ PR ไม่สำเร็จ',
                    )
                  }
                >
                  {isPending ? 'กำลังดำเนินการ…' : 'ยืนยันกลับรายการ'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {(request.status === 'cancelled' || request.status === 'reversed') && (
        <p className="empty-state">ใบ PR นี้ปิดแล้ว ไม่มีการดำเนินการเพิ่มเติม</p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
