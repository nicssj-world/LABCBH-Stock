'use client'

import { formatQuantity } from '@/lib/inventory/presenter'
import { Button } from '@/components/ui/Button'
import { CatalogItemCombobox } from '@/components/ui/CatalogItemCombobox'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { detectDuplicateLots, findOverRequestedItems } from '@/lib/receipts/schema'

export interface ReceiptDraftLine {
  key: string
  inventoryItemId: string
  lsCode: string
  name: string
  lotNumber: string
  expiryDate: string
  quantity: number
  unit: string
  storageLocation: string
}

export interface CatalogChoice {
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
}

export interface ReceiptLinesEditorProps {
  lines: ReceiptDraftLine[]
  catalog: CatalogChoice[]
  hasPurchaseRequest?: boolean
  requestedByItem?: Record<string, number>
  showCatalogPicker?: boolean
  onAdd: (item: CatalogChoice) => void
  onChange: (key: string, patch: Partial<ReceiptDraftLine>) => void
  onRemove: (key: string) => void
}

export function ReceiptLinesEditor({
  lines,
  catalog,
  hasPurchaseRequest = false,
  requestedByItem = {},
  showCatalogPicker = true,
  onAdd,
  onChange,
  onRemove,
}: ReceiptLinesEditorProps) {
  const duplicates = new Set(detectDuplicateLots(lines))
  const isDuplicate = (line: ReceiptDraftLine) =>
    duplicates.has(`${line.inventoryItemId}::${line.lotNumber.trim().toUpperCase()}`)

  // A reagent can be split across lots (several lines share one inventoryItemId);
  // this flags every line in a group whose combined quantity exceeds what the
  // referenced PR still has available for that item.
  const overRequested = new Set(findOverRequestedItems(lines, requestedByItem, hasPurchaseRequest))
  const isOverRequested = (line: ReceiptDraftLine) => overRequested.has(line.inventoryItemId)
  const isUnrequested = (line: ReceiptDraftLine) =>
    hasPurchaseRequest && !(line.inventoryItemId in requestedByItem)

  return (
    <div className="receipt-lines">
      {showCatalogPicker && (
        <CatalogItemCombobox
          label="เพิ่มน้ำยาเข้าใบรับ"
          placeholder="พิมพ์รหัสพัสดุ หรือชื่อน้ำยา…"
          options={catalog.map((item) => ({
            id: item.inventoryItemId,
            label: `${item.lsCode} · ${item.name}`,
            hint: `หน่วย ${item.unit} · หลังเลือกให้กรอกเลขล็อตและจำนวน`,
            searchText: `${item.lsCode} ${item.name}`,
          }))}
          onSelect={(id) => {
            const choice = catalog.find((item) => item.inventoryItemId === id)
            if (choice) onAdd(choice)
          }}
        />
      )}

      {duplicates.size > 0 && (
        <p className="inline-alert" role="status">
          พบล็อตซ้ำในใบรับเดียวกัน กรุณารวมเป็นบรรทัดเดียวก่อนบันทึก
        </p>
      )}

      {lines.length === 0 ? (
        <p className="empty-state">ยังไม่ได้เพิ่มรายการรับเข้า</p>
      ) : (
        <>
          {hasPurchaseRequest && (
            <p className="receipt-lines__hint" role="status">
              ด้านล่างคือรายการที่เลือกมารับจริงในรอบนี้เท่านั้น กรุณากรอก LOT และจำนวนที่ได้รับ
            </p>
          )}
          <ul className="receipt-line-list">
            {lines.map((line) => (
              <li
                key={line.key}
                className={
                    isDuplicate(line)
                      ? 'receipt-line--duplicate'
                    : isOverRequested(line)
                      ? 'receipt-line--over-requested'
                      : undefined
                }
              >
                <div className="receipt-line__identity">
                  <span className="identifier">{line.lsCode}</span>
                  <strong>{line.name}</strong>
                </div>

                <div className="receipt-line__fields">
                  <label className="field-row">
                    LOT (เลขที่ล็อต)
                    <input
                      type="text"
                      required
                      value={line.lotNumber}
                      placeholder="ระบุ LOT"
                      onChange={(event) => onChange(line.key, { lotNumber: event.target.value })}
                    />
                  </label>
                  <label className="field-row">
                    Expired (วันหมดอายุ)
                    <ThaiDateInput
                      value={line.expiryDate}
                      onChange={(expiryDate) => onChange(line.key, { expiryDate })}
                    />
                  </label>
                  <label className="field-row">
                    จำนวน ({line.unit})
                    <input
                      type="number"
                      min="0.001"
                      step="0.001"
                      required
                      aria-invalid={isOverRequested(line)}
                      value={line.quantity}
                      onChange={(event) => onChange(line.key, { quantity: Number(event.target.value) })}
                    />
                    {isUnrequested(line) ? (
                      <small className="field-error">
                        รายการนี้ไม่มีอยู่ในใบ PR ที่เลือก
                      </small>
                    ) : isOverRequested(line) && (
                      <small className="field-error">
                        เกินยอดคงเหลือที่รับได้ ({formatQuantity(requestedByItem[line.inventoryItemId], line.unit)})
                      </small>
                    )}
                  </label>
                </div>

                <Button variant="ghost" onClick={() => onRemove(line.key)}>นำออก</Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="items-editor__grand-total">
        <span>รวมที่รับเข้า</span>
        <strong>{formatQuantity(lines.reduce((sum, line) => sum + line.quantity, 0))}</strong>
      </p>
    </div>
  )
}
