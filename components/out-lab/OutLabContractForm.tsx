'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { createOutLabContract, updateOutLabContract } from '@/lib/out-lab/actions'
import { fiscalYearBounds } from '@/lib/out-lab/fiscal'
import {
  OUT_LAB_CADENCES,
  OUT_LAB_DEPARTMENTS,
  OUT_LAB_KINDS,
  outLabCreateInputSchema,
  outLabUpdateInputSchema,
} from '@/lib/out-lab/schema'
import {
  OUT_LAB_CADENCE_LABELS,
  OUT_LAB_KIND_HINTS,
  OUT_LAB_KIND_LABELS,
} from '@/lib/out-lab/presenter'
import type { OutLabContractRecord, OutLabKind } from '@/lib/out-lab/types'

interface OutLabContractFormProps {
  mode: 'create' | 'edit'
  contract?: OutLabContractRecord
  isAdmin?: boolean
}

interface FormState {
  kind: OutLabKind
  entryCadence: (typeof OUT_LAB_CADENCES)[number]
  fiscalYear: number
  displayName: string
  vendor: string
  department: (typeof OUT_LAB_DEPARTMENTS)[number] | ''
  total: string
  startDate: string
  endDate: string
  note: string
  startImmediately: boolean
  contractNumber: string
  effectiveDate: string
}

function currentThaiFiscalYear() {
  const [year, month] = bangkokIsoDate().split('-').map(Number)
  return year + (month >= 10 ? 544 : 543)
}

function initialState(contract?: OutLabContractRecord): FormState {
  return {
    kind: contract?.kind ?? 'annual_plan',
    entryCadence: contract?.entryCadence ?? 'monthly',
    fiscalYear: contract?.fiscalYear ?? currentThaiFiscalYear(),
    displayName: contract?.displayName ?? '',
    vendor: contract?.vendor ?? '',
    department: contract?.department ?? '',
    total: contract?.total !== null && contract?.total !== undefined ? String(contract.total) : '',
    startDate: contract?.kind === 'contract_ceiling' ? contract.startDate : '',
    endDate: contract?.kind === 'contract_ceiling' ? contract.endDate : '',
    note: contract?.note ?? '',
    startImmediately: false,
    contractNumber: '',
    effectiveDate: bangkokIsoDate(),
  }
}

