'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import type { ResponsibleCandidate } from '@/components/contracts/ResponsibleUserPicker'
import { setOutLabResponsibleUsers } from '@/lib/out-lab/actions'

interface OutLabResponsibleDialogProps {
  contractId: string
  candidates: ResponsibleCandidate[]
  selected: string[]
}

/**
 * Being listed here is the right to record spending against this contract, so
 * every change is written to out_lab_responsible_audit by the RPC.
 */
export function OutLabResponsibleDialog({
  contractId,
  candidates,
  selected,
}: OutLabResponsibleDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [chosen, setChosen] = useState<string[]>(selected)
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return candidates.slice(0, 8)
    return candidates
      .filter(
        (candidate) =>
          candidate.name.toLowerCase().includes(needle) ||
          (candidate.ephisId ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 8)
  }, [candidates, search])

  const open = () => {
    setChosen(selected)
    setNote('')
    setError(null)
    dialogRef.current?.showModal()
  }

  const close = () => {
    if (isPending) return
    dialogRef.current?.close()
  }

  const toggle = (id: string) => {
    setChosen((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    )
  }

  const save = () => {
    setError(null)
    startTransition(async () => {
      try {
        await setOutLabResponsibleUsers({ contractId, profileIds: chosen, note: note.trim() || null })
        dialogRef.current?.close()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกผู้รับผิดชอบไม่สำเร็จ')
      }
    })
  }

  return (
    <>
      <button
        type="button"
        className="lab-link-button lab-link-button--secondary contract-responsible-trigger"
        aria-haspopup="dialog"
        onClick={open}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        กำหนดผู้รับผิดชอบ
      </button>

      <dialog
        ref={dialogRef}
        className="app-dialog responsible-dialog"
        aria-labelledby="out-lab-responsible-title"
        onCancel={(event) => { event.preventDefault(); close() }}
        onClick={(event) => { if (event.target === event.currentTarget) close() }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="out-lab-responsible-title">ผู้รับผิดชอบสัญญา</h2>
            <p>ผู้ที่อยู่ในรายชื่อนี้บันทึกยอดใช้จ่ายของสัญญานี้ได้ แม้ไม่มีสิทธิ์แก้ไขสัญญา</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างผู้รับผิดชอบ" onClick={close}>×</button>
        </header>

        <div className="app-dialog__body">
          <ul className="responsible-picker__selected" aria-label="ผู้รับผิดชอบที่เลือกไว้">
            {chosen.length === 0 ? (
              <li className="empty-state">ยังไม่ได้เลือกผู้รับผิดชอบ</li>
            ) : (
              chosen.map((id) => (
                <li key={id}>
                  <button type="button" onClick={() => toggle(id)} disabled={isPending}>
                    {byId.get(id)?.name ?? id}
                    <span aria-hidden="true"> ×</span>
                    <span className="visually-hidden">นำออกจากรายชื่อ</span>
                  </button>
                </li>
              ))
            )}
          </ul>

          <label>
            ค้นหาผู้ใช้งาน
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ชื่อ หรือรหัส E-Phis"
            />
          </label>

          <ul className="responsible-picker__matches" aria-label="ผลการค้นหาผู้ใช้งาน">
            {matches.map((candidate) => (
              <li key={candidate.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.includes(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                    disabled={isPending}
                  />
                  {candidate.name}
                  <small>{candidate.ephisId ?? 'ไม่มีรหัส E-Phis'}</small>
                </label>
              </li>
            ))}
          </ul>

          <label>
            หมายเหตุ (ถ้ามี)
            <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="decision-panel__actions">
            <Button variant="secondary" onClick={close} disabled={isPending}>ยกเลิก</Button>
            <Button onClick={save} disabled={isPending}>
              {isPending ? 'กำลังบันทึก…' : 'บันทึกผู้รับผิดชอบ'}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  )
}
