'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createServicePurchaseRequest } from '@/lib/service-procurement/actions'
import { calculateAnnualRequestTotal, fiscalYearFromDate, fiscalYearRange, isDateInFiscalYear } from '@/lib/service-procurement/domain'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

interface CatalogItem { inventoryItemId: string; lsCode: string; name: string; unit: string; unitPrice: number }
interface Candidate { id: string; name: string; positionTitle: string | null }
interface Line extends CatalogItem { key: string; requestedQuantity: number; unitPrice: number }

export function ServicePurchaseRequestForm({
  department,
  departments,
  requesterName,
  plans,
  catalog,
  candidates,
}: {
  department: string
  departments: readonly string[]
  requesterName: string
  plans: ServicePlanRecord[]
  catalog: CatalogItem[]
  candidates: Candidate[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState(department)
  const [requestedDate, setRequestedDate] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [planId, setPlanId] = useState('')
  const [method, setMethod] = useState<'annual_items' | 'laboratory_testing'>('annual_items')
  const [amount, setAmount] = useState('')
  const [requestedPoMonth, setRequestedPoMonth] = useState('')
  const [search, setSearch] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [manual, setManual] = useState({ lsCode: '', name: '', unit: '', unitPrice: '' })
  const [committees, setCommittees] = useState<Array<{ kind: 'specification' | 'inspection'; seat: number; profileId: string }>>([])

  const selectedPlan = plans.find((plan) => plan.id === planId) ?? null
  const requestedFiscalYear = selectedPlan?.fiscalYear ?? fiscalYearFromDate(requestedDate)
  const poMonthOptions = Array.from({ length: 12 }, (_, index) => {
    const [startYear, startMonth] = fiscalYearRange(requestedFiscalYear).start.split('-').map(Number)
    const date = new Date(Date.UTC(startYear, startMonth - 1 + index, 1))
    return { value: date.toISOString().slice(0, 7), label: new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(date) }
  })
  const total = method === 'annual_items' ? calculateAnnualRequestTotal(lines) : Number(amount || 0)
  const quoteCount = total >= 50_000 ? 3 : 1
  const committeeSeats = total >= 100_000 ? 3 : 1
  const matches = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('th')
    if (!query) return []
    return catalog.filter((item) => `${item.lsCode} ${item.name}`.toLocaleLowerCase('th').includes(query)).slice(0, 20)
  }, [catalog, search])

  function addLine(item: CatalogItem) {
    if (lines.some((line) => line.inventoryItemId === item.inventoryItemId)) return
    setLines((current) => [...current, { ...item, key: item.inventoryItemId, requestedQuantity: 1, unitPrice: item.unitPrice }])
  }

  function addManualLine() {
    if (!manual.lsCode.trim() || !manual.name.trim() || !manual.unit.trim()) return
    const key = `manual-${manual.lsCode.trim().toLowerCase()}`
    if (lines.some((line) => line.key === key)) return
    setLines((current) => [...current, { inventoryItemId: '', key, lsCode: manual.lsCode.trim(), name: manual.name.trim(), unit: manual.unit.trim(), unitPrice: Number(manual.unitPrice || 0), requestedQuantity: 1 }])
    setManual({ lsCode: '', name: '', unit: '', unitPrice: '' })
  }

  function setCommittee(kind: 'specification' | 'inspection', seat: number, profileId: string) {
    setCommittees((current) => [...current.filter((row) => !(row.kind === kind && row.seat === seat)), { kind, seat, profileId }])
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (method === 'annual_items' && lines.length === 0) return setError('กรุณาเลือกรายการที่ต้องการขอซื้อ')
    if (selectedPlan && total > selectedPlan.balance.available) return setError(`วงเงินแผนคงเหลือ ${formatBaht(selectedPlan.balance.available)} ไม่พอสำหรับคำขอ ${formatBaht(total)}`)
    if (committees.length !== committeeSeats * 2) return setError(`กรุณาเลือกรายชื่อกรรมการให้ครบ ${committeeSeats} คนต่อชุด`)
    for (const kind of ['specification', 'inspection'] as const) {
      const ids = committees.filter((row) => row.kind === kind).map((row) => row.profileId)
      if (new Set(ids).size !== ids.length) return setError('ห้ามใช้ชื่อกรรมการซ้ำกันภายในชุดเดียวกัน')
    }
    const formData = new FormData(event.currentTarget)
    const torFile = formData.get('tor')
    if (!(torFile instanceof File) || torFile.size === 0 || torFile.type !== 'application/pdf' || torFile.size > 20 * 1024 * 1024) return setError('กรุณาแนบ TOR เป็น PDF ขนาดไม่เกิน 20 MB')
    for (let index = 1; index <= quoteCount; index += 1) {
      const quoteFile = formData.get(`quotation${index}`)
      if (!(quoteFile instanceof File) || quoteFile.size === 0 || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(quoteFile.type) || quoteFile.size > 20 * 1024 * 1024) return setError(`กรุณาแนบใบเสนอราคาที่ ${index} ให้ถูกชนิดและขนาดไม่เกิน 20 MB`)
    }
    formData.set('payload', JSON.stringify({ department: selectedDepartment, requesterName, requestedDate, note: note || null, planId: planId || null, method, amount: total, requestedPoMonth: method === 'laboratory_testing' ? requestedPoMonth : null, items: lines.map((line) => ({ inventoryItemId: line.inventoryItemId || null, lsCode: line.lsCode, name: line.name, unit: line.unit, requestedQuantity: Number(line.requestedQuantity), unitPrice: Number(line.unitPrice) })), committees }))
    startTransition(async () => {
      try { const saved = await createServicePurchaseRequest(formData); router.push(`/service-procurement/purchase-requests/${saved.id}`); router.refresh() } catch (caught) { setError(caught instanceof Error ? caught.message : 'ส่งใบ PR งานจ้างไม่สำเร็จ') }
    })
  }

  return (
    <form className="route-stack service-pr-form" onSubmit={submit}>
      <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">REQUEST HEADER</p><h2>ข้อมูลผู้ขอ</h2></div></div><div className="form-grid">
        <label><span>หน่วยงานผู้ขอ</span><select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)}>{departments.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>ชื่อผู้ขอ</span><input value={requesterName} readOnly aria-readonly="true" /></label>
        <label><span>วันที่ขอ</span><input type="date" required value={requestedDate} onChange={(event) => setRequestedDate(event.target.value)} /></label>
        <label className="form-grid__wide"><span>หมายเหตุ</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
      </div></section>
      <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">PLAN & METHOD</p><h2>อ้างแผนและวิธีจัดซื้อ</h2></div></div><div className="form-grid">
        <label className="form-grid__wide"><span>แผนงานจ้าง</span><select value={planId} onChange={(event) => { const nextId = event.target.value; setPlanId(nextId); const nextPlan = plans.find((plan) => plan.id === nextId); if (nextPlan && !isDateInFiscalYear(requestedDate, nextPlan.fiscalYear)) setRequestedDate(fiscalYearRange(nextPlan.fiscalYear).start) }}><option value="">นอกแผน</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>ปีงบ {plan.fiscalYear} · {plan.name} · คงเหลือ {formatBaht(plan.balance.available)}</option>)}</select></label>
        <label><span>วิธีจัดซื้อ</span><select value={method} onChange={(event) => { setMethod(event.target.value as typeof method); setLines([]) }}><option value="annual_items">ซื้อในแผนทั้งปี</option><option value="laboratory_testing">จ้างตรวจทางห้องปฏิบัติการ</option></select></label>
        {method === 'laboratory_testing' && <><label><span>วงเงิน (บาท)</span><input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label><span>เดือนที่ขอทำ PO</span><select required value={requestedPoMonth} onChange={(event) => setRequestedPoMonth(event.target.value)}><option value="">เลือกเดือน</option>{poMonthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label></>}
      </div>{selectedPlan && <p className={`service-budget-callout${total > selectedPlan.balance.available ? ' is-danger' : ''}`} role={total > selectedPlan.balance.available ? 'alert' : 'status'}>แผน {selectedPlan.name}: ใช้จริง {formatBaht(selectedPlan.balance.spent)} · สำรอง {formatBaht(selectedPlan.balance.reserved)} · คงเหลือ {formatBaht(selectedPlan.balance.available)}</p>}</section>
      {method === 'annual_items' && <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">SELECT ITEMS</p><h2>เลือกรายการที่ต้องการขอซื้อ</h2></div><p>{lines.length} รายการ</p></div><label><span>ค้นหารายการ</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="รหัส LS หรือชื่อรายการ" /></label>{matches.length > 0 && <ul className="service-item-results">{matches.map((item) => <li key={item.inventoryItemId}><span><strong>{item.lsCode}</strong> · {item.name}<small>{item.unit} · ราคาเริ่มต้น {formatBaht(item.unitPrice)}</small></span><Button variant="secondary" onClick={() => addLine(item)}>เพิ่มรายการ</Button></li>)}</ul>}<fieldset className="service-manual-item"><legend>เพิ่มรายการที่ยังไม่มีในคลัง</legend><div className="form-grid"><label><span>รหัส LS</span><input value={manual.lsCode} onChange={(event) => setManual({ ...manual, lsCode: event.target.value })} /></label><label><span>ชื่อรายการ</span><input value={manual.name} onChange={(event) => setManual({ ...manual, name: event.target.value })} /></label><label><span>หน่วย</span><input value={manual.unit} onChange={(event) => setManual({ ...manual, unit: event.target.value })} /></label><label><span>ราคาต่อหน่วย</span><input type="number" min="0" step="0.01" value={manual.unitPrice} onChange={(event) => setManual({ ...manual, unitPrice: event.target.value })} /></label></div><Button variant="secondary" onClick={addManualLine}>เพิ่มรายการใหม่</Button></fieldset>{lines.length > 0 && <div className="service-lines"><table className="data-table"><thead><tr><th>รายการ</th><th>จำนวน</th><th>หน่วย</th><th>ราคาต่อหน่วย</th><th>รวม</th><th /></tr></thead><tbody>{lines.map((line) => <tr key={line.key}><td><strong>{line.name}</strong><small>{line.lsCode}</small></td><td><input type="number" min="0.001" step="0.001" value={line.requestedQuantity} onChange={(event) => setLines((current) => current.map((row) => row.key === line.key ? { ...row, requestedQuantity: Number(event.target.value) } : row))} /></td><td>{line.unit}</td><td><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => setLines((current) => current.map((row) => row.key === line.key ? { ...row, unitPrice: Number(event.target.value) } : row))} /></td><td className="identifier">{formatBaht(line.requestedQuantity * line.unitPrice)}</td><td><Button variant="ghost" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}>นำออก</Button></td></tr>)}</tbody></table><p className="items-editor__grand-total"><span>ยอดรวม</span><strong>{formatBaht(total)}</strong></p></div>}</section>}
      <section className="bench-panel"><div className="bench-panel__header"><div><p className="section-kicker">CHECKLIST</p><h2>เอกสารและรายชื่อกรรมการ</h2></div><p>TOR 1 · ใบเสนอราคา {quoteCount}</p></div><div className="form-grid"><label><span>TOR (PDF)</span><input required type="file" name="tor" accept="application/pdf" /></label>{Array.from({ length: quoteCount }, (_, index) => <label key={index}><span>ใบเสนอราคาบริษัทที่ {index + 1}</span><input required type="file" name={`quotation${index + 1}`} accept="application/pdf,image/jpeg,image/png,image/webp" /></label>)}</div><div className="service-committee-grid"><fieldset><legend>คณะกรรมการกำหนดราคากลางและคุณลักษณะเฉพาะ ({committeeSeats} คน)</legend>{Array.from({ length: committeeSeats }, (_, index) => <label key={index}><span>คนที่ {index + 1}</span><select required value={committees.find((row) => row.kind === 'specification' && row.seat === index + 1)?.profileId ?? ''} onChange={(event) => setCommittee('specification', index + 1, event.target.value)}><option value="">เลือกกรรมการ</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>)}</fieldset><fieldset><legend>คณะกรรมการตรวจรับพัสดุ ({committeeSeats} คน)</legend>{Array.from({ length: committeeSeats }, (_, index) => <label key={index}><span>คนที่ {index + 1}</span><select required value={committees.find((row) => row.kind === 'inspection' && row.seat === index + 1)?.profileId ?? ''} onChange={(event) => setCommittee('inspection', index + 1, event.target.value)}><option value="">เลือกกรรมการ</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></label>)}</fieldset></div></section>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-action-bar"><p>{selectedPlan && `ระบบจะสำรองวงเงิน ${formatBaht(total)} เมื่อส่งใบ PR`}</p><div className="form-action-bar__buttons"><Button variant="secondary" onClick={() => router.push('/service-procurement/purchase-requests')} disabled={pending}>ยกเลิก</Button><Button type="submit" disabled={pending || (selectedPlan !== null && total > selectedPlan.balance.available)}>{pending ? 'กำลังส่ง…' : 'ส่งใบ PR งานจ้าง'}</Button></div></div>
    </form>
  )
}
