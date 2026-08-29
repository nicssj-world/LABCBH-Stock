'use client'

import { useMemo, useState, useTransition, type DragEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { CommitteeMemberCombobox } from '@/components/pr/PurchaseRequestChecklistFields'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { QuantityInput } from '@/components/ui/QuantityInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { createServicePurchaseRequest } from '@/lib/service-procurement/actions'
import { fiscalYearRange, isDateRangeWithinFiscalYear, isDateInFiscalYear } from '@/lib/service-procurement/domain'
import type { PurchaseRequestCommitteeCandidate } from '@/lib/pr/form-options'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

const MAX_FILE_BYTES = 20 * 1024 * 1024
const DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

function fileError(file: File | undefined, required: boolean, label: string) {
  if (!file) return required ? `กรุณาแนบ${label}` : null
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) return `${label}ต้องมีขนาดไม่เกิน 20 MB`
  if (!DOCUMENT_TYPES.includes(file.type)) return `${label}ต้องเป็น PDF, JPG, PNG หรือ WEBP`
  if (label.includes('TOR') && file.type !== 'application/pdf') return 'TOR ต้องเป็นไฟล์ PDF เท่านั้น'
  return null
}

interface Props {
  department: string
  departments: readonly string[]
  requesterName: string
  plans: ServicePlanRecord[]
  candidates: PurchaseRequestCommitteeCandidate[]
}

