import { StatusChip } from '@/components/ui/StatusChip'
import { PROCUREMENT_STAGES } from '@/lib/contracts/stages'
import type { ProcurementStage } from '@/lib/contracts/stages'

/**
 * The six procurement stages are a sequence, not six unrelated categories, so
 * the stage keeps one colour and the position is carried by a separate track.
 * Giving each stage its own colour would spend the register's only urgency
 * channel — the green/amber/red of contract status and the remaining gauge —
 * on a value that is never urgent.
 *
 * Segment colours match StageTimeline on the detail page: completed stages
 * teal, the current one navy. Someone who has seen one reads the other without
 * relearning it.
 */
export function StageProgress({
  stage,
  label,
}: {
  stage: ProcurementStage | null
  label: string
}) {
  const currentIndex = stage ? PROCUREMENT_STAGES.indexOf(stage) : -1

  return (
    <div className="stage-progress">
      <StatusChip tone="info">{label}</StatusChip>
      {currentIndex >= 0 && (
        <>
          {/* Counting dots is not a reading task; the position is announced instead. */}
          <span className="stage-progress__track" aria-hidden="true">
            {PROCUREMENT_STAGES.map((each, index) => (
              <span
                key={each}
                data-state={index < currentIndex ? 'complete' : index === currentIndex ? 'current' : 'future'}
              />
            ))}
          </span>
          <span className="visually-hidden">
            ขั้นตอนที่ {currentIndex + 1} จาก {PROCUREMENT_STAGES.length}
          </span>
        </>
      )}
    </div>
  )
}
