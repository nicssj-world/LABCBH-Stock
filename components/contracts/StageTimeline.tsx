import { StageHistoryEntryEditor } from '@/components/contracts/StageHistoryEntryEditor'
import { StatusChip } from '@/components/ui/StatusChip'
import { PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import type { ProcurementStage } from '@/lib/contracts/stages'

const thaiDate = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  dateStyle: 'medium',
  timeZone: 'Asia/Bangkok',
})

/**
 * Structural rather than tied to ContractRecord: the Out Lab register keeps its
 * own tables and its own uuid ids, but walks the identical six stages. Widening
 * the prop was cheaper and safer than a second copy of the timeline that would
 * drift the first time a stage label changed.
 *
 * `canManageStageHistory` stays contract-only — StageHistoryEntryEditor writes
 * through the contract stage-correction RPCs, which do not know this register.
 */
export interface StageTimelineContract {
  procurementStage: ProcurementStage | null
  stageHistory: Array<{
    id: string
    toStage: ProcurementStage
    effectiveDate: string
    source: string
    note: string | null
    correctionReason?: string | null
  }>
}

export function StageTimeline({
  contract,
  canManageStageHistory = false,
  stageHistoryEditorContractId,
}: {
  contract: StageTimelineContract
  canManageStageHistory?: boolean
  /** Contract-register id. Omitted by callers with no correction workflow. */
  stageHistoryEditorContractId?: number
}) {
  const currentIndex = contract.procurementStage
    ? PROCUREMENT_STAGES.indexOf(contract.procurementStage)
    : -1

  return (
    <ol className="stage-timeline">
      {PROCUREMENT_STAGES.map((stage, index) => {
        const history = contract.stageHistory.find((entry) => entry.toStage === stage)
        const state = index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'future'
        return (
          <li key={stage} data-state={state}>
            <span className="stage-timeline__marker" aria-hidden="true">{index + 1}</span>
            <div>
              <strong>{PROCUREMENT_STAGE_LABELS[stage]}</strong>
              {history ? (
                <>
                  <time dateTime={history.effectiveDate}>{thaiDate.format(new Date(`${history.effectiveDate}T00:00:00+07:00`))}</time>
                  {history.source !== 'labcbh_stock' && <small>นำเข้าจากระบบเดิม</small>}
                  {history.note && <small>{history.note}</small>}
                  {history.correctionReason && <small>แก้ไขย้อนหลัง: {history.correctionReason}</small>}
                </>
              ) : (
                <small>{index <= currentIndex ? 'ไม่มีข้อมูลย้อนหลัง' : 'ยังไม่ถึงขั้นตอนนี้'}</small>
              )}
            </div>
            <div className="stage-timeline__actions">
              {state === 'current' && <StatusChip tone="info">ขั้นตอนปัจจุบัน</StatusChip>}
              {canManageStageHistory && stageHistoryEditorContractId !== undefined && (history || index <= currentIndex) && (
                <StageHistoryEntryEditor
                  contractId={stageHistoryEditorContractId}
                  stage={stage}
                  history={history ?? null}
                />
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
