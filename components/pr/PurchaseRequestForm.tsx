'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ContractItemPicker, type PickerOption } from '@/components/pr/ContractItemPicker'
import { PurchaseMethodFields, type ContractOption } from '@/components/pr/PurchaseMethodFields'
import { formatQuantity } from '@/lib/inventory/presenter'
import { createPurchaseRequest } from '@/lib/pr/actions'
import { formatBaht } from '@/lib/pr/presenter'
import { calculateLineTotal, type PurchaseMethod } from '@/lib/pr/schema'

export interface CatalogOption {
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  defaultUnitPrice: number
  onHand: number
  averageMonthlyUsage: number
  belowMinimum: boolean
}

export interface ContractLineOption extends CatalogOption {
  contractItemId: string
  contractId: number
  contractRemaining: number
}

export interface PurchaseRequestFormProps {
  department: string
  headName: string
  contracts: ContractOption[]
  contractLines: ContractLineOption[]
  catalog: CatalogOption[]
}

interface DraftLine {
  key: string
  inventoryItemId: string
  contractItemId: string | null
  lsCode: string
  name: string
  unit: string
  unitPrice: number
  requestedQuantity: number
}

export function PurchaseRequestForm({
  department: initialDepartment,
  headName: initialHeadName,
  contracts,
  contractLines,
  catalog,
}: PurchaseRequestFormProps) {
  const router = useRouter()
  const [department, setDepartment] = useState(initialDepartment)
  const [headName, setHeadName] = useState(initialHeadName)
  const [requestedDate, setRequestedDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [method, setMethod] = useState<PurchaseMethod>({ kind: 'off_plan' })
  const [lines, setLines] = useState<DraftLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // A contract purchase picks from that contract's remaining lines; every other
  // method picks straight from the catalogue and consumes no contracted amount.
  const options: PickerOption[] = useMemo(() => {
    if (method.kind === 'contract') {
      return contractLines
        .filter((line) => line.contractId === method.contractId && line.contractRemaining > 0)
        .map((line) => ({
          inventoryItemId: line.inventoryItemId,
          contractItemId: line.contractItemId,
          lsCode: line.lsCode,
          name: line.name,
          unit: line.unit,
          unitPrice: line.defaultUnitPrice,
          contractRemaining: line.contractRemaining,
          onHand: line.onHand,
          averageMonthlyUsage: line.averageMonthlyUsage,
          belowMinimum: line.belowMinimum,
        }))
    }

    return catalog.map((item) => ({
      inventoryItemId: item.inventoryItemId,
      contractItemId: null,
      lsCode: item.lsCode,
      name: item.name,
      unit: item.unit,
      unitPrice: item.defaultUnitPrice,
      contractRemaining: null,
      onHand: item.onHand,
      averageMonthlyUsage: item.averageMonthlyUsage,
      belowMinimum: item.belowMinimum,
    }))
  }, [method, contractLines, catalog])

  const addLine = (option: PickerOption) => {
    setLines((current) => [
      ...current,
      {
        key: option.contractItemId ?? option.inventoryItemId,
        inventoryItemId: option.inventoryItemId,
        contractItemId: option.contractItemId,
        lsCode: option.lsCode,
        name: option.name,
        unit: option.unit,
        unitPrice: option.unitPrice,
        requestedQuantity: 1,
      },
    ])
  }

  const updateLine = (key: string, patch: Partial<DraftLine>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)))
  }

  const removeLine = (key: string) => {
    setLines((current) => current.filter((line) => line.key !== key))
  }

  // Switching method invalidates the picked lines, because contract lines and
  // catalogue lines are not interchangeable.
  const changeMethod = (next: PurchaseMethod) => {
    setMethod(next)
    setLines([])
  }

  const total = lines.reduce(
    (sum, line) => sum + calculateLineTotal(line.requestedQuantity, line.unitPrice),
    0,
  )

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)

    startTransition(async () => {
      try {
        const created = await createPurchaseRequest({
          department,
          headName,
          requestedDate,
          note: note.trim() || null,
          method,
          items: lines.map((line) => ({
            inventoryItemId: line.inventoryItemId,
            contractItemId: line.contractItemId,
            requestedQuantity: line.requestedQuantity,
            unit: line.unit,
            unitPrice: line.unitPrice,
          })),
        })
        router.push(`/purchase-requests/${created.id}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'สร้างใบ PR ไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <form className="route-stack" onSubmit={submit}>
      <section className="bench-panel" aria-labelledby="pr-header-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST HEADER</p>
            <h2 id="pr-header-title">ข้อมูลผู้ขอ</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field-row">
            หน่วยงานผู้ขอ
            <input type="text" required value={department} onChange={(event) => setDepartment(event.target.value)} />
          </label>
          <label className="field-row">
            ชื่อหัวหน้ากลุ่มงาน
            <input type="text" required value={headName} onChange={(event) => setHeadName(event.target.value)} />
          </label>
          <label className="field-row">
            วันที่ขอซื้อ
            <input type="date" required value={requestedDate} onChange={(event) => setRequestedDate(event.target.value)} />
          </label>
          <label className="field-row form-grid__wide">
            หมายเหตุ
            <input type="text" maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="bench-panel" aria-labelledby="pr-method-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">PURCHASE METHOD</p>
            <h2 id="pr-method-title">เลือกวิธีจัดซื้อหนึ่งวิธี</h2>
          </div>
        </div>
        <PurchaseMethodFields method={method} contracts={contracts} onChange={changeMethod} />
      </section>

      <section className="bench-panel" aria-labelledby="pr-picker-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">SELECT ITEMS</p>
            <h2 id="pr-picker-title">เลือกรายการที่ต้องการขอซื้อ</h2>
          </div>
          <p>{options.length} รายการที่เลือกได้</p>
        </div>
        <ContractItemPicker
          options={options}
          selectedIds={lines.map((line) => line.key)}
          onAdd={addLine}
        />
      </section>

      <section className="bench-panel" aria-labelledby="pr-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST LINES</p>
            <h2 id="pr-lines-title">รายการในใบ PR</h2>
          </div>
          <p>{lines.length} รายการ</p>
        </div>

        {lines.length === 0 ? (
          <p className="empty-state">ยังไม่ได้เลือกรายการ กรุณาเลือกจากรายการด้านบน</p>
        ) : (
          <div className="detail-items-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>รหัส LS</th>
                  <th>ชื่อน้ำยา</th>
                  <th className="numeric-cell">จำนวนที่ขอ</th>
                  <th>หน่วย</th>
                  <th className="numeric-cell">ราคาต่อหน่วย</th>
                  <th className="numeric-cell">รวม</th>
                  <th><span className="visually-hidden">นำออก</span></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key}>
                    <td className="identifier">{line.lsCode}</td>
                    <td>{line.name}</td>
                    <td className="numeric-cell">
                      <input
                        type="number"
                        min="0.001"
                        step="0.001"
                        required
                        aria-label={`จำนวนที่ขอของ ${line.name}`}
                        value={line.requestedQuantity}
                        onChange={(event) =>
                          updateLine(line.key, { requestedQuantity: Number(event.target.value) })
                        }
                      />
                    </td>
                    <td>{line.unit}</td>
                    <td className="numeric-cell">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        aria-label={`ราคาต่อหน่วยของ ${line.name}`}
                        value={line.unitPrice}
                        onChange={(event) => updateLine(line.key, { unitPrice: Number(event.target.value) })}
                      />
                    </td>
                    <td className="numeric-cell identifier">
                      <strong>{formatBaht(calculateLineTotal(line.requestedQuantity, line.unitPrice))}</strong>
                    </td>
                    <td>
                      <Button variant="ghost" onClick={() => removeLine(line.key)}>นำออก</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="items-editor__grand-total">
          <span>ยอดรวมทั้งใบ PR</span>
          <strong>{formatBaht(total)}</strong>
        </p>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-action-bar">
        <p>
          ส่งแล้วใบ PR จะรอเจ้าหน้าที่คลังยืนยัน ยอดในสัญญาจะถูกตัดเมื่อยืนยันเท่านั้น
          {lines.length > 0 && ` · ${formatQuantity(lines.length)} รายการ`}
        </p>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.push('/purchase-requests')} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending || lines.length === 0}>
            {isPending ? 'กำลังส่ง…' : 'ส่งใบ PR'}
          </Button>
        </div>
      </div>
    </form>
  )
}
