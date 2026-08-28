'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createServicePlan, updateServicePlan } from '@/lib/service-procurement/actions'
import { SERVICE_PLAN_TYPE_LABELS, SERVICE_PLAN_TYPES } from '@/lib/service-procurement/schema'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

interface Props {
  mode: 'create' | 'edit'
  departments: readonly string[]
  initial?: ServicePlanRecord
  defaultFiscalYear?: number
  hasRequests?: boolean
}

export function ServicePlanForm({ mode, departments, initial, defaultFiscalYear, hasRequests = false }: Props) {
  const router = useRouter(); const [pending, startTransition] = useTransition(); const [error, setError] = useState<string | null>(null)
  const [fiscalYear, setFiscalYear] = useState(String(initial?.fiscalYear ?? defaultFiscalYear ?? ''))
  const [name, setName] = useState(initial?.name ?? '')
  const [department, setDepartment] = useState(initial?.department ?? departments[0] ?? '')
  const [budget, setBudget] = useState(initial?.budget.toString() ?? '')
  const [type, setType] = useState<(typeof SERVICE_PLAN_TYPES)[number]>(initial?.type ?? 'laboratory_testing')
  const [isRedCross, setIsRedCross] = useState(initial?.isRedCross ?? false)
  const [requiresContract, setRequiresContract] = useState(initial?.requiresContract ?? false)
  const [items, setItems] = useState<Array<{ name: string; unit: string }>>(initial?.testItems.map((item) => ({ name: item.name, unit: item.unit })) ?? [])
  const responsibleProfileIds = initial?.responsibles.map((row) => row.profileId) ?? []

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    startTransition(async () => {
      try {
        const input = { fiscalYear: Number(fiscalYear), name, department, budget: Number(budget), type, isRedCross, requiresContract, testItems: isRedCross ? items.filter((item) => item.name.trim() && item.unit.trim()) : [], responsibleProfileIds }
        const saved = mode === 'create' ? await createServicePlan(input) : await updateServicePlan(initial!.id, { ...input, expectedUpdatedAt: initial!.updatedAt })
        router.push(`/service-procurement/plans/${saved.id}`); router.refresh()
      } catch (caught) { setError(caught instanceof Error ? caught.message : 'บันทึกแผนงานจ้างไม่สำเร็จ') }
    })
  }

  function updateItem(index: number, key: 'name' | 'unit', value: string) { setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item)) }

  return (
    <form className="route-stack service-plan-form" onSubmit={submit}>
      <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">PLAN DETAILS</p><h2>ข้อมูลแผนงานจ้าง</h2></div></div><div className="form-grid">
        <label className="field-row form-grid__wide"><span>ชื่อแผน <span className="field-required" aria-hidden="true">*</span></span><input required maxLength={240} value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-row"><span>หน่วยงาน <span className="field-required" aria-hidden="true">*</span></span><select required value={department} onChange={(event) => setDepartment(event.target.value)}>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="field-row"><span>วงเงิน (บาท) <span className="field-required" aria-hidden="true">*</span></span><input required type="number" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} /><small className="field-help">{budget ? formatBaht(Number(budget)) : 'ระบุวงเงินรวมของแผน'}</small></label>
        <label className="field-row"><span>ประเภทแผน <span className="field-required" aria-hidden="true">*</span></span><select required value={type} onChange={(event) => setType(event.target.value as typeof type)}>{SERVICE_PLAN_TYPES.map((value) => <option key={value} value={value}>{SERVICE_PLAN_TYPE_LABELS[value]}</option>)}</select></label>
        <label className="field-row"><span>ปีงบประมาณ <span className="field-required" aria-hidden="true">*</span></span><input required type="number" min="2500" max="3000" value={fiscalYear} onChange={(event) => setFiscalYear(event.target.value)} /></label>
      </div></section>
      <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">PLAN FLAGS</p><h2>เงื่อนไขของแผน</h2></div></div><div className="form-grid"><label className="checkbox-row"><input type="checkbox" checked={isRedCross} onChange={(event) => { setIsRedCross(event.target.checked); if (!event.target.checked) setItems([]) }} /><span>สภากาชาดไทย</span></label><label className="checkbox-row"><input type="checkbox" checked={requiresContract} disabled={hasRequests} onChange={(event) => setRequiresContract(event.target.checked)} /><span>ทำสัญญา {hasRequests && <small>(ล็อกแล้วเพราะมี PR อ้างแผนนี้)</small>}</span></label></div></section>
      {isRedCross && <section className="bench-panel" aria-labelledby="service-plan-test-items-title"><div className="bench-panel__header"><div><p className="section-kicker">RED CROSS TEST ITEMS</p><h2 id="service-plan-test-items-title">รายการส่งตรวจ</h2></div><Button type="button" variant="secondary" onClick={() => setItems((current) => [...current, { name: '', unit: '' }])} disabled={pending}>เพิ่มรายการ</Button></div><p className="field-help">รายการมีเฉพาะชื่อรายการและหน่วย ไม่มีรหัสพัสดุ ราคา หรือการเชื่อมโยงคลัง</p>{items.length === 0 ? <p className="empty-state">ยังไม่มีรายการส่งตรวจ (สามารถเพิ่มภายหลังได้)</p> : <div className="service-ledger-table-wrap"><table className="data-table"><thead><tr><th>ชื่อรายการ</th><th>หน่วย</th><th /></tr></thead><tbody>{items.map((item, index) => <tr key={`${index}-${item.name}`}><td><input required aria-label={`ชื่อรายการส่งตรวจที่ ${index + 1}`} value={item.name} onChange={(event) => updateItem(index, 'name', event.target.value)} /></td><td><input required aria-label={`หน่วยรายการส่งตรวจที่ ${index + 1}`} value={item.unit} onChange={(event) => updateItem(index, 'unit', event.target.value)} /></td><td><Button type="button" variant="ghost" onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}>นำออก</Button></td></tr>)}</tbody></table></div>}</section>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-action-bar"><p>{mode === 'create' ? 'ตรวจสอบข้อมูลก่อนสร้างแผน' : 'แก้ไขรายละเอียดโดยไม่เปลี่ยนประวัติยอดเงิน'}</p><div className="form-action-bar__buttons"><Button type="button" variant="secondary" onClick={() => router.back()} disabled={pending}>ยกเลิก</Button><Button type="submit" disabled={pending}>{pending ? 'กำลังบันทึก…' : mode === 'create' ? 'เพิ่มแผนงานจ้าง' : 'บันทึกการแก้ไข'}</Button></div></div>
    </form>
  )
}
