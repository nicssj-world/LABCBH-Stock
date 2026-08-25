import type { FiscalYearUsage } from '@/lib/out-lab/fiscal'
import { StickyScroll } from '@/components/ui/StickyScroll'

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })

/**
 * A contract-ceiling row is measured against its contract value, not against a
 * yearly plan — the database enforces only the former. People still budget by
 * fiscal year though, so the split is shown as information, deliberately
 * without a bar or a percentage that would imply a second ceiling.
 */
export function FiscalYearBreakdown({ usage }: { usage: FiscalYearUsage[] }) {
  if (usage.length === 0) {
    return <p className="empty-state">ยังไม่มียอดใช้จ่ายให้แยกตามปีงบประมาณ</p>
  }

  const total = usage.reduce((sum, row) => sum + row.used, 0)

  return (
    <StickyScroll className="detail-items-table" ariaLabel="สรุปยอดใช้จ่ายรายปีงบประมาณ เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
      <table className="data-table">
        <thead>
          <tr>
            <th>ปีงบประมาณ</th>
            <th className="numeric-cell">ยอดใช้จ่ายในปีงบ</th>
          </tr>
        </thead>
        <tbody>
          {usage.map((row) => (
            <tr key={row.fiscalYear}>
              <td className="identifier">{row.fiscalYear}</td>
              <td className="numeric-cell identifier">{money.format(row.used)}</td>
            </tr>
          ))}
          <tr>
            <td><strong>รวมทั้งสัญญา</strong></td>
            <td className="numeric-cell identifier"><strong>{money.format(total)}</strong></td>
          </tr>
        </tbody>
      </table>
    </StickyScroll>
  )
}
