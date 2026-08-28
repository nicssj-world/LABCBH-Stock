'use client'

import { useId, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setServicePlanResponsibles } from '@/lib/service-procurement/actions'
import {
  filterServicePlanCandidates,
  toggleServicePlanCandidate,
  type ServicePlanResponsibleCandidate,
} from '@/lib/service-procurement/responsible-picker'

interface ServicePlanResponsibleDialogProps {
  planId: string
  candidates: readonly ServicePlanResponsibleCandidate[]
  selected: readonly string[]
  onSaved?: () => void
}

function candidateMeta(candidate: ServicePlanResponsibleCandidate) {
  return [candidate.ephisId, candidate.positionTitle ?? 'ไม่ระบุตำแหน่ง']
    .filter(Boolean)
    .join(' · ')
}

export function ServicePlanResponsibleDialog({
  planId,
  candidates,
  selected,
  onSaved,
}: ServicePlanResponsibleDialogProps) {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [chosen, setChosen] = useState<string[]>([...selected])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const idPrefix = useId()
  const titleId = `${idPrefix}-title`
  const descriptionId = `${idPrefix}-description`
  const searchId = `${idPrefix}-search`

  const byId = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  )
  const matches = useMemo(
    () => filterServicePlanCandidates(candidates, search),
    [candidates, search],
  )

  const openDialog = () => {
    setChosen([...selected])
    setSearch('')
    setError(null)
    if (!dialogRef.current?.open) dialogRef.current?.showModal()
  }

  const closeDialog = () => {
    dialogRef.current?.close()
  }

  const dirty = chosen.length !== selected.length || chosen.some((id) => !selected.includes(id))

  const save = () => {
    setError(null)
    startTransition(async () => {
      try {
        await setServicePlanResponsibles(planId, chosen)
        router.refresh()
        onSaved?.()
        closeDialog()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกผู้รับผิดชอบไม่สำเร็จ')
      }
    })
  }

  const toggle = (id: string) => {
    setChosen((current) => toggleServicePlanCandidate(current, id))
  }

  return (
    <>
      <Button
        variant="secondary"
        className="service-plan-responsible-trigger"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        กำหนดผู้รับผิดชอบ
      </Button>

      <dialog
        ref={dialogRef}
        className="app-dialog service-plan-responsible-dialog"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id={titleId}>กำหนดผู้รับผิดชอบแผน</h2>
            <p id={descriptionId}>เลือกผู้ที่สามารถบันทึกค่าใช้จ่ายและปิด PO ของแผนนี้ได้</p>
          </div>
          <button
            type="button"
            className="app-dialog__close"
            aria-label="ปิดหน้าต่างกำหนดผู้รับผิดชอบแผน"
            onClick={closeDialog}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="app-dialog__body service-plan-responsible-dialog__body">
          <div className="service-plan-responsible-picker">
            <section className="service-plan-responsible-picker__selected" aria-labelledby={`${idPrefix}-selected-title`}>
              <div className="service-plan-responsible-picker__subheading">
                <h3 id={`${idPrefix}-selected-title`}>เลือกแล้ว</h3>
                <span>{chosen.length} คน</span>
              </div>
              {chosen.length === 0 ? (
                <p className="empty-state service-plan-responsible-picker__empty">ยังไม่ได้เลือกผู้รับผิดชอบ</p>
              ) : (
                <ul className="service-plan-responsible-picker__chosen">
                  {chosen.map((id) => {
                    const candidate = byId.get(id)
                    return (
                      <li key={id}>
                        <span>
                          <strong>{candidate?.name ?? id}</strong>
                          <small>{candidate ? candidateMeta(candidate) : 'ไม่พบข้อมูลผู้ใช้'}</small>
                        </span>
                        <Button
                          variant="ghost"
                          onClick={() => toggle(id)}
                          disabled={isPending}
                          aria-label={`นำ ${candidate?.name ?? id} ออกจากผู้รับผิดชอบ`}
                        >
                          นำออก
                        </Button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <label className="field-row" htmlFor={searchId}>
              ค้นหาผู้รับผิดชอบ
              <input
                id={searchId}
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="ชื่อ หรือรหัส E-Phis"
                autoComplete="off"
                aria-controls={`${idPrefix}-results`}
              />
            </label>

            <p className="service-plan-responsible-picker__result-count" role="status" aria-live="polite">
              {candidates.length === 0
                ? 'ยังไม่มีรายชื่อผู้รับผิดชอบให้เลือก'
                : matches.length === 0
                  ? 'ไม่พบรายชื่อที่ตรงกัน ลองค้นหาด้วยชื่อหรือรหัส E-Phis อื่น'
                  : search.trim()
                    ? `พบ ${matches.length} คน`
                    : `แสดง ${matches.length} คนแรกจาก ${candidates.length} คน`}
            </p>

            {matches.length > 0 && (
              <ul id={`${idPrefix}-results`} className="service-plan-responsible-picker__options" aria-label="รายชื่อผู้รับผิดชอบที่ค้นพบ">
                {matches.map((candidate) => {
                  const checkboxId = `${idPrefix}-${candidate.id}`
                  return (
                    <li key={candidate.id}>
                      <label htmlFor={checkboxId}>
                        <input
                          id={checkboxId}
                          type="checkbox"
                          checked={chosen.includes(candidate.id)}
                          onChange={() => toggle(candidate.id)}
                          disabled={isPending}
                        />
                        <span>
                          <strong>{candidate.name}</strong>
                          <small>{candidateMeta(candidate)}</small>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}

            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="service-plan-responsible-picker__actions">
              <Button variant="secondary" onClick={closeDialog} disabled={isPending}>ยกเลิก</Button>
              <Button onClick={save} disabled={isPending || !dirty}>
                {isPending ? 'กำลังบันทึก…' : 'บันทึกผู้รับผิดชอบ'}
              </Button>
            </div>
          </div>
        </div>
      </dialog>
    </>
  )
}
