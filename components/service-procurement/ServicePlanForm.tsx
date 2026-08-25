'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createServicePlan, updateServicePlan } from '@/lib/service-procurement/actions'
import { SERVICE_PLAN_TYPE_LABELS, SERVICE_PLAN_TYPES } from '@/lib/service-procurement/schema'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

interface Candidate { id: string; name: string; positionTitle: string | null }

export function ServicePlanForm({
  mode,
  departments,
  candidates,
  initial,
  defaultFiscalYear,
}: {
  mode: 'create' | 'edit'
  departments: readonly string[]
  candidates: Candidate[]
  initial?: ServicePlanRecord
  defaultFiscalYear?: number
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fiscalYear, setFiscalYear] = useState(String(initial?.fiscalYear ?? defaultFiscalYear ?? ''))
  const [name, setName] = useState(initial?.name ?? '')
  const [department, setDepartment] = useState(initial?.department ?? departments[0] ?? '')
  const [budget, setBudget] = useState(initial?.budget.toString() ?? '')
  const [type, setType] = useState<(typeof SERVICE_PLAN_TYPES)[number]>(initial?.type ?? 'laboratory_testing')
  const [responsibleProfileIds, setResponsibleProfileIds] = useState<string[]>(initial?.responsibles.map((row) => row.profileId) ?? [])

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        const input = { fiscalYear: Number(fiscalYear), name, department, budget: Number(budget), type, responsibleProfileIds }
        const saved = mode === 'create'
          ? await createServicePlan(input)
          : await updateServicePlan(initial!.id, { ...input, expectedUpdatedAt: initial!.updatedAt })
        router.push(`/service-procurement/plans/${saved.id}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกแผนงานจ้างไม่สำเร็จ')
      }
    })
  }

  return (
    <form className="route-stack service-plan-form" onSubmit={submit}>
      <section className="bench-panel">
        <div className="bench-panel__header"><div><p className="section-kicker">PLAN DETAILS</p><h2>ข้อมูลแผนงานจ้าง</h2></div></div>
        <div className="form-grid">
          <label><span>ชื่อแผน <span className="field-required" aria-hidden="true">*</span></span><input required maxLength={240} value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>ปีงบประมาณ <span className="field-required" aria-hidden="true">*</span></span><input required type="number" min="2500" max="3000" value={fiscalYear} onChange={(event) => setFiscalYear(event.target.value)} /></label>
          <label><span>หน่วยงาน <span className="field-required" aria-hidden="true">*</span></span><select required value={department} onChange={(event) => setDepartment(event.target.value)}>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label><span>วงเงิน (บาท) <span className="field-required" aria-hidden="true">*</span></span><input required type="number" min="0.01" step="0.01" value={budget} onChange={(event) => setBudget(event.target.value)} aria-describedby="service-plan-budget-help" /><small id="service-plan-budget-help" className="field-help">{budget ? formatBaht(Number(budget)) : 'ระบุวงเงินรวมของแผน'}</small></label>
          <label><span>ประเภท <span className="field-required" aria-hidden="true">*</span></span><select required value={type} onChange={(event) => setType(event.target.value as typeof type)}>{SERVICE_PLAN_TYPES.map((value) => <option key={value} value={value}>{SERVICE_PLAN_TYPE_LABELS[value]}</option>)}</select></label>
        </div>
      </section>
      <section className="bench-panel" aria-labelledby="service-plan-responsibles-title">
        <div className="bench-panel__header"><div><p className="section-kicker">RESPONSIBLE USERS</p><h2 id="service-plan-responsibles-title">ผู้รับผิดชอบแผน</h2></div><p>{responsibleProfileIds.length} คน</p></div>
        <p className="items-editor__note">ผู้รับผิดชอบสามารถบันทึกและปรับยอดค่าใช้จ่ายของแผนได้ แต่ไม่สามารถเปลี่ยนวงเงินรวม</p>
        <div className="service-responsible-grid">
          {candidates.map((candidate) => (
            <label className="service-responsible-option" key={candidate.id}>
              <input type="checkbox" checked={responsibleProfileIds.includes(candidate.id)} onChange={(event) => setResponsibleProfileIds((current) => event.target.checked ? [...current, candidate.id] : current.filter((id) => id !== candidate.id))} />
              <span><strong>{candidate.name}</strong><small>{candidate.positionTitle ?? 'ไม่ระบุตำแหน่ง'}</small></span>
            </label>
          ))}
        </div>
      </section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-action-bar"><p>{mode === 'create' ? 'ตรวจสอบข้อมูลก่อนสร้างแผน' : 'แก้ไขรายละเอียดโดยไม่เปลี่ยนประวัติยอดเงิน'}</p><div className="form-action-bar__buttons"><Button variant="secondary" onClick={() => router.back()} disabled={pending}>ยกเลิก</Button><Button type="submit" disabled={pending}>{pending ? 'กำลังบันทึก…' : mode === 'create' ? 'เพิ่มแผนงานจ้าง' : 'บันทึกการแก้ไข'}</Button></div></div>
    </form>
  )
}
