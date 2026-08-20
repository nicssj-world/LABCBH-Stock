'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import { allowedNextStages, type ProcurementStage } from '@/lib/contracts/stages'
import { advanceOutLabContractStage } from '@/lib/out-lab/actions'

export function OutLabStageAdvanceControl({
  contractId,
  currentStage,
}: {
  contractId: string
  currentStage: ProcurementStage
}) {
  const nextStage = allowedNextStages(currentStage)[0]
  const [open, setOpen] = useState(false)
  const [effectiveDate, setEffectiveDate] = useState(bangkokIsoDate())
  const [contractNumber, setContractNumber] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (!nextStage) return <p className="completion-note">สัญญาเริ่มใช้งานแล้ว ไม่มีขั้นตอนถัดไป</p>

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await advanceOutLabContractStage(contractId, {
          from: currentStage,
          to: nextStage,
          effectiveDate,
          contractNumber: nextStage === 'contract_started' ? contractNumber : null,
          note: note.trim() || null,
        })
        setOpen(false)
        // The RPC is the source of truth. A full document reload avoids leaving
        // the stage card and next-action control on the pre-mutation RSC tree.
        window.location.reload()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปลี่ยนขั้นตอนไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <div className="decision-control">
      {!open ? (
        <Button onClick={() => setOpen(true)}>ไปขั้น “{PROCUREMENT_STAGE_LABELS[nextStage]}”</Button>
      ) : (
        <form className="decision-panel" onSubmit={submit}>
          <div>
            <strong>ยืนยันเปลี่ยนขั้นตอน</strong>
            <p>จาก “{PROCUREMENT_STAGE_LABELS[currentStage]}” เป็น “{PROCUREMENT_STAGE_LABELS[nextStage]}”</p>
          </div>
          <label>
            วันที่มีผล
            <ThaiDateInput required value={effectiveDate} onChange={setEffectiveDate} />
          </label>
          {nextStage === 'contract_started' && (
            <label>
              เลขที่สัญญา
              <input
                required
                value={contractNumber}
                onChange={(event) => setContractNumber(event.target.value)}
                placeholder="ระบุเลขที่เมื่อเริ่มสัญญา"
              />
            </label>
          )}
          <label>
            หมายเหตุ (ถ้ามี)
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="decision-panel__actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={isPending}>ยังไม่เปลี่ยน</Button>
            <Button type="submit" disabled={isPending}>{isPending ? 'กำลังยืนยัน…' : 'ยืนยันขั้นตอนใหม่'}</Button>
          </div>
        </form>
      )}
    </div>
  )
}
