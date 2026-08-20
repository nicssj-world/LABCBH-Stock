'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { backfillContractStageHistory, correctContractStageHistory } from '@/lib/contracts/actions'
import { PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import type { ProcurementStage } from '@/lib/contracts/stages'

function todayIso() {
  return bangkokIsoDate()
}

export function StageHistoryEntryEditor({
  contractId,
  stage,
  history,
}: {
  contractId: number
  stage: ProcurementStage
  // Only the id and the effective date are read, so this is deliberately
  // structural: a caller does not have to own a full ContractStageHistoryRecord.
  history: { id: string; effectiveDate: string } | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [effectiveDate, setEffectiveDate] = useState(history?.effectiveDate ?? todayIso())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const label = history ? 'แก้ไข' : 'บันทึกย้อนหลัง'

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        if (history) {
          await correctContractStageHistory({
            historyId: history.id,
            effectiveDate,
            reason,
          })
        } else {
          await backfillContractStageHistory(contractId, {
            toStage: stage,
            effectiveDate,
            note: reason,
          })
        }
        setOpen(false)
        setReason('')
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกประวัติขั้นตอนไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="stage-timeline__editor">
      <button
        type="button"
        className="stage-timeline__edit"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
      >
        {label}
      </button>
      {open && (
        <form className="stage-timeline__edit-form" onSubmit={submit}>
          <strong>{label} “{PROCUREMENT_STAGE_LABELS[stage]}”</strong>
          <label>
            วันที่มีผล
            <ThaiDateInput required value={effectiveDate} onChange={setEffectiveDate} />
          </label>
          <label>
            เหตุผล/หมายเหตุ
            <textarea required rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="stage-timeline__edit-actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'กำลังบันทึก…' : 'บันทึก'}</Button>
          </div>
        </form>
      )}
    </div>
  )
}