export function ServicePurchaseRequestForm({ department, departments, requesterName, plans, candidates }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState(department)
  const [requestedDate, setRequestedDate] = useState(bangkokIsoDate)
  const [note, setNote] = useState('')
  const [planId, setPlanId] = useState('')
  const [amount, setAmount] = useState('')
  const [usageStartDate, setUsageStartDate] = useState('')
  const [usageEndDate, setUsageEndDate] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [committees, setCommittees] = useState<Array<{ kind: 'specification' | 'inspection'; seat: number; profileId: string }>>([])
  const [tor, setTor] = useState<File | undefined>()
  const [quotation, setQuotation] = useState<File | undefined>()
  const [contractPage, setContractPage] = useState<File | undefined>()
  const [dragging, setDragging] = useState<string | null>(null)

  const plan = plans.find((row) => row.id === planId) ?? null
  const fiscalRange = plan ? fiscalYearRange(plan.fiscalYear) : null
  const committeeSeats = Number(amount || 0) >= 100_000 ? 3 : 1
  const quoteExisting = Boolean(plan?.documents.some((document) => document.kind === 'quotation'))
  const contractExisting = Boolean(plan?.documents.some((document) => document.kind === 'contract_page'))
  const totalQuantity = useMemo(() => plan?.testItems.reduce((sum, item) => sum + Number(quantities[item.id] || 0), 0) ?? 0, [plan, quantities])

  function choosePlan(nextId: string) {
    setPlanId(nextId)
    // Plan-level documents belong to the selected plan. Do not carry a file
    // chosen for the previous plan into the next PR request.
    setQuotation(undefined)
    setContractPage(undefined)
    const nextPlan = plans.find((row) => row.id === nextId)
    if (!nextPlan) { setUsageStartDate(''); setUsageEndDate(''); return }
    const range = fiscalYearRange(nextPlan.fiscalYear)
    const nextRequested = isDateInFiscalYear(requestedDate, nextPlan.fiscalYear) ? requestedDate : range.start
    setRequestedDate(nextRequested)
    setUsageStartDate(range.start)
    setUsageEndDate(range.end)
    setQuantities(Object.fromEntries(nextPlan.testItems.map((item) => [item.id, ''])))
  }

  function setCommittee(kind: 'specification' | 'inspection', seat: number, profileId: string | null) {
    setCommittees((current) => {
      const retained = current.filter((row) => !(row.kind === kind && row.seat === seat))
      return profileId ? [...retained, { kind, seat, profileId }] : retained
    })
  }

  function disabledCommitteeIds(kind: 'specification' | 'inspection', seat: number) {
    return new Set(committees.filter((row) => row.kind === kind && row.seat !== seat).map((row) => row.profileId))
  }

  function setFile(kind: 'tor' | 'quotation' | 'contractPage', file: File | undefined) {
    if (kind === 'tor') setTor(file)
    else if (kind === 'quotation') setQuotation(file)
    else setContractPage(file)
  }

  function dragHandlers(kind: 'tor' | 'quotation' | 'contractPage') {
    return {
      onDragEnter: (event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); if (!pending) setDragging(kind) },
      onDragOver: (event: DragEvent<HTMLLabelElement>) => { event.preventDefault() },
      onDragLeave: () => setDragging((current) => current === kind ? null : current),
      onDrop: (event: DragEvent<HTMLLabelElement>) => { event.preventDefault(); setDragging(null); if (!pending) setFile(kind, event.dataTransfer.files?.[0]) },
    }
  }

  function documentCard(kind: 'tor' | 'quotation' | 'contractPage', label: string, file: File | undefined, existing: boolean, required: boolean) {
    const selectedError = fileError(file, required && !existing, label)
    return (
      <article className={`pr-checklist__file${file && !selectedError ? ' is-complete' : ''}`} key={kind}>
        <div className="pr-checklist__file-copy"><div><strong>{label}{required && <span className="field-required" aria-hidden="true"> *</span>}</strong><small>{existing ? 'มีไฟล์ระดับแผนแล้ว · แนบใหม่เพื่อแทนที่' : 'PDF, JPG, PNG หรือ WEBP · สูงสุด 20 MB'}</small></div><span className="pr-checklist__file-state">{file ? 'ไฟล์ใหม่' : existing ? 'ใช้ไฟล์เดิม' : 'รอแนบ'}</span></div>
        {file && <p className="pr-checklist__file-name">{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</p>}
        {selectedError && <p className="field-error" role="alert">{selectedError}</p>}
        <label className={`pr-checklist__dropzone${dragging === kind ? ' is-dragging' : ''}`} {...dragHandlers(kind)}>
          <span className="pr-checklist__dropzone-copy"><strong>{file ? 'ลากไฟล์ใหม่มาวางเพื่อเปลี่ยน' : 'ลากไฟล์มาวางที่นี่'}</strong><small>หรือคลิกเลือกไฟล์</small></span>
          <input type="file" accept={DOCUMENT_TYPES.join(',')} disabled={pending} onChange={(event) => setFile(kind, event.target.files?.[0])} aria-label={`แนบ${label}`} />
        </label>
        {file && <Button type="button" variant="ghost" disabled={pending} onClick={() => setFile(kind, undefined)}>ยกเลิกไฟล์ใหม่</Button>}
      </article>
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null)
    if (!plan) return setError('กรุณาเลือกแผนงานจ้าง')
    if (plan.isRedCross && plan.testItems.some((item) => item.unitPrice === null || item.unitPrice <= 0)) {
      return setError('แผนนี้ยังมีรายการส่งตรวจที่ไม่ระบุราคาต่อหน่วย กรุณาแก้ไขแผนก่อนสร้าง PR')
    }
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) return setError('กรุณาระบุวงเงินที่มากกว่า 0 บาท')
    if (numericAmount > plan.balance.available) return setError(`วงเงินแผนคงเหลือ ${formatBaht(plan.balance.available)} ไม่พอสำหรับคำขอ`)
    if (!isDateRangeWithinFiscalYear(usageStartDate, usageEndDate, plan.fiscalYear)) return setError('ช่วงวันที่ใช้ PO ต้องอยู่ในปีงบประมาณของแผนทั้งหมด')
    if (!isDateInFiscalYear(requestedDate, plan.fiscalYear)) return setError('วันที่ขอต้องอยู่ในปีงบประมาณของแผน')
    const activeCommittees = committees.filter((row) => row.seat <= committeeSeats)
    if (activeCommittees.length !== committeeSeats * 2) return setError(`กรุณาเลือกรายชื่อกรรมการให้ครบ ${committeeSeats} คนต่อชุด`)
    const duplicate = ['specification', 'inspection'].some((kind) => { const ids = activeCommittees.filter((row) => row.kind === kind).map((row) => row.profileId); return new Set(ids).size !== ids.length })
    if (duplicate) return setError('ห้ามใช้ชื่อกรรมการซ้ำกันภายในชุดเดียวกัน')
    const torMessage = fileError(tor, true, ' TOR')
    if (torMessage) return setError(torMessage)
    const quoteMessage = fileError(quotation, !quoteExisting, 'ใบเสนอราคา')
    if (quoteMessage) return setError(quoteMessage)
    const contractMessage = plan.requiresContract ? fileError(contractPage, !contractExisting, 'หน้าสัญญา') : null
    if (contractMessage) return setError(contractMessage)
    const formData = new FormData(event.currentTarget)
    if (tor) formData.set('tor', tor, tor.name)
    if (quotation) formData.set('quotation', quotation, quotation.name)
    if (contractPage) formData.set('contractPage', contractPage, contractPage.name)
    formData.set('payload', JSON.stringify({
      department: selectedDepartment, requesterName, requestedDate, note: note || null, planId,
      amount: numericAmount, usageStartDate, usageEndDate,
      items: plan.testItems.map((item) => ({ planItemId: item.id, name: item.name, unit: item.unit, unitPrice: item.unitPrice ?? 0, requestedQuantity: Number(quantities[item.id] || 0) })),
      committees: activeCommittees, documentChoices: { replaceQuotation: Boolean(quotation), replaceContractPage: Boolean(contractPage) },
    }))
    startTransition(async () => {
      try { const saved = await createServicePurchaseRequest(formData); router.push(`/service-procurement/purchase-requests/${saved.id}`); router.refresh() }
      catch (caught) { setError(caught instanceof Error ? caught.message : 'ส่งใบ PR งานจ้างไม่สำเร็จ') }
    })
  }

  return (
    <form className="route-stack service-pr-form" onSubmit={submit}>
      <section className="bench-panel" aria-labelledby="service-header-title"><div className="bench-panel__header"><div><p className="section-kicker">REQUEST HEADER</p><h2 id="service-header-title">ข้อมูลผู้ขอ</h2></div></div><div className="form-grid">
        <label className="field-row"><span>หน่วยงานผู้ขอ <span className="field-required" aria-hidden="true">*</span></span><select required value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)}>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="field-row"><span>ชื่อผู้ขอ <span className="field-required" aria-hidden="true">*</span></span><input readOnly value={requesterName} /></label>
        <label className="field-row"><span>วันที่ขอ <span className="field-required" aria-hidden="true">*</span></span><ThaiDateInput required value={requestedDate} onChange={setRequestedDate} /></label>
        <label className="field-row"><span>หมายเหตุ</span><textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div></section>

      <section className="bench-panel" aria-labelledby="service-plan-title"><div className="bench-panel__header"><div><p className="section-kicker">PLAN REFERENCE</p><h2 id="service-plan-title">อ้างอิงแผนงานจ้าง</h2></div><p>จ้างตรวจทางห้องปฏิบัติการ</p></div><div className="form-grid">
        <label className="field-row form-grid__wide"><span>แผนงานจ้าง <span className="field-required" aria-hidden="true">*</span></span><select required value={planId} onChange={(event) => choosePlan(event.target.value)}><option value="">เลือกแผนที่อ้างอิง</option>{plans.filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>ปีงบ {row.fiscalYear} · {row.name} · คงเหลือ {formatBaht(row.balance.available)}</option>)}</select></label>
        <label className="field-row"><span>วงเงิน (บาท) <span className="field-required" aria-hidden="true">*</span></span><MoneyInput required min="0.01" step="0.01" max={plan?.balance.available} value={amount} onValueChange={setAmount} /><small className="field-help">ต้องไม่เกินวงเงินคงเหลือของแผน</small></label>
        <label className="field-row"><span>ช่วงวันที่ที่จะใช้ PO นี้ <span className="field-required" aria-hidden="true">*</span></span><ThaiDateInput required value={usageStartDate} min={fiscalRange?.start} max={fiscalRange?.end} onChange={setUsageStartDate} /></label>
        <label className="field-row"><span>ถึงวันที่ <span className="field-required" aria-hidden="true">*</span></span><ThaiDateInput required value={usageEndDate} min={usageStartDate || fiscalRange?.start} max={fiscalRange?.end} onChange={setUsageEndDate} /></label>
      </div>{plan && <p className="service-budget-callout" role="status">แผน {plan.name}: วงเงินตั้งต้น {formatBaht(plan.budget)} · ใช้จริง {formatBaht(plan.balance.spent)} · สำรอง {formatBaht(plan.balance.reserved)} · คงเหลือ {formatBaht(plan.balance.available)}</p>}</section>

      {plan?.isRedCross && <section className="bench-panel" aria-labelledby="service-test-items-title"><div className="bench-panel__header"><div><p className="section-kicker">RED CROSS TEST ITEMS</p><h2 id="service-test-items-title">รายการส่งตรวจ</h2></div><p>{plan.testItems.length} รายการ · จำนวนรวม {totalQuantity}</p></div>{plan.testItems.length === 0 ? <p className="empty-state">แผนนี้ยังไม่มีรายการส่งตรวจ</p> : <div className="service-ledger-table-wrap"><table className="data-table service-pr-test-items-table"><thead><tr><th>รายการส่งตรวจ</th><th>หน่วย</th><th className="numeric-cell">ราคาต่อหน่วย (บาท)</th><th className="numeric-cell">จำนวน</th></tr></thead><tbody>{plan.testItems.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td className="numeric-cell identifier">{item.unitPrice === null ? 'ยังไม่ระบุ' : formatBaht(item.unitPrice)}</td><td><QuantityInput aria-label={`จำนวน ${item.name}`} min="0" step="0.001" placeholder="0" value={quantities[item.id] ?? ''} onValueChange={(value) => setQuantities((current) => ({ ...current, [item.id]: value }))} /></td></tr>)}</tbody></table></div>}</section>}

      <section className="bench-panel" aria-labelledby="service-documents-title"><div className="bench-panel__header"><div><p className="section-kicker">DOCUMENTS</p><h2 id="service-documents-title">เอกสารประกอบ</h2></div><p>ไฟล์ระดับแผนจะใช้ซ้ำใน PR ครั้งถัดไป</p></div><div className="pr-checklist__file-grid pr-checklist__file-grid--primary">{documentCard('tor', 'รายละเอียดคุณลักษณะเฉพาะ (TOR)', tor, false, true)}{documentCard('quotation', 'ใบเสนอราคา', quotation, quoteExisting, true)}{plan?.requiresContract && documentCard('contractPage', 'หน้าสัญญา', contractPage, contractExisting, true)}</div></section>

      <section className="bench-panel" aria-labelledby="service-committee-title"><div className="bench-panel__header"><div><p className="section-kicker">CHECKLIST</p><h2 id="service-committee-title">รายชื่อคณะกรรมการ</h2></div><p>{committeeSeats} คนต่อชุด</p></div><div className="pr-checklist__committees"><fieldset><legend>คณะกรรมการกำหนดราคากลางและคุณลักษณะเฉพาะ · {committeeSeats} คน</legend><div className="pr-checklist__committee-grid">{Array.from({ length: committeeSeats }, (_, index) => index + 1).map((seat) => <CommitteeMemberCombobox key={seat} kind="specification" seat={seat} candidates={candidates} selectedProfileId={committees.find((row) => row.kind === 'specification' && row.seat === seat)?.profileId ?? null} disabledProfileIds={disabledCommitteeIds('specification', seat)} disabled={pending} onSelect={(id) => setCommittee('specification', seat, id)} />)}</div></fieldset><fieldset><legend>คณะกรรมการตรวจรับพัสดุ · {committeeSeats} คน</legend><div className="pr-checklist__committee-grid">{Array.from({ length: committeeSeats }, (_, index) => index + 1).map((seat) => <CommitteeMemberCombobox key={seat} kind="inspection" seat={seat} candidates={candidates} selectedProfileId={committees.find((row) => row.kind === 'inspection' && row.seat === seat)?.profileId ?? null} disabledProfileIds={disabledCommitteeIds('inspection', seat)} disabled={pending} onSelect={(id) => setCommittee('inspection', seat, id)} />)}</div></fieldset></div></section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-action-bar"><p>{plan ? `ระบบจะสำรองวงเงิน ${formatBaht(Number(amount || 0))} เมื่อส่งใบ PR (ยังไม่ใช่ยอดใช้จริง)` : 'เลือกแผนเพื่อเริ่มสร้าง PR'}</p><div className="form-action-bar__buttons"><Button type="button" variant="secondary" onClick={() => router.push('/service-procurement/purchase-requests')} disabled={pending}>ยกเลิก</Button><Button type="submit" disabled={pending || !plan}>{pending ? 'กำลังส่ง…' : 'ส่งใบ PR งานจ้าง'}</Button></div></div>
    </form>
  )
}
