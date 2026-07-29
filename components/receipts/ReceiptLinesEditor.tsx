'use client'

import { formatQuantity } from '@/lib/inventory/presenter'
import { Button } from '@/components/ui/Button'
import { detectDuplicateLots } from '@/lib/receipts/schema'

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
  onAdd: (item: CatalogChoice) => void
  onChange: (key: string, patch: Partial<ReceiptDraftLine>) => void
  onRemove: (key: string) => void
}

export function ReceiptLinesEditor({
  lines,
  catalog,
  onAdd,
  onChange,
  onRemove,
}: ReceiptLinesEditorProps) {
  const duplicates = new Set(detectDuplicateLots(lines))
  const isDuplicate = (line: ReceiptDraftLine) =>
    duplicates.has(`${line.inventoryItemId}::${line.lotNumber.trim().toUpperCase()}`)

  return (
    <div className="receipt-lines">
      <label className="field-row">
        เพิ่มน้ำยาเข้าใบรับ
        <select
          value=""
          onChange={(event) => {
            const choice = catalog.find((item) => item.inventoryItemId === event.target.value)
            if (choice) onAdd(choice)
          }}
        >
          <option value="">เลือกน้ำยา…</option>
          {catalog.map((item) => (
            <option key={item.inventoryItemId} value={item.inventoryItemId}>
              {item.lsCode} · {item.name}
            </option>
          ))}
        </select>
      </label>

      {duplicates.size > 0 && (
        <p className="inline-alert" role="status">
          พบล็อตซ้ำในใบรับเดียวกัน กรุณารวมเป็นบรรทัดเดียวก่อนบันทึก
        </p>
      )}

      {lines.length === 0 ? (
        <p className="empty-state">ยังไม่ได้เพิ่มรายการรับเข้า</p>
      ) : (
        <ul className="receipt-line-list">
          {lines.map((line) => (
            <li key={line.key} className={isDuplicate(line) ? 'receipt-line--duplicate' : undefined}>
              <div className="receipt-line__identity">
                <span className="identifier">{line.lsCode}</span>
                <strong>{line.name}</strong>
              </div>

              <div className="receipt-line__fields">
                <label className="field-row">
                  เลขที่ล็อต
                  <input
                    type="text"
                    required
                    value={line.lotNumber}
                    onChange={(event) => onChange(line.key, { lotNumber: event.target.value })}
                  />
                </label>
                <label className="field-row">
                  วันหมดอายุ
                  <input
                    type="date"
                    value={line.expiryDate}
                    onChange={(event) => onChange(line.key, { expiryDate: event.target.value })}
                  />
                </label>
                <label className="field-row">
                  จำนวน ({line.unit})
                  <input
                    type="number"
                    min="0.001"
                    step="0.001"
                    required
                    value={line.quantity}
                    onChange={(event) => onChange(line.key, { quantity: Number(event.target.value) })}
                  />
                </label>
                <label className="field-row">
                  จัดเก็บที่
                  <input
                    type="text"
                    value={line.storageLocation}
                    onChange={(event) => onChange(line.key, { storageLocation: event.target.value })}
                  />
                </label>
              </div>

              <Button variant="ghost" onClick={() => onRemove(line.key)}>นำออก</Button>
            </li>
          ))}
        </ul>
      )}

      <p className="items-editor__grand-total">
        <span>รวมที่รับเข้า</span>
        <strong>{formatQuantity(lines.reduce((sum, line) => sum + line.quantity, 0))}</strong>
      </p>
    </div>
  )
}
