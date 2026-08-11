'use client'

import { useMemo, useState, useTransition, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { backfillContractStageHistory, correctContractStageHistory } from '@/lib/contracts/actions'
import { PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import { PROCUREMENT_STAGES, type ProcurementStage } from '@/lib/contracts/stages'
import type { ContractStageHistoryRecord } from '@/lib/contracts/types'

function todayIso() {
  return bangkokIsoDate()
}

export function StageHistoryEditor({
  contractId,
  stageHistory,
  currentStage,
}: {
  contractId: number
  stageHistory: ContractStageHistoryRecord[]
  currentStage: ProcurementStage | null
}) {
  const availableStages = useMemo(() => currentStage
    ? PROCUREMENT_STAGES.slice(0, PROCUREMENT_STAGES.indexOf(currentStage) + 1)
    : PROCUREMENT_STAGES, [currentStage])
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<ProcurementStage>(availableStages[0] ?? 'sent_to_procurement')
  const selectedHistory = stageHistory.find((entry) => entry.toStage === stage)
  const [effectiveDate, setEffectiveDate] = useState(selectedHistory?.effectiveDate ?? todayIso())
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const chooseStage = (next: ProcurementStage) => {
    setStage(next)
    setEffectiveDate(stageHistory.find((entry) => entry.toStage === next)?.effectiveDate ?? todayIso())
    setReason('')
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        if (selectedHistory) {
          await correctContractStageHistory({ historyId: selectedHistory.id, effectiveDate, reason })
        } else {
          await backfillContractStageHistory(contractId, { toStage: stage, effectiveDate, note: reason })
        }
        setOpen(false)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกประวัติขั้นตอนสัญญาไม่สำเร็จ')
      }
    })
  }

  return (
    <div className="decision-control">
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>แก้ไข/บันทึกย้อนหลัง</Button>
      ) : (
        <form className="decision-panel" onSubmit={submit}>
          <div>
            <strong>{selectedHistory ? 'แก้ไขวันที่ขั้นตอน' : 'บันทึกขั้นตอนย้อนหลัง'}</strong>
            <p>ประวัติเดิมจะไม่ถูกลบ และการแก้ไขต้องระบุเหตุผล</p>
          </div>
          <label>
            ขั้นตอน
            <select value={stage} onChange={(event) => chooseStage(event.target.value as ProcurementStage)}>
              {availableStages.map((option) => <option value={option} key={option}>{PROCUREMENT_STAGE_LABELS[option]}</option>)}
            </select>
          </label>
          <label>
            วันที่มีผล
            <ThaiDateInput required value={effectiveDate} onChange={setEffectiveDate} />
          </label>
          <label>
            เหตุผล/หมายเหตุ
            <textarea required rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="decision-panel__actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'กำลังบันทึก…' : 'บันทึก'}</Button>
          </div>
        </form>
      )}
    </div>
  )
}
