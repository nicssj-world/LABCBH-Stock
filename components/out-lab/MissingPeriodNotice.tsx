import { StatusChip } from '@/components/ui/StatusChip'
import type { MissingUsagePeriod } from '@/lib/out-lab/fiscal'
import { missingPeriodLabel } from '@/lib/out-lab/presenter'

/**
 * A cadence is a reminder, never a gate. Periods only appear here once they
 * have fully elapsed, so the notice stays worth reading instead of standing
 * permanently at "this month is empty".
 */
export function MissingPeriodNotice({
  periods,
  cadenceLabel,
}: {
  periods: MissingUsagePeriod[]
  cadenceLabel: string
}) {
  if (periods.length === 0) {
    return (
      <p className="completion-note">ลงข้อมูล{cadenceLabel}ครบทุกงวดที่ผ่านมาแล้ว</p>
    )
  }

  return (
    <div className="out-lab-missing-periods" role="status">
      <p>
        สัญญานี้กำหนดลงข้อมูล{cadenceLabel} และยังไม่มียอดของ {periods.length} งวดที่ผ่านมาแล้ว
      </p>
      <ul className="out-lab-missing-periods__list">
        {periods.map((period) => (
          <li key={period.period === 'month' ? period.month : `${period.fiscalYear}-${period.quarter}`}>
            <StatusChip tone="attention">{missingPeriodLabel(period)}</StatusChip>
          </li>
        ))}
      </ul>
    </div>
  )
}
