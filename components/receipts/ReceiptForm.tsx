'use client'

import { useState, useTransition, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { StickyScroll } from '@/components/ui/StickyScroll'
import { bangkokIsoDate } from '@/lib/date/thai'
import { roundQuantity } from '@/lib/inventory/balance'
import { formatQuantity } from '@/lib/inventory/presenter'
import {
  ReceiptLinesEditor,
  type CatalogChoice,
  type ReceiptDraftLine,
} from '@/components/receipts/ReceiptLinesEditor'
import { createGoodsReceipt } from '@/lib/receipts/actions'
import { detectDuplicateLots, findOverRequestedItems } from '@/lib/receipts/schema'
import type {
  ReceivablePurchaseRequest,
  ReceivablePurchaseRequestItem,
} from '@/lib/receipts/types'

export interface ReceiptFormProps {
  catalog: CatalogChoice[]
  departments: readonly string[]
  purchaseRequests: ReceivablePurchaseRequest[]
  receiverName: string
  initialPurchaseRequestId?: string
  initialDepartment?: string
}

export function ReceiptForm({
  catalog,
  departments,
  purchaseRequests,
  receiverName: initialReceiver,
  initialPurchaseRequestId,
  initialDepartment,
}: ReceiptFormProps) {
  const router = useRouter()
  const initialRequest = purchaseRequests.find((request) => request.id === initialPurchaseRequestId)
  const [purchaseRequestId, setPurchaseRequestId] = useState(initialRequest?.id ?? '')
  const [department, setDepartment] = useState(initialDepartment ?? initialRequest?.department ?? '')
  const [receivedDate, setReceivedDate] = useState(() => bangkokIsoDate())
  const [receiverName, setReceiverName] = useState(initialReceiver)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<ReceiptDraftLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const makeDraftLine = (
    item: Pick<ReceiptDraftLine, 'inventoryItemId' | 'lsCode' | 'name' | 'unit'>,
    quantity: number,
    key: string,
  ): ReceiptDraftLine => ({
    key,
    inventoryItemId: item.inventoryItemId,
    lsCode: item.lsCode,
    name: item.name,
    lotNumber: '',
    expiryDate: '',
    quantity,
    unit: item.unit,
    storageLocation: '',
  })

  const addLine = (item: CatalogChoice) => {
    setLines((current) => [
      ...current,
      makeDraftLine(item, 1, `${item.inventoryItemId}-${crypto.randomUUID()}`),
    ])
  }

  const addPurchaseRequestLine = (item: ReceivablePurchaseRequestItem) => {
    setLines((current) => {
      const stagedQuantity = current
        .filter((line) => line.inventoryItemId === item.inventoryItemId)
        .reduce((sum, line) => sum + (line.quantity === '' ? 0 : line.quantity), 0)
      const availableQuantity = roundQuantity(item.remainingQuantity - stagedQuantity)
      if (availableQuantity <= 0) return current

      return [
        ...current,
        makeDraftLine(
          item,
          availableQuantity,
          `pr-${purchaseRequestId}-${item.inventoryItemId}-${crypto.randomUUID()}`,
        ),
      ]
    })
  }

  const changeLine = (key: string, patch: Partial<ReceiptDraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }

  // The receiving department is selected first, so a PR can never be linked
  // across departments. Selecting a PR fills its PO number and shows remaining
  // balances. A balance becomes a LOT line only when the officer adds what
  // physically arrived in this delivery.
  const departmentPurchaseRequests = purchaseRequests.filter((request) => request.department === department)
  const selectedRequest = departmentPurchaseRequests.find((request) => request.id === purchaseRequestId)

  const selectPurchaseRequest = (id: string) => {
    const request = departmentPurchaseRequests.find((candidate) => candidate.id === id)
    setPurchaseRequestId(request?.id ?? '')
    setLines([])
  }

  const changeDepartment = (nextDepartment: string) => {
    setDepartment(nextDepartment)
    // The selected PR may not belong to the newly chosen department; clear it
    // rather than leave a stale selection the dropdown no longer shows.
    if (selectedRequest && selectedRequest.department !== nextDepartment) {
      selectPurchaseRequest('')
    }
  }
  const requestedByItem = Object.fromEntries(
    (selectedRequest?.items ?? []).map((item) => [item.inventoryItemId, item.remainingQuantity]),
  )
  const stagedByItem = Object.fromEntries(
    (selectedRequest?.items ?? []).map((item) => [
      item.inventoryItemId,
      roundQuantity(lines
        .filter((line) => line.inventoryItemId === item.inventoryItemId)
        .reduce((sum, line) => sum + (line.quantity === '' ? 0 : line.quantity), 0)),
    ]),
  )

  const hasDuplicates = detectDuplicateLots(lines).length > 0
  const hasIncompleteLot = lines.some((line) => !line.lotNumber.trim())
  const hasInvalidQuantity = lines.some(
    (line) => typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity <= 0,
  )
  const hasOverRequestedLine = findOverRequestedItems(
    lines.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      quantity: line.quantity === '' ? 0 : line.quantity,
    })),
    requestedByItem,
    Boolean(purchaseRequestId),
  ).length > 0

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const created = await createGoodsReceipt({
          purchaseRequestId: purchaseRequestId || null,
          department,
          receivedDate,
          receiverName,
          note: note.trim() || null,
          items: lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            lotNumber: line.lotNumber,
            expiryDate: line.expiryDate || null,
            quantity: line.quantity === '' ? 0 : line.quantity,
            unit: line.unit,
            storageLocation: line.storageLocation.trim() || null,
          })),
        })
        router.push(`/receipts/${created.id}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'สร้างใบรับเข้าไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <form className="route-stack" onSubmit={submit}>
      <section className="bench-panel" aria-labelledby="receipt-header-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">RECEIPT HEADER</p>
            <h2 id="receipt-header-title">ข้อมูลการรับของ</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field-row">
            <span>หน่วยงานที่รับของ <span className="field-required" aria-hidden="true">*</span></span>
            <select required value={department} onChange={(event) => changeDepartment(event.target.value)} disabled={isPending}>
              <option value="" disabled>เลือกหน่วยงานที่รับของก่อน</option>
              {departments.map((department) => <option value={department} key={department}>{department}</option>)}
            </select>
            <small className="receipt-pr-hint">เลือกหน่วยงานก่อน เพื่อกรองใบ PR ที่เกี่ยวข้อง</small>
          </label>
          <label className="field-row">
            ใบ PR ที่เกี่ยวข้อง
            <select
              value={purchaseRequestId}
              onChange={(event) => selectPurchaseRequest(event.target.value)}
              disabled={!department || isPending}
            >
              <option value="">{department ? 'ไม่อ้างอิงใบ PR' : 'เลือกหน่วยงานก่อน'}</option>
              {departmentPurchaseRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.documentNumber} · {request.status === 'partially_received' ? 'รับบางส่วน' : 'ยืนยันแล้ว'}
                </option>
              ))}
            </select>
            <small className="receipt-pr-hint">
              {!department
                ? 'กรุณาเลือกหน่วยงานที่รับของก่อน'
                : departmentPurchaseRequests.length === 0
                  ? 'หน่วยงานนี้ไม่มีใบ PR ที่รอรับของ'
                  : 'เลือกใบ PR แล้วระบบจะแสดงยอดขอซื้อ รับสะสม และคงเหลือ'}
            </small>
          </label>
          <div className="field-row">
            <span>เลขที่ใบสั่งซื้อ (PO)</span>
            {selectedRequest ? (
              <Link className="identifier text-link" href={`/purchase-requests/${selectedRequest.id}`}>
                {selectedRequest.poNumber ?? 'ยังไม่มีเลขที่ใบสั่งซื้อ (PO)'}
              </Link>
            ) : (
              <span className="receipt-pr-hint">เลือกใบ PR ที่เกี่ยวข้องเพื่อแสดงเลข PO</span>
            )}
          </div>
          <label className="field-row">
            <span>วันที่รับของ <span className="field-required" aria-hidden="true">*</span></span>
            <ThaiDateInput required value={receivedDate} onChange={setReceivedDate} />
          </label>
          <label className="field-row">
            <span>ผู้รับของ <span className="field-required" aria-hidden="true">*</span></span>
            <input type="text" required value={receiverName} onChange={(event) => setReceiverName(event.target.value)} />
          </label>
          <label className="field-row form-grid__wide">
            หมายเหตุ
            <input type="text" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="bench-panel" aria-labelledby="receipt-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">LOTS RECEIVED</p>
            <h2 id="receipt-lines-title">ล็อตที่รับเข้า</h2>
          </div>
          <p>{lines.length} รายการ</p>
        </div>
        {selectedRequest && (
          <div className="receipt-pr-balance">
            <div className="receipt-pr-balance__heading">
              <div>
                <strong>ยอดคงเหลือจาก {selectedRequest.documentNumber}</strong>
                <p>ยอดส่วนนี้ยังไม่ใช่รายการรับเข้า จึงยังไม่ต้องระบุ LOT หรือวันหมดอายุ</p>
              </div>
            </div>
            <StickyScroll className="detail-items-table" ariaLabel="รายการรับเข้า เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>รายการ</th>
                    <th className="numeric-cell">ขอซื้อ</th>
                    <th className="numeric-cell">รับสะสม</th>
                    <th className="numeric-cell">คงเหลือ</th>
                    <th><span className="visually-hidden">เพิ่มเข้ารับ</span></th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRequest.items.map((item) => {
                    const stagedQuantity = stagedByItem[item.inventoryItemId] ?? 0
                    const availableQuantity = roundQuantity(item.remainingQuantity - stagedQuantity)
                    return (
                      <tr key={item.inventoryItemId}>
                        <td>
                          <strong>{item.name}</strong>
                          <small>{item.lsCode} · {item.unit}</small>
                        </td>
                        <td className="numeric-cell identifier">{formatQuantity(item.requestedQuantity, item.unit)}</td>
                        <td className="numeric-cell identifier">{formatQuantity(item.receivedQuantity, item.unit)}</td>
                        <td className="numeric-cell identifier">
                          <strong>{formatQuantity(item.remainingQuantity, item.unit)}</strong>
                          {stagedQuantity > 0 && <small>เลือกเข้ารอบนี้ {formatQuantity(stagedQuantity, item.unit)}</small>}
                        </td>
                        <td>
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isPending || availableQuantity <= 0}
                            onClick={() => addPurchaseRequestLine(item)}
                          >
                            {availableQuantity > 0 ? 'เพิ่มเข้ารับ' : 'เลือกครบแล้ว'}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </StickyScroll>
          </div>
        )}
        <ReceiptLinesEditor
          lines={lines}
          catalog={catalog}
          hasPurchaseRequest={Boolean(purchaseRequestId)}
          requestedByItem={requestedByItem}
          showCatalogPicker={!selectedRequest}
          onAdd={addLine}
          onChange={changeLine}
          onRemove={removeLine}
        />
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-action-bar">
        <p>บันทึกเป็นฉบับร่างก่อน แนบไฟล์ PO และตรวจทานแล้วจึงบันทึกเข้าคลัง</p>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.push('/receipts')} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending || lines.length === 0 || hasDuplicates || hasIncompleteLot || hasInvalidQuantity || hasOverRequestedLine}>
            {isPending ? 'กำลังบันทึก…' : 'บันทึกฉบับร่าง'}
          </Button>
        </div>
      </div>
    </form>
  )
}
