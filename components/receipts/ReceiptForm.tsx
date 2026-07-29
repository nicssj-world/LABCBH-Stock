'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  ReceiptLinesEditor,
  type CatalogChoice,
  type ReceiptDraftLine,
} from '@/components/receipts/ReceiptLinesEditor'
import { createGoodsReceipt } from '@/lib/receipts/actions'
import { detectDuplicateLots } from '@/lib/receipts/schema'

export interface ReceivablePurchaseRequest {
  id: string
  documentNumber: string
  poNumber: string | null
}

export interface ReceiptFormProps {
  catalog: CatalogChoice[]
  purchaseRequests: ReceivablePurchaseRequest[]
  receiverName: string
}

export function ReceiptForm({ catalog, purchaseRequests, receiverName: initialReceiver }: ReceiptFormProps) {
  const router = useRouter()
  const [purchaseRequestId, setPurchaseRequestId] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [department, setDepartment] = useState('กลุ่มงานเทคนิคการแพทย์')
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [receiverName, setReceiverName] = useState(initialReceiver)
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<ReceiptDraftLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const addLine = (item: CatalogChoice) => {
    setLines((current) => [
      ...current,
      {
        key: `${item.inventoryItemId}-${current.length}`,
        inventoryItemId: item.inventoryItemId,
        lsCode: item.lsCode,
        name: item.name,
        lotNumber: '',
        expiryDate: '',
        quantity: 1,
        unit: item.unit,
        storageLocation: '',
      },
    ])
  }

  const changeLine = (key: string, patch: Partial<ReceiptDraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }

  // Selecting a PR pre-fills its PO number, one of the values officers would
  // otherwise copy by hand.
  const selectPurchaseRequest = (id: string) => {
    setPurchaseRequestId(id)
    const request = purchaseRequests.find((candidate) => candidate.id === id)
    if (request?.poNumber) setPoNumber(request.poNumber)
  }

  const hasDuplicates = detectDuplicateLots(lines).length > 0
  const hasIncompleteLot = lines.some((line) => !line.lotNumber.trim())

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const created = await createGoodsReceipt({
          purchaseRequestId: purchaseRequestId || null,
          poNumber: poNumber.trim() || null,
          department,
          receivedDate,
          receiverName,
          note: note.trim() || null,
          items: lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            lotNumber: line.lotNumber,
            expiryDate: line.expiryDate || null,
            quantity: line.quantity,
            unit: line.unit,
            storageLocation: line.storageLocation.trim() || null,
          })),
        })
        // The draft exists before any image or stock, so an upload failure on
        // the next screen cannot strand the officer's typing.
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
            ใบ PR ที่เกี่ยวข้อง
            <select value={purchaseRequestId} onChange={(event) => selectPurchaseRequest(event.target.value)}>
              <option value="">ไม่อ้างอิงใบ PR</option>
              {purchaseRequests.map((request) => (
                <option key={request.id} value={request.id}>{request.documentNumber}</option>
              ))}
            </select>
          </label>
          <label className="field-row">
            เลขที่ใบสั่งซื้อ (PO)
            <input type="text" value={poNumber} onChange={(event) => setPoNumber(event.target.value)} />
          </label>
          <label className="field-row">
            หน่วยงานที่รับของ
            <input type="text" required value={department} onChange={(event) => setDepartment(event.target.value)} />
          </label>
          <label className="field-row">
            วันที่รับของ
            <input type="date" required value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} />
          </label>
          <label className="field-row">
            ผู้รับของ
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
        <ReceiptLinesEditor
          lines={lines}
          catalog={catalog}
          onAdd={addLine}
          onChange={changeLine}
          onRemove={removeLine}
        />
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-action-bar">
        <p>บันทึกเป็นฉบับร่างก่อน แนบภาพใบสั่งซื้อและตรวจทานแล้วจึงบันทึกเข้าคลัง</p>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.push('/receipts')} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending || lines.length === 0 || hasDuplicates || hasIncompleteLot}>
            {isPending ? 'กำลังบันทึก…' : 'บันทึกฉบับร่าง'}
          </Button>
        </div>
      </div>
    </form>
  )
}
