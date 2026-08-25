import Link from 'next/link'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import { StickyScroll } from '@/components/ui/StickyScroll'
import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import type { PresentedOutLabContract } from '@/lib/out-lab/presenter'

export interface OutLabTableRow extends PresentedOutLabContract {
  used: number
  remaining: number | null
  remainingPercent: number | null
  missingPeriodCount: number
}

function tone(contract: OutLabTableRow) {
  if (contract.effectiveStatus === 'active') return 'success' as const
  if (contract.effectiveStatus === 'cancelled' || contract.effectiveStatus === 'expired') return 'danger' as const
  return 'attention' as const
}

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })

function budgetLabel(contract: OutLabTableRow) {
  // A null ceiling is unknown, not zero. Showing "0" would read as a contract
  // with nothing left, which is the opposite of what it means.
  if (contract.total === null) return 'ไม่ระบุ'
  return `${money.format(contract.used)} / ${money.format(contract.total)}`
}

function MissingPeriodChip({ count }: { count: number }) {
  if (count === 0) return null
  return <StatusChip tone="attention">ค้างลงข้อมูล {count} งวด</StatusChip>
}

export function OutLabTable({ contracts }: { contracts: OutLabTableRow[] }) {
  if (contracts.length === 0) {
    return <p className="empty-state">ยังไม่มีสัญญาในกลุ่มนี้</p>
  }

  return (
    <>
      <StickyScroll className="contract-table--desktop" ariaLabel="ตารางสัญญาส่งตรวจภายนอก เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
        <table className="data-table contract-register-table">
          <thead>
            <tr>
              <th>เลขที่สัญญา</th>
              <th>ชื่อสัญญา</th>
              <th>รูปแบบงบ</th>
              <th>ลงข้อมูล</th>
              <th>สถานะ</th>
              <th>ใช้ไป / งบ</th>
              <th>คงเหลือ</th>
              <th><span className="visually-hidden">เปิดรายละเอียด</span></th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => (
              <tr key={contract.id}>
                <td className="identifier">{contract.contractNumberLabel}</td>
                <td>
                  <Link className="text-link" href={`/out-lab/${contract.id}`}>{contract.displayName}</Link>
                  <small>{contract.vendorLabel} · {contract.departmentLabel}</small>
                  {contract.procurementStageLabel && (
                    <small>ขั้นตอน: {contract.procurementStageLabel}</small>
                  )}
                  <MissingPeriodChip count={contract.missingPeriodCount} />
                </td>
                <td>{contract.kindLabel}</td>
                <td>{contract.cadenceLabel}</td>
                <td><StatusChip tone={tone(contract)}>{contract.statusLabel}</StatusChip></td>
                <td className="numeric-cell identifier">{budgetLabel(contract)}</td>
                <td><ContractRemainingGauge percent={contract.remainingPercent} /></td>
                <td>
                  <div className="detail-actions">
                    <DetailIconLink
                      href={`/out-lab/${contract.id}`}
                      label={`ดูรายละเอียดสัญญา ${contract.displayName}`}
                      title="ดูรายละเอียดสัญญา"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </StickyScroll>

      <ul className="contract-task-cards" aria-label="รายการสัญญา Out Lab">
        {contracts.map((contract) => (
          <li key={contract.id}>
            <div className="task-card__topline">
              <StatusChip tone={tone(contract)}>{contract.statusLabel}</StatusChip>
              <ContractRemainingGauge percent={contract.remainingPercent} />
            </div>
            <div className="contract-task-card__title">
              <Link className="text-link" href={`/out-lab/${contract.id}`}>{contract.displayName}</Link>
            </div>
            <p>{contract.kindLabel} · ลงข้อมูล{contract.cadenceLabel} · {contract.contractNumberLabel}</p>
            <p>{contract.vendorLabel} · {contract.departmentLabel}</p>
            <p className="identifier">{budgetLabel(contract)}</p>
            <MissingPeriodChip count={contract.missingPeriodCount} />
            <div className="detail-actions task-card__action">
              <DetailIconLink
                href={`/out-lab/${contract.id}`}
                label={`ดูรายละเอียดสัญญา ${contract.displayName}`}
                title="ดูรายละเอียดสัญญา"
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
