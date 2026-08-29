'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { advanceContractStage } from '@/lib/contracts/actions'
import { PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import { allowedNextStages, type ProcurementStage } from '@/lib/contracts/stages'
import type { ContractType } from '@/lib/contracts/types'

function todayIso() {
  return bangkokIsoDate()
}

export function StageAdvanceControl({
  contractId,
  currentStage,
  contractType,
  total,
}: {
  contractId: number
  currentStage: ProcurementStage
  contractType: ContractType | null
  total: number | null
}) {
  const nextStage = allowedNextStages(currentStage)[0]
  const [open, setOpen] = useState(false)
  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [contractNumber, setContractNumber] = useState('')
  // Prefilled rather than blank: a lease added through the direct "เพิ่มสัญญา"
  // form already carries a figure, and signing is the moment to confirm or
  // correct it — not to retype it from nothing.
  const [leaseTotal, setLeaseTotal] = useState(total === null ? '' : String(total))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  if (!nextStage) return <p className="completion-note">สัญญาเริ่มใช้งานแล้ว ไม่มีขั้นตอนถัดไป</p>

  // A lease is billed monthly against this ceiling, and record_contract_expense
  // only enforces the over-budget guard when it is set — so the contract cannot
  // be allowed to start without one.
  const asksForTotal = nextStage === 'contract_started' && contractType === 'equipment_lease'

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await advanceContractStage(contractId, {
          from: currentStage,
          to: nextStage,
          effectiveDate,
          contractNumber: nextStage === 'contract_started' ? contractNumber : null,
          contractType: contractType ?? undefined,
          total: asksForTotal ? Number(leaseTotal) : null,
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
              <input required value={contractNumber} onChange={(event) => setContractNumber(event.target.value)} placeholder="ระบุเลขที่เมื่อเริ่มสัญญา" />
            </label>
          )}
          {asksForTotal && (
            <label>
              มูลค่าสัญญา
              <MoneyInput
                min="0.01"
                step="0.01"
                required
                value={leaseTotal}
                onValueChange={setLeaseTotal}
                placeholder="ระบุมูลค่าตามสัญญาที่ตกลงได้"
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
