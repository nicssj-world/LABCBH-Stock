'use client'

import { useState, useTransition, type DragEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ContractItemPicker, type ManualItemInput, type PickerOption } from '@/components/pr/ContractItemPicker'
import { CommitteeMemberCombobox } from '@/components/pr/PurchaseRequestChecklistFields'
import { StickyScroll } from '@/components/ui/StickyScroll'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { Button } from '@/components/ui/Button'
import { bangkokIsoDate } from '@/lib/date/thai'
import { createServicePurchaseRequest } from '@/lib/service-procurement/actions'
import { calculateAnnualRequestTotal, fiscalYearFromDate, fiscalYearRange, isDateInFiscalYear } from '@/lib/service-procurement/domain'
import type { PurchaseRequestCommitteeCandidate } from '@/lib/pr/form-options'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'
import { formatBaht } from '@/lib/service-procurement/presenter'

interface CatalogItem {
  inventoryItemId: string
  lsCode: string
  name: string
  unit: string
  unitPrice: number
}

interface Line extends CatalogItem {
  key: string
  requestedQuantity: number
  unitPrice: number
}

function toPickerOption(item: CatalogItem): PickerOption {
  return {
    ...item,
    contractItemId: null,
    contractRemaining: null,
    contractedQuantity: null,
    onHand: 0,
    averageMonthlyUsage: 0,
    belowMinimum: false,
  }
}

type ServiceAttachmentKind = 'tor' | 'quotation'

interface ServiceAttachmentDescriptor {
  kind: ServiceAttachmentKind
  slot: number
  field: string
  label: string
  accept: string
  hint: string
}

const SERVICE_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024

