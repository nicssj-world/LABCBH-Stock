'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { CatalogItemCombobox } from '@/components/ui/CatalogItemCombobox'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { formatQuantity } from '@/lib/inventory/presenter'
import { isProjectedBelowMinimum } from '@/lib/inventory/balance'
import { MINIMUM_STOCK_WARNING } from '@/lib/pr/presenter'
import { OUT_OF_STOCK_WARNING } from '@/lib/requisitions/presenter'
import { createRequisition, updateRequisition } from '@/lib/requisitions/actions'

export interface RequisitionCatalogItem {
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  note: string | null
  onHand: number
  minimumStock: number
  responsibleDepartment: string | null
}

export interface RequisitionFormInitialValues {
  requisitionId: string
  department: string
  requesterName: string
  desiredDate: string
  note: string | null
  items: {
    inventoryItemId: string
    lsCode: string
    name: string
    unit: string
    note: string | null
    requestedQuantity: number
  }[]
}

interface DraftLine {
  key: string
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  note: string
  onHand: number
  minimumStock: number
  requestedQuantity: number
}

export function RequisitionForm({
  catalog,
  departments,
  requesterName: initialRequester,
  mode = 'create',
  initialValues,
}: {
  catalog: RequisitionCatalogItem[]
  departments: readonly string[]
  requesterName: string
  mode?: 'create' | 'edit'
  initialValues?: RequisitionFormInitialValues
}) {
  const router = useRouter()
  const isEditing = mode === 'edit' && initialValues !== undefined
  const [department, setDepartment] = useState(initialValues?.department ?? departments[0] ?? '')
  const [requesterName, setRequesterName] = useState(initialValues?.requesterName ?? initialRequester)
  const [desiredDate, setDesiredDate] = useState(() => initialValues?.desiredDate ?? bangkokIsoDate())
  const [note, setNote] = useState(initialValues?.note ?? '')
  const [lines, setLines] = useState<DraftLine[]>(() =>
    (initialValues?.items ?? []).map((item, index) => {
      // The picker below only offers items with stock on hand. An existing
      // line whose item has since gone to zero is therefore missing from it,
      // and must be carried over from the saved requisition instead —
      // rebuilding lines from the picker alone would silently drop it.
      const stocked = catalog.find((entry) => entry.inventoryItemId === item.inventoryItemId)
      return {
        key: `${item.inventoryItemId}-${index}`,
        inventoryItemId: item.inventoryItemId,
        lsCode: item.lsCode,
        name: item.name,
        unit: item.unit,
        note: item.note ?? '',
        onHand: stocked?.onHand ?? 0,
        minimumStock: stocked?.minimumStock ?? 0,
        requestedQuantity: item.requestedQuantity,
      }
    }),
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Only what the store can actually hand over belongs in the picker: an item
  // sitting at zero on hand would create a line no FIFO lot could fill.
  const inStockCatalog = catalog.filter((item) => item.onHand > 0)

  // Narrows the item picker to what this department is responsible for, so the
  // list stays short as the catalog grows. Items with no department assigned
  // belong to no one in particular, so every department can still reach them.
  // If nothing matches — a department whose items were never tagged, or a
  // legacy responsibleDepartment value that doesn't match this department's
  // exact name — fall back to every in-stock item rather than leaving the picker
  // silently empty.
  const scopedCatalog = inStockCatalog.filter(
    (item) => item.responsibleDepartment === null || item.responsibleDepartment === department,
  )
  const departmentCatalog = scopedCatalog.length > 0 ? scopedCatalog : inStockCatalog
  const showingUnfilteredCatalog = scopedCatalog.length === 0 && inStockCatalog.length > 0

  const addLine = (item: RequisitionCatalogItem) => {
    setLines((current) => [
      ...current,
      {
        key: `${item.inventoryItemId}-${current.length}`,
        inventoryItemId: item.inventoryItemId,
        lsCode: item.lsCode,
        name: item.name,
        unit: item.unit,
        note: item.note ?? '',
        onHand: item.onHand,
        minimumStock: item.minimumStock,
        requestedQuantity: 1,
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

    const payload = {
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
    }

    startTransition(async () => {
      try {
        if (isEditing) {
          await updateRequisition(initialValues.requisitionId, payload)
          router.push(`/requisitions/${initialValues.requisitionId}`)
        } else {
          const created = await createRequisition(payload)
          router.push(`/requisitions/${created.id}`)
        }
        router.refresh()
      } catch (caught) {
        const fallback = isEditing
          ? 'แก้ไขใบเบิกไม่สำเร็จ กรุณาลองใหม่'
          : 'สร้างใบเบิกไม่สำเร็จ กรุณาลองใหม่'
        setError(caught instanceof Error ? caught.message : fallback)
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
            <select required value={department} onChange={(event) => setDepartment(event.target.value)}>
              {departments.map((department) => (
                <option value={department} key={department}>{department}</option>
              ))}
            </select>
          </label>
          <label className="field-row">
            ชื่อผู้ขอเบิก
            <input type="text" required value={requesterName} onChange={(event) => setRequesterName(event.target.value)} />
          </label>
          <label className="field-row">
            วันที่ขอเบิก
            <ThaiDateInput required value={desiredDate} onChange={setDesiredDate} />
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
            เลือกน้ำยาจากรายการ
            <select
              value=""
              onChange={(event) => {
                const choice = departmentCatalog.find((item) => item.inventoryItemId === event.target.value)
                if (choice) addLine(choice)
              }}
            >
              <option value="" disabled>เลือกน้ำยา…</option>
              {departmentCatalog.map((item) => (
                <option key={item.inventoryItemId} value={item.inventoryItemId}>
                  {item.lsCode} · {item.name} · คงเหลือ {formatQuantity(item.onHand, item.unit)}
                </option>
              ))}
            </select>
          </label>

          <CatalogItemCombobox
            label="หรือพิมพ์ค้นหาน้ำยา"
            placeholder="พิมพ์รหัสพัสดุ หรือชื่อน้ำยา…"
            options={departmentCatalog.map((item) => ({
              id: item.inventoryItemId,
              label: `${item.lsCode} · ${item.name}`,
              hint: `คงเหลือ ${formatQuantity(item.onHand, item.unit)} · ขั้นต่ำ ${formatQuantity(item.minimumStock, item.unit)}`,
              searchText: `${item.lsCode} ${item.name}`,
            }))}
            onSelect={(id) => {
              const choice = departmentCatalog.find((item) => item.inventoryItemId === id)
              if (choice) addLine(choice)
            }}
          />
          {departmentCatalog.length === 0 && (
            <p className="empty-state">ยังไม่มีรายการน้ำยาที่มีของคงเหลือในคลัง</p>
          )}
          {showingUnfilteredCatalog && (
            <p className="form-field-note" role="status">
              ไม่พบรายการที่ระบุหน่วยงานนี้โดยตรง จึงแสดงรายการน้ำยาทั้งหมดในคลังแทน
            </p>
          )}

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
                // Only reachable while editing: the picker never offers an item
                // at zero, but a saved line can be carried in after its stock
                // ran out. It has to stand out, because keeping it means asking
                // for something the store cannot hand over.
                const isDepleted = line.onHand <= 0

                return (
                  <li key={line.key} data-depleted={isDepleted || undefined}>
                    <div className="requisition-line__identity">
                      <span className="identifier">{line.lsCode}</span>
                      <div>
                        <strong>{line.name}</strong>
                        <small>
                          <span className={isDepleted ? 'requisition-line__depleted' : undefined}>
                            คงเหลือ {formatQuantity(line.onHand, line.unit)}
                          </span>
                          {' · '}ขั้นต่ำ {formatQuantity(line.minimumStock, line.unit)}
                        </small>
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
                          readOnly
                          aria-readonly="true"
                          className="requisition-line__readonly-note"
                          value={line.note}
                          placeholder="ไม่มีหมายเหตุ"
                        />
                      </label>
                    </div>

                    {isDepleted ? (
                      // Replaces the minimum-stock warning rather than stacking
                      // on top of it: at zero on hand that warning is always
                      // true as well, and the emptier fact is the useful one.
                      <p className="requisition-line__warning requisition-line__warning--depleted" role="status">
                        {OUT_OF_STOCK_WARNING}
                      </p>
                    ) : willBreachMinimum ? (
                      <p className="requisition-line__warning" role="status">{MINIMUM_STOCK_WARNING}</p>
                    ) : null}

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
        <p>
          {isEditing
            ? 'แก้ไขได้จนกว่าเจ้าหน้าที่คลังจะจ่ายของ ยอดคงคลังยังไม่ถูกตัดจนกว่าจะจ่ายจริง'
            : 'ส่งแล้วใบเบิกจะอยู่ในสถานะรอจ่าย เจ้าหน้าที่คลังจะเลือกล็อตตามลำดับ FIFO'}
        </p>
        <div className="form-action-bar__buttons">
          <Button
            variant="secondary"
            onClick={() =>
              router.push(isEditing ? `/requisitions/${initialValues.requisitionId}` : '/requisitions')
            }
            disabled={isPending}
          >
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending || lines.length === 0}>
            {isPending
              ? (isEditing ? 'กำลังบันทึก…' : 'กำลังส่ง…')
              : (isEditing ? 'บันทึกการแก้ไข' : 'ส่งใบเบิก')}
          </Button>
        </div>
      </div>
    </form>
  )
}