export function OutLabContractForm({ mode, contract, isAdmin = false }: OutLabContractFormProps) {
  const router = useRouter()
  const [state, setState] = useState<FormState>(() => initialState(contract))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const patch = <Key extends keyof FormState>(key: Key, value: FormState[Key]) => {
    setState((current) => ({ ...current, [key]: value }))
  }

  const isPlan = state.kind === 'annual_plan'
  // An annual plan's period is derived from its fiscal year rather than typed,
  // so the dates are shown read-only instead of being hidden: people need to
  // see what period they are budgeting before they commit to it.
  const planPeriod = useMemo(() => fiscalYearBounds(state.fiscalYear), [state.fiscalYear])

  const buildPayload = () => {
    const shared = {
      kind: state.kind,
      entryCadence: state.entryCadence,
      fiscalYear: state.fiscalYear,
      displayName: state.displayName,
      vendor: state.vendor.trim() ? state.vendor : null,
      department: state.department === '' ? null : state.department,
      total: state.total.trim() ? Number(state.total) : null,
      note: state.note.trim() ? state.note : null,
      ...(isPlan ? {} : { startDate: state.startDate || null, endDate: state.endDate || null }),
    }

    if (mode === 'edit') {
      return { ...shared, expectedUpdatedAt: contract?.updatedAt ?? null }
    }

    return {
      ...shared,
      ...(isPlan
        ? {}
        : {
            effectiveDate: state.effectiveDate || null,
            contractNumber: state.startImmediately && state.contractNumber ? state.contractNumber : null,
          }),
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setErrors({})
    setMessage(null)

    const schema = mode === 'create' ? outLabCreateInputSchema : outLabUpdateInputSchema
    const parsed = schema.safeParse(buildPayload())
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form'
        fieldErrors[key] ??= issue.message
      }
      setErrors(fieldErrors)
      setMessage('ตรวจสอบข้อมูลที่ระบุสีแดง แล้วลองบันทึกอีกครั้ง')
      return
    }

    startTransition(async () => {
      try {
        if (mode === 'create') {
          const created = await createOutLabContract(
            parsed.data as Parameters<typeof createOutLabContract>[0],
          )
          router.push(`/out-lab/${created.id}`)
        } else {
          await updateOutLabContract(
            contract!.id,
            parsed.data as Parameters<typeof updateOutLabContract>[1],
          )
          router.push(`/out-lab/${contract!.id}`)
        }
        router.refresh()
      } catch (caught) {
        // The server message is shown verbatim: it carries the authoritative
        // figure when the database refuses a ceiling or a period change.
        setMessage(caught instanceof Error ? caught.message : 'บันทึกสัญญาไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <form className="contract-form" onSubmit={submit} noValidate>
      <section className="bench-panel form-panel" aria-labelledby="out-lab-kind-title">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">BUDGET SHAPE</p>
            <h2 id="out-lab-kind-title">รูปแบบงบของสัญญา</h2>
          </div>
        </div>
        <div className="form-grid">
          <label>
            รูปแบบงบ
            <select
              value={state.kind}
              onChange={(event) => patch('kind', event.target.value as OutLabKind)}
              disabled={mode === 'edit'}
            >
              {OUT_LAB_KINDS.map((kind) => (
                <option value={kind} key={kind}>{OUT_LAB_KIND_LABELS[kind]}</option>
              ))}
            </select>
            <small>{OUT_LAB_KIND_HINTS[state.kind]}</small>
            {mode === 'edit' && (
              <small>เปลี่ยนรูปแบบงบหลังสร้างไม่ได้ หากเลือกผิดให้เก็บเข้าคลังแล้วสร้างใหม่</small>
            )}
          </label>
          <label>
            งวดการลงข้อมูล
            <select
              value={state.entryCadence}
              onChange={(event) => patch('entryCadence', event.target.value as FormState['entryCadence'])}
            >
              {OUT_LAB_CADENCES.map((cadence) => (
                <option value={cadence} key={cadence}>{OUT_LAB_CADENCE_LABELS[cadence]}</option>
              ))}
            </select>
            <small>ใช้เตือนเมื่อมีงวดที่ยังไม่ได้ลงยอด ไม่ได้บังคับให้กรอก</small>
          </label>
        </div>
      </section>

      <section className="bench-panel form-panel" aria-labelledby="out-lab-metadata-title">
        <div className="section-heading-row">
          <div>
            <p className="section-kicker">CONTRACT RECORD</p>
            <h2 id="out-lab-metadata-title">ข้อมูลสัญญา</h2>
          </div>
        </div>
        <div className="form-grid">
          <label>
            ปีงบประมาณ
            <input
              type="number"
              min="2500"
              max="3000"
              value={state.fiscalYear}
              onChange={(event) => patch('fiscalYear', Number(event.target.value))}
              aria-invalid={Boolean(errors.fiscalYear)}
            />
            {errors.fiscalYear && <small className="field-error">{errors.fiscalYear}</small>}
          </label>
          <label>
            {isPlan ? 'งบตามแผน (บาท)' : 'มูลค่าสัญญา (บาท)'}
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={state.total}
              onChange={(event) => patch('total', event.target.value)}
              placeholder="เว้นว่างหากยังไม่ระบุ"
              aria-invalid={Boolean(errors.total)}
            />
            <small>
              {isPlan
                ? 'บันทึกเกินได้ แต่ระบบจะขึ้นคำเตือนว่าใช้เกินแผน'
                : 'ระบบจะไม่ให้บันทึกยอดสะสมเกินมูลค่านี้'}
            </small>
            {errors.total && <small className="field-error">{errors.total}</small>}
          </label>
          <label className="form-grid__wide">
            ชื่อสัญญา
            <input
              value={state.displayName}
              onChange={(event) => patch('displayName', event.target.value)}
              placeholder="เช่น จ้างบริการตรวจวิเคราะห์ทางห้องปฏิบัติการตรวจต่อพิเศษ"
              aria-invalid={Boolean(errors.displayName)}
            />
            {errors.displayName && <small className="field-error">{errors.displayName}</small>}
          </label>
          <label className="form-grid__wide">
            คู่สัญญา / หน่วยตรวจปลายทาง
            <input
              value={state.vendor}
              onChange={(event) => patch('vendor', event.target.value)}
              placeholder="เช่น N-Health, กรมวิทยาศาสตร์การแพทย์"
              aria-invalid={Boolean(errors.vendor)}
            />
            {errors.vendor && <small className="field-error">{errors.vendor}</small>}
          </label>
          <label>
            หน่วยงาน
            <select
              value={state.department}
              onChange={(event) => patch('department', event.target.value as FormState['department'])}
            >
              <option value="">ไม่ระบุ</option>
              {OUT_LAB_DEPARTMENTS.map((department) => (
                <option value={department} key={department}>{department}</option>
              ))}
            </select>
          </label>

          {isPlan ? (
            <div className="form-grid__wide">
              <p className="form-notice">
                ช่วงเวลาของสัญญางบตามแผนคิดจากปีงบประมาณ {state.fiscalYear} โดยอัตโนมัติ:{' '}
                <strong className="identifier">{planPeriod.startDate}</strong> ถึง{' '}
                <strong className="identifier">{planPeriod.endDate}</strong>
              </p>
              {errors.startDate && <small className="field-error">{errors.startDate}</small>}
            </div>
          ) : (
            <>
              <label>
                วันเริ่มสัญญา
                <ThaiDateInput
                  value={state.startDate}
                  onChange={(value) => patch('startDate', value)}
                  aria-invalid={Boolean(errors.startDate)}
                />
                {errors.startDate && <small className="field-error">{errors.startDate}</small>}
              </label>
              <label>
                วันสิ้นสุดสัญญา
                <ThaiDateInput
                  value={state.endDate}
                  onChange={(value) => patch('endDate', value)}
                  aria-invalid={Boolean(errors.endDate)}
                />
                {errors.endDate && <small className="field-error">{errors.endDate}</small>}
              </label>
            </>
          )}

          <label className="form-grid__wide">
            หมายเหตุ (ถ้ามี)
            <input
              value={state.note}
              onChange={(event) => patch('note', event.target.value)}
              maxLength={1000}
            />
          </label>
        </div>
      </section>

      {mode === 'create' && !isPlan && (
        <section className="bench-panel form-panel" aria-labelledby="out-lab-stage-title">
          <div className="section-heading-row">
            <div>
              <p className="section-kicker">PROCUREMENT</p>
              <h2 id="out-lab-stage-title">ขั้นตอนจัดซื้อ</h2>
            </div>
          </div>
          <div className="form-grid">
            {isAdmin && (
              <label className="form-grid__wide field-toggle">
                <input
                  type="checkbox"
                  checked={state.startImmediately}
                  onChange={(event) => patch('startImmediately', event.target.checked)}
                />
                สัญญานี้เริ่มใช้งานแล้ว (มีเลขที่สัญญาอยู่แล้ว)
              </label>
            )}
            <label>
              {state.startImmediately ? 'วันที่เริ่มสัญญา' : 'วันที่ส่งพัสดุ'}
              <ThaiDateInput
                value={state.effectiveDate}
                onChange={(value) => patch('effectiveDate', value)}
                aria-invalid={Boolean(errors.effectiveDate)}
              />
              {errors.effectiveDate && <small className="field-error">{errors.effectiveDate}</small>}
            </label>
            {state.startImmediately && (
              <label>
                เลขที่สัญญา
                <input
                  value={state.contractNumber}
                  onChange={(event) => patch('contractNumber', event.target.value)}
                  placeholder="เช่น 15/69"
                  aria-invalid={Boolean(errors.contractNumber)}
                />
                {errors.contractNumber && <small className="field-error">{errors.contractNumber}</small>}
              </label>
            )}
          </div>
        </section>
      )}

      {mode === 'create' && isPlan && (
        <section className="bench-panel form-panel" aria-labelledby="out-lab-plan-note-title">
          <div className="section-heading-row">
            <div>
              <p className="section-kicker">ANNUAL PLAN</p>
              <h2 id="out-lab-plan-note-title">ไม่มีขั้นตอนจัดซื้อ</h2>
            </div>
          </div>
          <p className="items-editor__note">
            สัญญางบตามแผนใช้งานได้ทันทีและตั้งใหม่ทุกปีงบประมาณ จึงไม่มีขั้นตอนจัดซื้อและไม่มีเลขที่สัญญา
            บันทึกยอดใช้จ่ายรายเดือนได้ที่หน้ารายละเอียดหลังบันทึกแล้ว
          </p>
        </section>
      )}

      <div className="form-action-bar">
        <div aria-live="polite">
          {message && <p className={Object.keys(errors).length ? 'form-error' : 'form-notice'}>{message}</p>}
        </div>
        <div className="form-action-bar__buttons">
          <Button variant="secondary" onClick={() => router.back()} disabled={isPending}>ยกเลิก</Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? 'กำลังบันทึก…' : mode === 'create' ? 'บันทึกสัญญา' : 'บันทึกการแก้ไข'}
          </Button>
        </div>
      </div>
    </form>
  )
}
