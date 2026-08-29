'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { CatalogItemCombobox } from '@/components/ui/CatalogItemCombobox'
import { QuantityInput } from '@/components/ui/QuantityInput'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { formatQuantity } from '@/lib/inventory/presenter'
import { isProjectedBelowMinimum } from '@/lib/inventory/balance'
import { getRequisitionItemDepartments } from '@/lib/organization/departments'
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
  usableOnHand: number
  waitingReserved: number
  availableToRequest: number
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
  availableToRequest: number
  minimumStock: number
  // Keep the input blank while the requester is editing it. Converting an
  // empty number input with Number('') would turn it back into zero.
  requestedQuantity: number | ''
}

export function RequisitionForm({
  catalog,
  departments,
  requesterDepartment,
  requesterName: initialRequester,
  mode = 'create',
  initialValues,
}: {
  catalog: RequisitionCatalogItem[]
  departments: readonly string[]
  requesterDepartment?: string | null
  requesterName: string
  mode?: 'create' | 'edit'
  initialValues?: RequisitionFormInitialValues
}) {
  const router = useRouter()
  const isEditing = mode === 'edit' && initialValues !== undefined
  const autoDepartment = requesterDepartment?.trim() ?? ''
  const [department, setDepartment] = useState(
    initialValues?.department ?? (autoDepartment || departments[0] || ''),
  )
  const [requesterName, setRequesterName] = useState(initialValues?.requesterName ?? initialRequester)
  const [desiredDate, setDesiredDate] = useState(() => initialValues?.desiredDate ?? bangkokIsoDate())
  const [note, setNote] = useState(initialValues?.note ?? '')
  const [lines, setLines] = useState<DraftLine[]>(() =>
    (initialValues?.items ?? []).map((item, index) => {
      // The picker below only offers items with available stock. An existing
      // line whose item has since become unavailable is therefore missing from it,
      // and must be carried over from the saved requisition instead —
      // rebuilding lines from the picker alone would silently drop it.
      const stocked = catalog.find((entry) => entry.inventoryItemId === item.inventoryItemId)
      const availableToRequest = stocked
        ? Math.max(
            stocked.usableOnHand - Math.max(stocked.waitingReserved - item.requestedQuantity, 0),
            0,
          )
        : 0
      return {
        key: `${item.inventoryItemId}-${index}`,
        inventoryItemId: item.inventoryItemId,
        lsCode: item.lsCode,
        name: item.name,
        unit: item.unit,
        note: item.note ?? '',
        onHand: stocked?.onHand ?? 0,
        availableToRequest,
        minimumStock: stocked?.minimumStock ?? 0,
        requestedQuantity: item.requestedQuantity,
      }
    }),
  )
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // A waiting requisition reserves stock, so physical on-hand can be positive
  // while the item is no longer available for a new request.
  const availableCatalog = catalog.filter((item) => item.availableToRequest > 0)

  // The browsable dropdown is deliberately scoped to the requester's work
  // unit and the four shared operational units. The type-ahead search below
  // uses the full active, reservation-aware catalogue instead.
  const eligibleDepartments = getRequisitionItemDepartments(department)
  const departmentCatalog = availableCatalog.filter(
    (item) => item.responsibleDepartment !== null && eligibleDepartments.includes(item.responsibleDepartment),
  )
  const selectedItemIds = new Set(lines.map((line) => line.inventoryItemId))
  const selectableDepartmentCatalog = departmentCatalog.filter((item) => !selectedItemIds.has(item.inventoryItemId))
  // Search is intentionally not department-scoped. `availableCatalog` already
  // contains active inventory only, and its availability value accounts for
  // usable lots minus waiting requisition reservations.
  const searchableCatalog = availableCatalog.filter((item) => !selectedItemIds.has(item.inventoryItemId))
  const departmentPickerInstruction = departmentCatalog.length === 0
    ? 'ขณะนี้ไม่มีรายการน้ำยาที่เบิกได้ในขอบเขตหน่วยงานของ dropdown'
    : selectableDepartmentCatalog.length === 0
      ? 'เลือกรายการน้ำยาที่เบิกได้ในหน่วยงานนี้ครบแล้ว'
      : undefined
  const searchPickerInstruction = availableCatalog.length === 0
    ? 'ขณะนี้ไม่มีรายการน้ำยา Active ที่มีจำนวนเบิกได้'
    : searchableCatalog.length === 0
      ? 'เลือกรายการน้ำยาในคลังครบแล้ว'
      : 'พิมพ์รหัสพัสดุ หรือชื่อรายการ เพื่อค้นหาจากน้ำยา Active ที่ยังเบิกได้ทุกหน่วยงาน'

  const hasAvailabilityError = lines.some((line) => {
    const quantity = line.requestedQuantity
    return (
      typeof quantity !== 'number' ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > line.availableToRequest
    )
  })

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
        availableToRequest: item.availableToRequest,
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

    if (hasAvailabilityError) {
      setError('มีรายการที่ขอเกินยอดที่เบิกได้ กรุณาตรวจสอบจำนวนอีกครั้ง')
      return
    }

    const payload = {
      department,
      requesterName,
      desiredDate,
      note: note.trim() || null,
      items: lines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        requestedQuantity: line.requestedQuantity === '' ? 0 : line.requestedQuantity,
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
            <span>หน่วยงานผู้ขอเบิก <span className="field-required" aria-hidden="true">*</span></span>
            <select
              required
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
            >
              {departments.map((department) => (
                <option value={department} key={department}>{department}</option>
              ))}
            </select>
          </label>
          <label className="field-row">
            <span>ชื่อผู้ขอเบิก <span className="field-required" aria-hidden="true">*</span></span>
            <input type="text" required value={requesterName} onChange={(event) => setRequesterName(event.target.value)} />
          </label>
          <label className="field-row">
            <span>วันที่ขอเบิก <span className="field-required" aria-hidden="true">*</span></span>
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
              disabled={selectableDepartmentCatalog.length === 0}
              value=""
              onChange={(event) => {
                const choice = selectableDepartmentCatalog.find((item) => item.inventoryItemId === event.target.value)
                if (choice) addLine(choice)
              }}
            >
              <option value="" disabled>เลือกน้ำยา…</option>
              {selectableDepartmentCatalog.map((item) => (
                <option key={item.inventoryItemId} value={item.inventoryItemId}>
                  {item.lsCode} · {item.name} · เบิกได้อีก {formatQuantity(item.availableToRequest, item.unit)}
                </option>
              ))}
            </select>
          </label>

          <CatalogItemCombobox
            label="หรือพิมพ์ค้นหาน้ำยา"
            placeholder="พิมพ์รหัสพัสดุ หรือชื่อน้ำยา…"
            options={searchableCatalog.map((item) => ({
              id: item.inventoryItemId,
              label: `${item.lsCode} · ${item.name}`,
              hint: `เบิกได้อีก ${formatQuantity(item.availableToRequest, item.unit)} · คงเหลือจริง ${formatQuantity(item.onHand, item.unit)}`,
              searchText: `${item.lsCode} ${item.name}`,
            }))}
            instruction={searchPickerInstruction}
            disabled={searchableCatalog.length === 0}
            onSelect={(id) => {
              const choice = searchableCatalog.find((item) => item.inventoryItemId === id)
              if (choice) addLine(choice)
            }}
          />
          {departmentCatalog.length === 0 && (
            <p className="requisition-picker-status" role="status">{departmentPickerInstruction}</p>
          )}
          {departmentCatalog.length > 0 && selectableDepartmentCatalog.length === 0 && (
            <p className="requisition-picker-status" role="status">{departmentPickerInstruction}</p>
          )}

          {lines.length === 0 ? (
            <p className="empty-state">ยังไม่ได้เลือกรายการที่ต้องการเบิก</p>
          ) : (
            <ul className="requisition-line-list">
              {lines.map((line) => {
                const requestedQuantity = line.requestedQuantity === '' ? 0 : line.requestedQuantity
                // Falling below the minimum is still only a warning. Exceeding
                // the reservation-aware available quantity is a hard block.
                const willBreachMinimum = isProjectedBelowMinimum({
                  onHand: line.onHand,
                  minimum: line.minimumStock,
                  issueQuantity: requestedQuantity,
                })
                // Only reachable while editing: the picker never offers an item
                // at zero, but a saved line can be carried in after its stock
                // ran out. It has to stand out, because keeping it means asking
                // for something the store cannot hand over.
                const isDepleted = line.onHand <= 0
                const isOverAvailable = requestedQuantity > line.availableToRequest

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
                          {' · '}เบิกได้อีก {formatQuantity(line.availableToRequest, line.unit)}
                          {' · '}ขั้นต่ำ {formatQuantity(line.minimumStock, line.unit)}
                        </small>
                      </div>
                    </div>

                    <div className="requisition-line__fields">
                      <label className="field-row">
                        <span>จำนวนที่ขอ ({line.unit}) <span className="field-required" aria-hidden="true">*</span></span>
                        <QuantityInput
                          min="0.001"
                          max={line.availableToRequest}
                          step="0.001"
                          required
                          value={line.requestedQuantity}
                          onValueChange={(value) => changeLine(line.key, { requestedQuantity: value === '' ? '' : Number(value) })}
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
                    ) : isOverAvailable ? (
                      <p className="requisition-line__warning requisition-line__warning--unavailable" role="alert">
                        ขอเกินยอดที่เบิกได้ ขณะนี้เบิกได้อีก {formatQuantity(line.availableToRequest, line.unit)}
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
            ? 'แก้ไขได้จนกว่าเจ้าหน้าที่คลังจะจ่ายของ ระบบจะคำนวณและกันยอดตามรายการใหม่ทันทีเมื่อบันทึก'
            : 'ส่งแล้วระบบจะกันยอดไว้ทันทีในสถานะรอจ่าย และตัดยอดจริงเมื่อเจ้าหน้าที่คลังจ่ายของ'}
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
          <Button type="submit" disabled={isPending || lines.length === 0 || hasAvailabilityError}>
            {isPending
              ? (isEditing ? 'กำลังบันทึก…' : 'กำลังส่ง…')
              : (isEditing ? 'บันทึกการแก้ไข' : 'ส่งใบเบิก')}
          </Button>
        </div>
      </div>
    </form>
  )
}