function formatFileSize(size: number) {
  if (!Number.isFinite(size)) return 'ไม่ระบุขนาด'
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`
}

function validateSelectedAttachment(kind: ServiceAttachmentKind, file: File) {
  const errors: string[] = []
  if (file.size <= 0 || file.size > SERVICE_ATTACHMENT_MAX_BYTES) errors.push('ไฟล์แนบแต่ละไฟล์ต้องมีขนาดไม่เกิน 20 MB')
  if (kind === 'tor' && file.type !== 'application/pdf') errors.push('เอกสาร TOR ต้องเป็นไฟล์ PDF เท่านั้น')
  if (kind === 'quotation' && !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    errors.push('รองรับเฉพาะ PDF, JPG, PNG หรือ WEBP')
  }
  return errors
}

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
  candidates: PurchaseRequestCommitteeCandidate[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState(department)
  const [requestedDate, setRequestedDate] = useState(bangkokIsoDate)
  const [note, setNote] = useState('')
  const [planId, setPlanId] = useState('')
  const [method, setMethod] = useState<'annual_items' | 'laboratory_testing'>('annual_items')
  const [amount, setAmount] = useState('')
  const [requestedPoMonth, setRequestedPoMonth] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [committees, setCommittees] = useState<Array<{ kind: 'specification' | 'inspection'; seat: number; profileId: string }>>([])
  const [checklistFiles, setChecklistFiles] = useState<Record<string, File | undefined>>({})
  const [draggingAttachment, setDraggingAttachment] = useState<string | null>(null)

  const selectedPlan = plans.find((plan) => plan.id === planId) ?? null
  const requestedFiscalYear = selectedPlan?.fiscalYear ?? fiscalYearFromDate(requestedDate)
  const poMonthOptions = Array.from({ length: 12 }, (_, index) => {
    const [startYear, startMonth] = fiscalYearRange(requestedFiscalYear).start.split('-').map(Number)
    const date = new Date(Date.UTC(startYear, startMonth - 1 + index, 1))
    return {
      value: date.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }).format(date),
    }
  })
  const pickerOptions = catalog.map(toPickerOption)
  const total = method === 'annual_items' ? calculateAnnualRequestTotal(lines) : Number(amount || 0)
  const quoteCount = total >= 50_000 ? 3 : 1
  const committeeSeats = total >= 100_000 ? 3 : 1
  const attachmentDescriptors: ServiceAttachmentDescriptor[] = [
    { kind: 'tor', slot: 1, field: 'tor', label: 'รายละเอียดคุณลักษณะเฉพาะ (TOR)', accept: 'application/pdf', hint: 'PDF เท่านั้น' },
    ...Array.from({ length: quoteCount }, (_, index) => ({
      kind: 'quotation' as const,
      slot: index + 1,
      field: `quotation${index + 1}`,
      label: `ใบเสนอราคาบริษัทที่ ${index + 1}`,
      accept: 'application/pdf,image/jpeg,image/png,image/webp',
      hint: 'PDF, JPG, PNG หรือ WEBP',
    })),
  ]
  const completeAttachmentCount = attachmentDescriptors.filter((descriptor) => {
    const file = checklistFiles[descriptor.field]
    return file && validateSelectedAttachment(descriptor.kind, file).length === 0
  }).length
  const checklistComplete = completeAttachmentCount === attachmentDescriptors.length && committees.length === committeeSeats * 2

  function addLine(item: PickerOption) {
    if (lines.some((line) => line.inventoryItemId === item.inventoryItemId)) return
    setLines((current) => [...current, {
      inventoryItemId: item.inventoryItemId,
      lsCode: item.lsCode,
      name: item.name,
      unit: item.unit,
      unitPrice: item.unitPrice,
      key: item.inventoryItemId,
      requestedQuantity: 1,
    }])
  }

  function addManualLine(input: ManualItemInput): string | null {
    const key = `manual-${input.lsCode.trim().toLowerCase()}`
    if (lines.some((line) => line.key === key)) return 'มีรายการรหัส LS นี้ในใบ PR แล้ว'
    setLines((current) => [...current, {
      inventoryItemId: '',
      key,
      lsCode: input.lsCode.trim(),
      name: input.name.trim(),
      unit: input.unit.trim(),
      unitPrice: Number(input.unitPrice || 0),
      requestedQuantity: 1,
    }])
    return null
  }

  function updateLine(key: string, patch: Partial<Pick<Line, 'requestedQuantity' | 'unitPrice'>>) {
    setLines((current) => current.map((line) => line.key === key ? { ...line, ...patch } : line))
  }

  function setCommittee(kind: 'specification' | 'inspection', seat: number, profileId: string | null) {
    setCommittees((current) => {
      const retained = current.filter((row) => !(row.kind === kind && row.seat === seat))
      return profileId ? [...retained, { kind, seat, profileId }] : retained
    })
  }

  function setChecklistFile(field: string, file: File | undefined) {
    setChecklistFiles((current) => {
      const next = { ...current }
      if (file) next[field] = file
      else delete next[field]
      return next
    })
  }

  function handleAttachmentDragOver(event: DragEvent<HTMLLabelElement>, field: string) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = pending ? 'none' : 'copy'
    if (!pending) setDraggingAttachment(field)
  }

  function handleAttachmentDragLeave(event: DragEvent<HTMLLabelElement>, field: string) {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
    setDraggingAttachment((current) => current === field ? null : current)
  }

  function handleAttachmentDrop(event: DragEvent<HTMLLabelElement>, field: string) {
    event.preventDefault()
    event.stopPropagation()
    setDraggingAttachment((current) => current === field ? null : current)
    if (pending) return
    const droppedFile = event.dataTransfer.files?.[0]
    if (droppedFile) setChecklistFile(field, droppedFile)
  }

  function disabledCommitteeIds(kind: 'specification' | 'inspection', seat: number) {
    return new Set(
      committees
        .filter((row) => row.kind === kind && row.seat !== seat)
        .map((row) => row.profileId),
    )
  }

  function renderAttachmentCard(descriptor: ServiceAttachmentDescriptor) {
    const file = checklistFiles[descriptor.field]
    const errors = file ? validateSelectedAttachment(descriptor.kind, file) : []
    const complete = Boolean(file) && errors.length === 0
    const isDragging = draggingAttachment === descriptor.field
    const hintId = `service-checklist-${descriptor.field}-hint`
    const errorId = `service-checklist-${descriptor.field}-error`

    return (
      <article className={`pr-checklist__file${complete ? ' is-complete' : ''}`} key={descriptor.field}>
        <div className="pr-checklist__file-copy">
          <div>
            <strong>{descriptor.label}</strong>
            <small>{descriptor.hint} · สูงสุด 20 MB</small>
          </div>
          <span className={`pr-checklist__file-state${complete ? ' is-complete' : ''}`}>
            {complete && (
              <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="m2.25 6.25 2.2 2.2 5.3-5.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            )}
            {complete ? 'แนบแล้ว' : 'รอแนบ'}
          </span>
        </div>
        {file && <p className="pr-checklist__file-name">{file.name} · {formatFileSize(file.size)}</p>}
        {errors.length > 0 && (
          <div id={errorId} className="pr-checklist__file-errors" aria-live="polite">
            {errors.map((message) => <p className="field-error" key={message}>{message}</p>)}
          </div>
        )}
        <div className="pr-checklist__file-actions">
          <label
            className={`pr-checklist__dropzone${isDragging ? ' is-dragging' : ''}`}
            aria-disabled={pending}
            onDragEnter={(event) => handleAttachmentDragOver(event, descriptor.field)}
            onDragOver={(event) => handleAttachmentDragOver(event, descriptor.field)}
            onDragLeave={(event) => handleAttachmentDragLeave(event, descriptor.field)}
            onDrop={(event) => handleAttachmentDrop(event, descriptor.field)}
          >
            <svg className="pr-checklist__dropzone-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
            <span className="pr-checklist__dropzone-copy">
              <strong>{isDragging ? 'วางไฟล์ที่นี่' : file ? 'ลากไฟล์ใหม่มาวางเพื่อเปลี่ยน' : 'ลากไฟล์มาวางที่นี่'}</strong>
              <small id={hintId}>หรือคลิกเลือกไฟล์ · {descriptor.hint}</small>
            </span>
            <input
              key={file ? `${file.name}:${file.size}:${file.lastModified}` : 'empty'}
              type="file"
              name={descriptor.field}
              accept={descriptor.accept}
              disabled={pending}
              aria-label={`แนบ ${descriptor.label}`}
              aria-invalid={errors.length > 0}
              aria-describedby={errors.length > 0 ? `${hintId} ${errorId}` : hintId}
              onChange={(event) => setChecklistFile(descriptor.field, event.target.files?.[0])}
            />
          </label>
          {file && (
            <Button variant="ghost" type="button" disabled={pending} onClick={() => setChecklistFile(descriptor.field, undefined)}>
              ยกเลิกไฟล์ที่เลือก
            </Button>
          )}
        </div>
      </article>
    )
  }

  function submit(event: FormEvent<HTMLFormElement>) {
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
    for (const descriptor of attachmentDescriptors) {
      const file = checklistFiles[descriptor.field]
      if (file) formData.set(descriptor.field, file, file.name)
    }
    const torFile = formData.get('tor')
    if (!(torFile instanceof File) || torFile.size === 0 || torFile.type !== 'application/pdf' || torFile.size > 20 * 1024 * 1024) return setError('กรุณาแนบ TOR เป็น PDF ขนาดไม่เกิน 20 MB')
    for (let index = 1; index <= quoteCount; index += 1) {
      const quoteFile = formData.get(`quotation${index}`)
      if (!(quoteFile instanceof File) || quoteFile.size === 0 || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(quoteFile.type) || quoteFile.size > 20 * 1024 * 1024) return setError(`กรุณาแนบใบเสนอราคาที่ ${index} ให้ถูกชนิดและขนาดไม่เกิน 20 MB`)
    }
    formData.set('payload', JSON.stringify({
      department: selectedDepartment,
      requesterName,
      requestedDate,
      note: note || null,
      planId: planId || null,
      method,
      amount: total,
      requestedPoMonth: method === 'laboratory_testing' ? requestedPoMonth : null,
      items: lines.map((line) => ({
        inventoryItemId: line.inventoryItemId || null,
        lsCode: line.lsCode,
        name: line.name,
        unit: line.unit,
        requestedQuantity: Number(line.requestedQuantity),
        unitPrice: Number(line.unitPrice),
      })),
      committees,
    }))
    startTransition(async () => {
      try {
        const saved = await createServicePurchaseRequest(formData)
        router.push(`/service-procurement/purchase-requests/${saved.id}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ส่งใบ PR งานจ้างไม่สำเร็จ')
      }
    })
  }

  return (
    <form className="route-stack service-pr-form" onSubmit={submit}>
      <section className="bench-panel" aria-labelledby="service-header-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST HEADER</p>
            <h2 id="service-header-title">ข้อมูลผู้ขอ</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field-row">
            <span>หน่วยงานผู้ขอ <span className="field-required" aria-hidden="true">*</span></span>
            <select required value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)}>
              {departments.map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label className="field-row">
            <span>ชื่อผู้ขอ <span className="field-required" aria-hidden="true">*</span></span>
            <input type="text" required readOnly value={requesterName} title="ชื่อผู้สร้างใบ PR แก้ไขไม่ได้" />
          </label>
          <label className="field-row">
            <span>วันที่ขอ <span className="field-required" aria-hidden="true">*</span></span>
            <ThaiDateInput required value={requestedDate} onChange={setRequestedDate} />
          </label>
          <label className="field-row">
            <span>หมายเหตุ</span>
            <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        </div>
      </section>

      <section className="bench-panel" aria-labelledby="service-method-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">PLAN & METHOD</p>
            <h2 id="service-method-title">อ้างแผนและวิธีจัดซื้อ</h2>
          </div>
        </div>
        <div className="form-grid">
          <label className="field-row form-grid__wide">
            <span>แผนงานจ้าง</span>
            <select value={planId} onChange={(event) => {
              const nextId = event.target.value
              setPlanId(nextId)
              const nextPlan = plans.find((plan) => plan.id === nextId)
              if (nextPlan && !isDateInFiscalYear(requestedDate, nextPlan.fiscalYear)) setRequestedDate(fiscalYearRange(nextPlan.fiscalYear).start)
            }}>
              <option value="">นอกแผน</option>
              {plans.map((plan) => <option key={plan.id} value={plan.id}>ปีงบ {plan.fiscalYear} · {plan.name} · คงเหลือ {formatBaht(plan.balance.available)}</option>)}
            </select>
          </label>
          <label className="field-row">
            <span>วิธีจัดซื้อ <span className="field-required" aria-hidden="true">*</span></span>
            <select required value={method} onChange={(event) => { setMethod(event.target.value as typeof method); setLines([]) }}>
              <option value="annual_items">ซื้อในแผนทั้งปี</option>
              <option value="laboratory_testing">จ้างตรวจทางห้องปฏิบัติการ</option>
            </select>
          </label>
          {method === 'laboratory_testing' && (
            <>
              <label className="field-row">
                <span>วงเงิน (บาท) <span className="field-required" aria-hidden="true">*</span></span>
                <input required type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
              </label>
              <label className="field-row">
                <span>เดือนที่ขอทำ PO <span className="field-required" aria-hidden="true">*</span></span>
                <select required value={requestedPoMonth} onChange={(event) => setRequestedPoMonth(event.target.value)}>
                  <option value="">เลือกเดือน</option>
                  {poMonthOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
        {selectedPlan && (
          <p className={`service-budget-callout${total > selectedPlan.balance.available ? ' is-danger' : ''}`} role={total > selectedPlan.balance.available ? 'alert' : 'status'}>
            แผน {selectedPlan.name}: ใช้จริง {formatBaht(selectedPlan.balance.spent)} · สำรอง {formatBaht(selectedPlan.balance.reserved)} · คงเหลือ {formatBaht(selectedPlan.balance.available)}
          </p>
        )}
      </section>

      {method === 'annual_items' && (
        <>
          <section className="bench-panel" aria-labelledby="service-picker-title">
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">SELECT ITEMS</p>
                <h2 id="service-picker-title">เลือกรายการที่ต้องการขอซื้อ</h2>
              </div>
              <p>{lines.length} รายการ</p>
            </div>
            <ContractItemPicker
              options={pickerOptions}
              selectedIds={lines.map((line) => line.key)}
              onAdd={addLine}
              onAddManual={addManualLine}
              variant="service"
              manualUnitPrice
            />
          </section>

          <section className="bench-panel" aria-labelledby="service-lines-title">
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">REQUEST LINES</p>
                <h2 id="service-lines-title">รายการในใบ PR งานจ้าง</h2>
              </div>
              <p>{lines.length} รายการ</p>
            </div>
            {lines.length === 0 ? (
              <p className="empty-state">ยังไม่ได้เลือกรายการ กรุณาเลือกจากรายการด้านบน</p>
            ) : (
              <>
                <StickyScroll className="detail-items-table service-lines pr-form-lines-table--desktop" ariaLabel="รายการในใบ PR งานจ้าง เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>รหัส LS</th>
                        <th>รายการ</th>
                        <th className="pr-line-cell--center">จำนวนที่ขอ</th>
                        <th className="pr-line-cell--center">หน่วย</th>
                        <th className="pr-line-cell--center">ราคาต่อหน่วย</th>
                        <th className="pr-line-cell--center">รวม</th>
                        <th><span className="visually-hidden">นำออก</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line) => (
                        <tr key={line.key}>
                          <td className="identifier">{line.lsCode}</td>
                          <td className="pr-line-cell--name"><strong>{line.name}</strong></td>
                          <td className="pr-line-cell--center">
                            <input aria-label={`จำนวนที่ขอของ ${line.name}`} type="number" min="0.001" step="0.001" value={line.requestedQuantity} onChange={(event) => updateLine(line.key, { requestedQuantity: Number(event.target.value) })} />
                          </td>
                          <td className="pr-line-cell--center">{line.unit}</td>
                          <td className="pr-line-cell--center">
                            <input aria-label={`ราคาต่อหน่วยของ ${line.name}`} type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: Number(event.target.value) })} />
                          </td>
                          <td className="identifier pr-line-cell--center">{formatBaht(line.requestedQuantity * line.unitPrice)}</td>
                          <td><Button variant="ghost" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}>นำออก</Button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </StickyScroll>

                <ul className="pr-form-line-cards" aria-label="รายการในใบ PR งานจ้าง">
                  {lines.map((line) => (
                    <li key={line.key} className="pr-form-line-card">
                      <div className="pr-form-line-card__heading">
                        <div className="pr-form-line-card__identity">
                          <span className="identifier">{line.lsCode}</span>
                          <strong>{line.name}</strong>
                        </div>
                        <Button variant="ghost" onClick={() => setLines((current) => current.filter((row) => row.key !== line.key))}>นำออก</Button>
                      </div>
                      <dl className="pr-form-line-card__facts">
                        <div><dt>หน่วย</dt><dd>{line.unit}</dd></div>
                        <div><dt>รวม</dt><dd className="identifier">{formatBaht(line.requestedQuantity * line.unitPrice)}</dd></div>
                      </dl>
                      <div className="pr-form-line-card__fields">
                        <label className="field-row">
                          <span>จำนวนที่ขอ ({line.unit}) <span className="field-required" aria-hidden="true">*</span></span>
                          <input aria-label={`จำนวนที่ขอของ ${line.name}`} type="number" min="0.001" step="0.001" required value={line.requestedQuantity} onChange={(event) => updateLine(line.key, { requestedQuantity: Number(event.target.value) })} />
                        </label>
                        <label className="field-row">
                          <span>ราคาต่อหน่วย <span className="field-required" aria-hidden="true">*</span></span>
                          <input aria-label={`ราคาต่อหน่วยของ ${line.name}`} type="number" min="0" step="0.01" required value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: Number(event.target.value) })} />
                        </label>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="items-editor__grand-total"><span>ยอดรวม</span><strong>{formatBaht(total)}</strong></p>
              </>
            )}
          </section>
        </>
      )}

      <section className="bench-panel pr-checklist" aria-labelledby="service-checklist-title">
        <div className="bench-panel__header pr-checklist__header">
          <div>
            <p className="section-kicker">REQUIRED CHECKLIST</p>
            <h2 id="service-checklist-title">เอกสารและรายชื่อกรรมการก่อนส่งใบ PR</h2>
            <p>ต้องครบทุกช่องจึงจะกดส่งได้ · ไฟล์ละไม่เกิน 20 MB</p>
          </div>
          <span className={checklistComplete ? 'pr-checklist__status is-complete' : 'pr-checklist__status'}>
            {checklistComplete ? 'ครบแล้ว' : 'ยังไม่ครบ'}
          </span>
        </div>

        <div className="pr-checklist__section">
          <div className="pr-checklist__section-heading">
            <h3>เอกสารแนบ</h3>
            <span aria-live="polite">แนบแล้ว {completeAttachmentCount}/{attachmentDescriptors.length} ไฟล์</span>
          </div>
          <div className="pr-checklist__attachment-groups">
            <section className="pr-checklist__file-group" aria-labelledby="service-checklist-primary-files">
              <div className="pr-checklist__file-group-heading">
                <h4 id="service-checklist-primary-files">เอกสารหลัก</h4>
                <span>แนบแล้ว {checklistFiles.tor && validateSelectedAttachment('tor', checklistFiles.tor).length === 0 ? 1 : 0}/1</span>
              </div>
              <div className="pr-checklist__file-grid pr-checklist__file-grid--primary">
                {renderAttachmentCard(attachmentDescriptors[0])}
              </div>
            </section>
            <section className="pr-checklist__file-group" aria-labelledby="service-checklist-quotation-files">
              <div className="pr-checklist__file-group-heading">
                <h4 id="service-checklist-quotation-files">ใบเสนอราคาจากบริษัท</h4>
                <span>แนบแล้ว {attachmentDescriptors.slice(1).filter((descriptor) => {
                  const file = checklistFiles[descriptor.field]
                  return file && validateSelectedAttachment(descriptor.kind, file).length === 0
                }).length}/{quoteCount}</span>
              </div>
              <div className="pr-checklist__file-grid pr-checklist__file-grid--quotation">
                {attachmentDescriptors.slice(1).map(renderAttachmentCard)}
              </div>
            </section>
          </div>
        </div>

        <div className="pr-checklist__section">
          <div className="pr-checklist__section-heading">
            <h3>รายชื่อคณะกรรมการ</h3>
            <span>เลือกจากบุคลากรในระบบเท่านั้น</span>
          </div>
          <p className="pr-checklist__committee-note">พิมพ์ค้นหาด้วยชื่อหรือรหัส E-Phis · ตำแหน่งดึงจากข้อมูลบุคลากรและแก้ในช่องนี้ไม่ได้</p>
          <div className="pr-checklist__committees">
            <fieldset>
              <legend>คณะกรรมการกำหนดราคากลางและคุณลักษณะเฉพาะ · {committeeSeats} คน</legend>
              <div className="pr-checklist__committee-grid">
                {Array.from({ length: committeeSeats }, (_, index) => index + 1).map((seat) => (
                  <CommitteeMemberCombobox
                    key={seat}
                    kind="specification"
                    seat={seat}
                    candidates={candidates}
                    selectedProfileId={committees.find((row) => row.kind === 'specification' && row.seat === seat)?.profileId ?? null}
                    disabledProfileIds={disabledCommitteeIds('specification', seat)}
                    disabled={pending}
                    onSelect={(profileId) => setCommittee('specification', seat, profileId)}
                  />
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>คณะกรรมการตรวจรับพัสดุ · {committeeSeats} คน</legend>
              <div className="pr-checklist__committee-grid">
                {Array.from({ length: committeeSeats }, (_, index) => index + 1).map((seat) => (
                  <CommitteeMemberCombobox
                    key={seat}
                    kind="inspection"
                    seat={seat}
                    candidates={candidates}
                    selectedProfileId={committees.find((row) => row.kind === 'inspection' && row.seat === seat)?.profileId ?? null}
                    disabledProfileIds={disabledCommitteeIds('inspection', seat)}
                    disabled={pending}
                    onSelect={(profileId) => setCommittee('inspection', seat, profileId)}
                  />
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-action-bar">
        <p>
          {selectedPlan && `ระบบจะสำรองวงเงิน ${formatBaht(total)} เมื่อส่งใบ PR`}
          {method === 'annual_items' && lines.length > 0 && ` · ${lines.length} รายการ · รวม ${formatBaht(total)}`}
        </p>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.push('/service-procurement/purchase-requests')} disabled={pending}>ยกเลิก</Button>
          <Button type="submit" disabled={pending || !checklistComplete || (selectedPlan !== null && total > selectedPlan.balance.available)}>{pending ? 'กำลังส่ง…' : 'ส่งใบ PR งานจ้าง'}</Button>
        </div>
      </div>
    </form>
  )
}
