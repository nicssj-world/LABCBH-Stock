'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { rolloverServicePlans } from '@/lib/service-procurement/actions'
import { formatBaht, servicePlanTypeLabel } from '@/lib/service-procurement/presenter'
import type { ServicePlanRolloverReview } from '@/lib/service-procurement/types'

interface ReviewRow {
  sourcePlanId: string
  selected: boolean
  budget: string
  error: string | null
}

interface Props {
  review: ServicePlanRolloverReview
  autoOpen?: boolean
}

function initialRows(review: ServicePlanRolloverReview): ReviewRow[] {
  return review.items.map((item) => ({
    sourcePlanId: item.sourcePlanId,
    selected: !item.alreadyRolledOver,
    budget: String(item.budget),
    error: null,
  }))
}

export function ServicePlanRolloverDialog({ review, autoOpen = false }: Props) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const autoOpenedRef = useRef(false)
  const [rows, setRows] = useState<ReviewRow[]>(() => initialRows(review))
  const [error, setError] = useState<string | null>(null)
  const [confirmEmpty, setConfirmEmpty] = useState(false)
  const [pending, startTransition] = useTransition()

  const itemById = useMemo(() => new Map(review.items.map((item) => [item.sourcePlanId, item])), [review.items])
  const selectableRows = rows.filter((row) => !itemById.get(row.sourcePlanId)?.alreadyRolledOver)
  const selectedRows = selectableRows.filter((row) => row.selected)
  const oldTotal = selectedRows.reduce((sum, row) => sum + (itemById.get(row.sourcePlanId)?.budget ?? 0), 0)
  const newTotal = selectedRows.reduce((sum, row) => sum + Number(row.budget || 0), 0)
  const difference = newTotal - oldTotal
  const dirty = rows.some((row) => {
    const item = itemById.get(row.sourcePlanId)
    return item !== undefined && !item.alreadyRolledOver && (!row.selected || Number(row.budget) !== item.budget)
  })

  const openDialog = () => {
    setRows(initialRows(review))
    setError(null)
    setConfirmEmpty(false)
    if (!dialogRef.current?.open) dialogRef.current?.showModal()
  }

  useEffect(() => {
    if (autoOpen && review.items.length > 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      openDialog()
    }
  // The query-string trigger is intentionally consumed once per mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, review.items.length])

  const closeDialog = (force = false) => {
    if (pending && !force) return
    if (!force && dirty && !window.confirm('ปิดหน้าต่างโดยไม่ยืนยันการตรวจทานใช่หรือไม่')) return
    dialogRef.current?.close()
  }

  const setAll = (selected: boolean) => {
    setRows((current) => current.map((row) => itemById.get(row.sourcePlanId)?.alreadyRolledOver ? row : { ...row, selected, error: null }))
    setConfirmEmpty(false)
    setError(null)
  }

  const updateRow = (sourcePlanId: string, next: Partial<ReviewRow>) => {
    setRows((current) => current.map((row) => row.sourcePlanId === sourcePlanId ? { ...row, ...next, error: null } : row))
    setConfirmEmpty(false)
    setError(null)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const validated = rows.map((row) => {
      if (!row.selected || itemById.get(row.sourcePlanId)?.alreadyRolledOver) return { ...row, error: null }
      const budget = Number(row.budget)
      const valid = Number.isFinite(budget) && budget > 0 && Math.round(budget * 100) === budget * 100
      return { ...row, error: valid ? null : 'ระบุวงเงินที่มากกว่า 0 และไม่เกิน 2 ตำแหน่ง' }
    })
    setRows(validated)
    const firstInvalid = validated.find((row) => row.error)
    if (firstInvalid) {
      setError('กรุณาตรวจสอบวงเงินของแผนที่มีข้อความแจ้งเตือน')
      requestAnimationFrame(() => {
        const matchingInputs = dialogRef.current?.querySelectorAll<HTMLInputElement>(`[data-rollover-budget="${firstInvalid.sourcePlanId}"]`)
        Array.from(matchingInputs ?? []).find((input) => input.offsetParent !== null)?.focus()
      })
      return
    }
    const chosen = validated.filter((row) => row.selected && !itemById.get(row.sourcePlanId)?.alreadyRolledOver)
    if (chosen.length === 0 && !confirmEmpty) {
      setConfirmEmpty(true)
      setError('ไม่มีแผนถูกเลือก กดยืนยันอีกครั้งเพื่อบันทึกว่าไม่คัดลอกแผนในรอบนี้')
      return
    }

    setError(null)
    startTransition(async () => {
      try {
        const result = await rolloverServicePlans({
          sourceFiscalYear: review.sourceFiscalYear,
          targetFiscalYear: review.targetFiscalYear,
          items: chosen.map((row) => {
            const source = itemById.get(row.sourcePlanId)!
            return {
              sourcePlanId: row.sourcePlanId,
              budget: Number(row.budget),
              expectedUpdatedAt: source.sourceUpdatedAt,
              responsibleProfileIds: source.responsibleProfileIds,
            }
          }),
        }) as { selectedCount?: number }
        closeDialog(true)
        const created = Number(result.selectedCount ?? chosen.length)
        router.replace(`/service-procurement/plans?fiscalYear=${review.targetFiscalYear}&notice=rollover-success&created=${created}`)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'คัดลอกแผนงานจ้างไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  const hasSourcePlans = review.items.length > 0
  return (
    <>
      <Button onClick={openDialog} disabled={!hasSourcePlans} aria-haspopup="dialog">
        {hasSourcePlans ? `เตรียมแผนปี ${review.targetFiscalYear}` : `ไม่มีแผนปี ${review.sourceFiscalYear} ให้คัดลอก`}
      </Button>
      <dialog
        ref={dialogRef}
        className="app-dialog service-plan-rollover-dialog"
        aria-labelledby="service-plan-rollover-title"
        aria-describedby="service-plan-rollover-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
        onClick={(event) => { if (event.target === event.currentTarget) closeDialog() }}
      >
        <form className="service-plan-rollover-form" onSubmit={submit}>
          <header className="app-dialog__header service-plan-rollover-dialog__header">
            <div>
              <h2 id="service-plan-rollover-title">ตรวจทานแผนปี {review.sourceFiscalYear} → {review.targetFiscalYear}</h2>
              <p id="service-plan-rollover-description">เลือกแผนที่จะใช้ต่อและแก้วงเงินสำหรับปีงบประมาณใหม่ก่อนยืนยัน</p>
            </div>
            <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างตรวจทานแผน" onClick={() => closeDialog()} disabled={pending}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            </button>
          </header>

          <div className="app-dialog__body service-plan-rollover-dialog__body">
            <dl className="service-plan-rollover-summary" aria-label="สรุปแผนที่เลือก">
              <div><dt>เลือกแล้ว</dt><dd>{selectedRows.length.toLocaleString('th-TH')} แผน</dd></div>
              <div><dt>วงเงินเดิม</dt><dd>{formatBaht(oldTotal)}</dd></div>
              <div><dt>วงเงินปี {review.targetFiscalYear}</dt><dd>{formatBaht(newTotal)}</dd></div>
              <div><dt>ส่วนต่าง</dt><dd className={difference < 0 ? 'is-decrease' : difference > 0 ? 'is-increase' : ''}>{difference > 0 ? '+' : ''}{formatBaht(difference)}</dd></div>
            </dl>

            <div className="service-plan-rollover-toolbar">
              <p>{review.reviewed ? 'เคยตรวจทานแล้ว สามารถกลับมาเลือกแผนที่ยังไม่ได้สร้างได้' : 'แผนที่ยังไม่เคยสร้างถูกเลือกไว้ทั้งหมด'}</p>
              <div><Button variant="ghost" onClick={() => setAll(true)} disabled={pending}>เลือกทั้งหมด</Button><Button variant="ghost" onClick={() => setAll(false)} disabled={pending}>ไม่เลือกทั้งหมด</Button></div>
            </div>

            <div className="service-plan-rollover-table-wrap">
              <table className="data-table service-plan-rollover-table">
                <thead><tr><th scope="col">นำไปปีใหม่</th><th scope="col">แผนงานจ้าง</th><th scope="col" className="numeric-cell">วงเงินเดิม</th><th scope="col" className="numeric-cell">วงเงินปี {review.targetFiscalYear}</th><th scope="col">สถานะ</th></tr></thead>
                <tbody>{rows.map((row) => {
                  const item = itemById.get(row.sourcePlanId)!
                  return <tr key={row.sourcePlanId} className={row.selected ? 'is-selected' : ''}>
                    <td><label className="service-plan-rollover-check"><input type="checkbox" checked={row.selected} disabled={pending || item.alreadyRolledOver} onChange={(event) => updateRow(row.sourcePlanId, { selected: event.target.checked })} /><span className="sr-only">นำแผน {item.name} ไปปี {review.targetFiscalYear}</span></label></td>
                    <td><strong>{item.name}</strong><small>{item.department} · {servicePlanTypeLabel(item.type)} · รายการส่งตรวจ {item.testItemCount} · ผู้รับผิดชอบ {item.responsibleCount}</small></td>
                    <td className="numeric-cell identifier">{formatBaht(item.budget)}</td>
                    <td className="numeric-cell"><label><span className="sr-only">วงเงินปี {review.targetFiscalYear} ของ {item.name}</span><MoneyInput data-rollover-budget={row.sourcePlanId} value={row.budget} onValueChange={(budget) => updateRow(row.sourcePlanId, { budget })} min="0.01" step="0.01" disabled={pending || !row.selected || item.alreadyRolledOver} aria-invalid={Boolean(row.error)} />{row.error && <small className="form-error" role="alert">{row.error}</small>}</label></td>
                    <td>{item.alreadyRolledOver && item.targetPlanId ? <Link className="text-link" href={`/service-procurement/plans/${item.targetPlanId}`}>สร้างแล้ว</Link> : row.selected ? 'พร้อมสร้าง' : 'ไม่นำไปปีใหม่'}</td>
                  </tr>
                })}</tbody>
              </table>
            </div>

            <ul className="service-plan-rollover-cards" aria-label="รายการแผนสำหรับตรวจทาน">
              {rows.map((row) => {
                const item = itemById.get(row.sourcePlanId)!
                return <li key={row.sourcePlanId} className={`service-plan-rollover-card${row.selected ? ' is-selected' : ''}`}>
                  <label className="service-plan-rollover-card__select"><input type="checkbox" checked={row.selected} disabled={pending || item.alreadyRolledOver} onChange={(event) => updateRow(row.sourcePlanId, { selected: event.target.checked })} /><span>นำแผนนี้ไปปี {review.targetFiscalYear}</span></label>
                  <div><strong>{item.name}</strong><small>{item.department} · {servicePlanTypeLabel(item.type)}</small></div>
                  <dl><div><dt>วงเงินเดิม</dt><dd>{formatBaht(item.budget)}</dd></div><div><dt>ข้อมูลที่จะคัดลอก</dt><dd>{item.testItemCount} รายการ · {item.responsibleCount} คน</dd></div></dl>
                  {item.alreadyRolledOver && item.targetPlanId ? <Link className="text-link" href={`/service-procurement/plans/${item.targetPlanId}`}>เปิดแผนที่สร้างแล้ว</Link> : <label className="field-row"><span>วงเงินปี {review.targetFiscalYear}</span><MoneyInput data-rollover-budget={row.sourcePlanId} value={row.budget} onValueChange={(budget) => updateRow(row.sourcePlanId, { budget })} min="0.01" step="0.01" disabled={pending || !row.selected} aria-invalid={Boolean(row.error)} />{row.error && <small className="form-error" role="alert">{row.error}</small>}</label>}
                </li>
              })}
            </ul>
            {error && <p className="service-plan-rollover-error" role="alert">{error}</p>}
          </div>

          <footer className="service-plan-rollover-dialog__footer">
            <p aria-live="polite">เลือก {selectedRows.length} จาก {selectableRows.length} แผน · วงเงินใหม่ {formatBaht(newTotal)}</p>
            <div><Button variant="secondary" onClick={() => closeDialog()} disabled={pending}>ยกเลิก</Button><Button type="submit" disabled={pending}>{pending ? 'กำลังสร้างแผน…' : selectedRows.length === 0 ? 'ยืนยันว่าไม่คัดลอกแผน' : `สร้าง ${selectedRows.length} แผนในปี ${review.targetFiscalYear}`}</Button></div>
          </footer>
        </form>
      </dialog>
    </>
  )
}
