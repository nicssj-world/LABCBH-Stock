import { StatusChip } from '@/components/ui/StatusChip'
import { PROCUREMENT_STAGE_LABELS } from '@/lib/contracts/presenter'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import type { ContractRecord } from '@/lib/contracts/types'

const thaiDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' })

export function StageTimeline({ contract }: { contract: ContractRecord }) {
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
                </>
              ) : (
                <small>{index <= currentIndex ? 'ไม่มีข้อมูลย้อนหลัง' : 'ยังไม่ถึงขั้นตอนนี้'}</small>
              )}
            </div>
            {state === 'current' && <StatusChip tone="info">ขั้นตอนปัจจุบัน</StatusChip>}
          </li>
        )
      })}
    </ol>
  )
}
