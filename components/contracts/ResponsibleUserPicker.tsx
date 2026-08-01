'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { setResponsibleUsers } from '@/lib/contracts/budget-actions'

export interface ResponsibleCandidate {
  id: string
  name: string
  ephisId: string | null
  role: string | null
}

interface ResponsibleUserPickerProps {
  contractId: number
  candidates: ResponsibleCandidate[]
  selected: string[]
  canEdit: boolean
  onSaved?: () => void
}

/**
 * Being listed here is the right to record spending against this contract, so
 * every change is written to contract_responsible_audit by the RPC.
 */
export function ResponsibleUserPicker({
  contractId,
  candidates,
  selected,
  canEdit,
  onSaved,
}: ResponsibleUserPickerProps) {
  const router = useRouter()
  const [chosen, setChosen] = useState<string[]>(selected)
  const [search, setSearch] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [isPending, startTransition] = useTransition()

  const byId = useMemo(
    () => new Map(candidates.map((candidate) => [candidate.id, candidate])),
    [candidates],
  )

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return candidates.slice(0, 8)
    return candidates
      .filter(
        (candidate) =>
          candidate.name.toLowerCase().includes(needle) ||
          (candidate.ephisId ?? '').includes(needle),
      )
      .slice(0, 8)
  }, [candidates, search])

  const dirty =
    chosen.length !== selected.length || chosen.some((id) => !selected.includes(id))

  const toggle = (id: string) => {
    setSaved(false)
    setChosen((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    )
  }

  const save = () => {
    setError(null)
    startTransition(async () => {
      try {
        await setResponsibleUsers({
          contractId,
          profileIds: chosen,
          note: note.trim() || null,
        })
        setNote('')
        setSaved(true)
        router.refresh()
        onSaved?.()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกผู้รับผิดชอบไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="responsible-picker">
      {chosen.length === 0 ? (
        <p className="empty-state">ยังไม่ได้ระบุผู้รับผิดชอบ</p>
      ) : (
        <ul className="responsible-picker__chosen">
          {chosen.map((id) => {
            const candidate = byId.get(id)
            return (
              <li key={id}>
                <span>
                  {candidate?.name ?? id}
                  {candidate?.ephisId && <small> · {candidate.ephisId}</small>}
                </span>
                {canEdit && (
                  <Button variant="ghost" onClick={() => toggle(id)} disabled={isPending}>
                    นำออก
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <>
          <label className="field-row">
            ค้นหาผู้รับผิดชอบ
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="ชื่อ หรือรหัส E-Phis"
            />
          </label>

          <ul className="responsible-picker__options">
            {matches.map((candidate) => (
              <li key={candidate.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={chosen.includes(candidate.id)}
                    onChange={() => toggle(candidate.id)}
                    disabled={isPending}
                  />
                  <span>
                    {candidate.name}
                    <small>
                      {candidate.ephisId ?? 'ไม่มีรหัส'} · {candidate.role ?? 'ไม่ระบุตำแหน่ง'}
                    </small>
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {dirty && (
            <label className="field-row">
              เหตุผล (บันทึกลงประวัติการให้สิทธิ์)
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={500}
                placeholder="เช่น มอบหมายให้ดูแลสัญญานี้"
              />
            </label>
          )}

          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {saved && !dirty && <p className="form-notice">บันทึกผู้รับผิดชอบแล้ว</p>}

          <div className="form-action-bar__buttons">
            <Button onClick={save} disabled={isPending || !dirty}>
              {isPending ? 'กำลังบันทึก…' : 'บันทึกผู้รับผิดชอบ'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
