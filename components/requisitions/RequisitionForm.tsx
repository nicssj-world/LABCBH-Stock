'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { formatQuantity } from '@/lib/inventory/presenter'
import { isProjectedBelowMinimum } from '@/lib/inventory/balance'
import { MINIMUM_STOCK_WARNING } from '@/lib/pr/presenter'
import { createRequisition } from '@/lib/requisitions/actions'

export interface RequisitionCatalogItem {
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  onHand: number
  minimumStock: number
}

interface DraftLine {
  key: string
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  onHand: number
  minimumStock: number
  requestedQuantity: number
  note: string
}

export function RequisitionForm({
  catalog,
  requesterName: initialRequester,
}: {
  catalog: RequisitionCatalogItem[]
  requesterName: string
}) {
  const router = useRouter()
  const [department, setDepartment] = useState('กลุ่มงานเทคนิคการแพทย์')
  const [requesterName, setRequesterName] = useState(initialRequester)
  const [desiredDate, setDesiredDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const addLine = (item: RequisitionCatalogItem) => {
    setLines((current) => [
      ...current,
      {
        key: `${item.inventoryItemId}-${current.length}`,
        inventoryItemId: item.inventoryItemId,
        lsCode: item.lsCode,
        name: item.name,
        unit: item.unit,
        onHand: item.onHand,
        minimumStock: item.minimumStock,
        requestedQuantity: 1,
        note: '',
      },
    ])
  }

  const changeLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const created = await createRequisition({
          department,
          requesterName,
          desiredDate,
          note: note.trim() || null,
          items: lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            requestedQuantity: line.requestedQuantity,
            unit: line.unit,
            note: line.note.trim() || null,
          })),
        })
        router.push(`/requisitions/${created.id}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'สร้างใบเบิกไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <form className="route-stack" onSubmit={submit}>
      <section className="bench-panel" aria-labelledby="requisition-header-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST HEADER</p>
            <h2 id="requisition-header-title">ข้อมูลผู้ขอเบิก</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field-row">
            หน่วยงานผู้ขอเบิก
            <input type="text" required value={department} onChange={(event) => setDepartment(event.target.value)} />
          </label>
          <label className="field-row">
            ชื่อผู้ขอเบิก
            <input type="text" required value={requesterName} onChange={(event) => setRequesterName(event.target.value)} />
          </label>
          <label className="field-row">
            วันที่ต้องการรับของ
            <input type="date" required value={desiredDate} onChange={(event) => setDesiredDate(event.target.value)} />
          </label>
          <label className="field-row form-grid__wide">
            หมายเหตุ
            <input type="text" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="bench-panel" aria-labelledby="requisition-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST LINES</p>
            <h2 id="requisition-lines-title">รายการที่ขอเบิก</h2>
          </div>
          <p>{lines.length} รายการ</p>
        </div>

        <div className="requisition-lines">
          <label className="field-row">
            เพิ่มน้ำยาเข้าใบเบิก
            <select
              value=""
              onChange={(event) => {
                const choice = catalog.find((item) => item.inventoryItemId === event.target.value)
                if (choice) addLine(choice)
              }}
            >
              <option value="">เลือกน้ำยา…</option>
              {catalog.map((item) => (
                <option key={item.inventoryItemId} value={item.inventoryItemId}>
                  {item.lsCode} · {item.name} (คงเหลือ {formatQuantity(item.onHand, item.unit)})
                </option>
              ))}
            </select>
          </label>

          {lines.length === 0 ? (
            <p className="empty-state">ยังไม่ได้เลือกรายการที่ต้องการเบิก</p>
          ) : (
            <ul className="requisition-line-list">
              {lines.map((line) => {
                // A warning, never a block: an urgent requisition must still go
                // through even when it dips below the minimum.
                const willBreachMinimum = isProjectedBelowMinimum({
                  onHand: line.onHand,
                  minimum: line.minimumStock,
                  issueQuantity: line.requestedQuantity,
                })

                return (
                  <li key={line.key}>
                    <div className="requisition-line__identity">
                      <span className="identifier">{line.lsCode}</span>
                      <div>
                        <strong>{line.name}</strong>
                        <small>คงเหลือ {formatQuantity(line.onHand, line.unit)} · ขั้นต่ำ {formatQuantity(line.minimumStock, line.unit)}</small>
                      </div>
                    </div>

                    <div className="requisition-line__fields">
                      <label className="field-row">
                        จำนวนที่ขอ ({line.unit})
                        <input
                          type="number"
                          min="0.001"
                          step="0.001"
                          required
                          value={line.requestedQuantity}
                          onChange={(event) =>
                            changeLine(line.key, { requestedQuantity: Number(event.target.value) })
                          }
                        />
                      </label>
                      <label className="field-row">
                        หมายเหตุ
                        <input
                          type="text"
                          maxLength={500}
                          value={line.note}
                          onChange={(event) => changeLine(line.key, { note: event.target.value })}
                        />
                      </label>
                    </div>

                    {willBreachMinimum && (
                      <p className="requisition-line__warning" role="status">{MINIMUM_STOCK_WARNING}</p>
                    )}

                    <Button variant="ghost" onClick={() => removeLine(line.key)}>นำออก</Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-action-bar">
        <p>ส่งแล้วใบเบิกจะอยู่ในสถานะรอจ่าย เจ้าหน้าที่คลังจะเลือกล็อตตามลำดับ FIFO</p>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.push('/requisitions')} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending || lines.length === 0}>
            {isPending ? 'กำลังส่ง…' : 'ส่งใบเบิก'}
          </Button>
        </div>
      </div>
    </form>
  )
}
