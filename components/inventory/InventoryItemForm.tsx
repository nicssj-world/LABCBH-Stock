'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createInventoryItem } from '@/lib/inventory/actions'

interface InventoryItemFormProps {
  departments: readonly string[]
}

interface FormState {
  lsCode: string
  name: string
  baseUnit: string
  responsibleDepartment: string
  defaultUnitPrice: string
  minimumStockMonths: string
  note: string
}

const INITIAL_STATE: FormState = {
  lsCode: '',
  name: '',
  baseUnit: '',
  responsibleDepartment: '',
  defaultUnitPrice: '',
  minimumStockMonths: '1.5',
  note: '',
}

export function InventoryItemForm({ departments }: InventoryItemFormProps) {
  const router = useRouter()
  const [state, setState] = useState<FormState>(INITIAL_STATE)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const update = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setState((current) => ({ ...current, [key]: value }))
    setMessage(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMessage(null)

    const defaultUnitPrice = state.defaultUnitPrice.trim()
      ? Number(state.defaultUnitPrice)
      : null

    startTransition(async () => {
      try {
        const created = await createInventoryItem({
          lsCode: state.lsCode,
          name: state.name,
          baseUnit: state.baseUnit,
          responsibleDepartment: state.responsibleDepartment.trim() || null,
          defaultUnitPrice,
          minimumStockMonths: Number(state.minimumStockMonths),
          note: state.note.trim() || null,
        })
        router.push(`/inventory/${created.id}`)
        router.refresh()
      } catch (caught) {
        setMessage(caught instanceof Error ? caught.message : 'สร้างรายการน้ำยาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <form className="inventory-item-form" onSubmit={submit} noValidate>
      <section className="bench-panel form-panel" aria-labelledby="inventory-item-form-title">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">INVENTORY CATALOG</p>
            <h2 id="inventory-item-form-title">ข้อมูลรายการน้ำยา</h2>
          </div>
          <span className="draft-state">สร้างรายการใหม่เข้าคลัง</span>
        </div>

        <div className="form-grid">
          <label>
            รหัสพัสดุ <span aria-hidden="true">*</span>
            <input
              required
              maxLength={100}
              value={state.lsCode}
              onChange={(event) => update('lsCode', event.target.value)}
              placeholder="เช่น LS046022"
              autoComplete="off"
            />
            <small className="form-field-note">รหัสต้องไม่ซ้ำกับรายการที่มีอยู่ในคลัง</small>
          </label>

          <label>
            หน่วยนับ <span aria-hidden="true">*</span>
            <input
              required
              maxLength={100}
              value={state.baseUnit}
              onChange={(event) => update('baseUnit', event.target.value)}
              placeholder="เช่น ขวด, กล่อง, ชุด"
            />
          </label>

          <label className="form-grid__wide">
            ชื่อน้ำยา <span aria-hidden="true">*</span>
            <input
              required
              maxLength={240}
              value={state.name}
              onChange={(event) => update('name', event.target.value)}
              placeholder="ชื่อเต็มตามฉลากหรือเอกสารจัดซื้อ"
            />
          </label>

          <label>
            หน่วยงานที่รับผิดชอบ
            <select
              value={state.responsibleDepartment}
              onChange={(event) => update('responsibleDepartment', event.target.value)}
            >
              <option value="">ไม่ระบุหน่วยงาน</option>
              {departments.map((department) => <option value={department} key={department}>{department}</option>)}
            </select>
            <small className="form-field-note">ใช้สำหรับกรองรายการและติดตามผู้รับผิดชอบ</small>
          </label>

          <label>
            ราคาต่อหน่วย (บาท)
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={state.defaultUnitPrice}
              onChange={(event) => update('defaultUnitPrice', event.target.value)}
              placeholder="ไม่บังคับ"
            />
          </label>

          <label className="form-grid__wide">
            หมายเหตุ
            <textarea
              maxLength={1000}
              value={state.note}
              onChange={(event) => update('note', event.target.value)}
              placeholder="ข้อมูลเพิ่มเติมของรายการ (ถ้ามี)"
            />
          </label>
        </div>
      </section>

      <p className="inline-alert inline-alert--info" role="note">
        การสร้างรายการนี้ยังไม่เพิ่มยอด stock ต้องทำใบรับเข้าและยืนยันรับของก่อน
      </p>

      <div className="form-action-bar">
        <div aria-live="polite">
          {message && <p className="form-error" role="alert">{message}</p>}
        </div>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.push('/inventory')} disabled={isPending}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'กำลังสร้างรายการ…' : 'สร้างรายการน้ำยา'}
          </Button>
        </div>
      </div>
    </form>
  )
}
