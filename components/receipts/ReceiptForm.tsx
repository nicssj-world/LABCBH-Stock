'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { PoFileDropzone } from '@/components/receipts/PoFileDropzone'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import {
  ReceiptLinesEditor,
  type CatalogChoice,
  type ReceiptDraftLine,
} from '@/components/receipts/ReceiptLinesEditor'
import { createGoodsReceipt, uploadPoImage } from '@/lib/receipts/actions'
import { preparePoFile } from '@/lib/receipts/po-file'
import { detectDuplicateLots, findOverRequestedItems } from '@/lib/receipts/schema'
import type { ReceivablePurchaseRequest } from '@/lib/receipts/types'

export interface ReceiptFormProps {
  catalog: CatalogChoice[]
  departments: readonly string[]
  purchaseRequests: ReceivablePurchaseRequest[]
  receiverName: string
}

export function ReceiptForm({ catalog, departments, purchaseRequests, receiverName: initialReceiver }: ReceiptFormProps) {
  const router = useRouter()
  const [purchaseRequestId, setPurchaseRequestId] = useState('')
  const [poNumber, setPoNumber] = useState('')
  const [poFile, setPoFile] = useState<File | null>(null)
  const [department, setDepartment] = useState(departments[0] ?? '')
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
      makeDraftLine(item, 1, `${item.inventoryItemId}-${current.length}`),
    ])
  }

  const changeLine = (key: string, patch: Partial<ReceiptDraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }

  // Selecting a PR pre-fills its PO number and requested lines. The officer
  // only needs to complete LOT/Expired and adjust delivered quantities.
  const selectPurchaseRequest = (id: string) => {
    setPurchaseRequestId(id)
    const request = purchaseRequests.find((candidate) => candidate.id === id)
    setPoNumber(request?.poNumber ?? '')
    setLines(
      request?.items.map((item, index) =>
        makeDraftLine(item, item.quantity, `pr-${request.id}-${item.inventoryItemId}-${index}`),
      ) ?? [],
    )
  }

  const selectedRequest = purchaseRequests.find((request) => request.id === purchaseRequestId)

  // "ใบ PR ที่เกี่ยวข้อง" only offers PRs from the department currently
  // receiving, so the list stays short as the number of open PRs grows.
  const departmentPurchaseRequests = purchaseRequests.filter((request) => request.department === department)

  const changeDepartment = (nextDepartment: string) => {
    setDepartment(nextDepartment)
    // The selected PR may not belong to the newly chosen department; clear it
    // rather than leave a stale selection the dropdown no longer shows.
    if (selectedRequest && selectedRequest.department !== nextDepartment) {
      selectPurchaseRequest('')
    }
  }
  const requestedByItem = Object.fromEntries(
    (selectedRequest?.items ?? []).map((item) => [item.inventoryItemId, item.quantity]),
  )

  const hasDuplicates = detectDuplicateLots(lines).length > 0
  const hasIncompleteLot = lines.some((line) => !line.lotNumber.trim())
  const hasOverRequestedLine = findOverRequestedItems(lines, requestedByItem, Boolean(purchaseRequestId)).length > 0

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
        // The draft exists before the evidence upload. If resizing or uploading
        // fails, the officer can retry from the receipt detail without losing
        // the lines already entered.
        if (poFile) {
          try {
            const preparedFile = await preparePoFile(poFile)
            const formData = new FormData()
            formData.set('file', preparedFile, preparedFile.name)
            await uploadPoImage(created.id, formData)
          } catch {
            router.push(`/receipts/${created.id}?poUpload=failed`)
            return
          }
        }
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
              {departmentPurchaseRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.documentNumber} · {request.items.length} รายการ
                </option>
              ))}
            </select>
            <small className="receipt-pr-hint">
              {departmentPurchaseRequests.length === 0
                ? 'หน่วยงานนี้ไม่มีใบ PR ที่รอรับของ'
                : 'เลือกใบ PR แล้วระบบจะเติมรายการและจำนวนให้โดยอัตโนมัติ'}
            </small>
          </label>
          <label className="field-row">
            เลขที่ใบสั่งซื้อ (PO)
            <input type="text" value={poNumber} onChange={(event) => setPoNumber(event.target.value)} />
          </label>
          <div className="field-row form-grid__wide">
            <span>ไฟล์ PO</span>
            <PoFileDropzone file={poFile} onChange={setPoFile} disabled={isPending} />
          </div>
          <label className="field-row">
            หน่วยงานที่รับของ
            <select required value={department} onChange={(event) => changeDepartment(event.target.value)}>
              {departments.map((department) => (
                <option value={department} key={department}>{department}</option>
              ))}
            </select>
          </label>
          <label className="field-row">
            วันที่รับของ
            <ThaiDateInput required value={receivedDate} onChange={setReceivedDate} />
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
          hasPurchaseRequest={Boolean(purchaseRequestId)}
          requestedByItem={requestedByItem}
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
          <Button type="submit" disabled={isPending || lines.length === 0 || hasDuplicates || hasIncompleteLot || hasOverRequestedLine}>
            {isPending ? 'กำลังบันทึก…' : 'บันทึกฉบับร่าง'}
          </Button>
        </div>
      </div>
    </form>
  )
}
