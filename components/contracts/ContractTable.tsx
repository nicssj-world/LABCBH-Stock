import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import type { PresentedContract } from '@/lib/contracts/presenter'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

function totalValue(contract: PresentedContract) {
  return contract.items.reduce((sum, item) => sum + item.lineTotal, 0)
}

function tone(contract: PresentedContract) {
  if (contract.status === 'active') return 'success' as const
  if (contract.status === 'cancelled' || contract.status === 'expired') return 'danger' as const
  return 'attention' as const
}

export function ContractTable({ contracts }: { contracts: PresentedContract[] }) {
  if (contracts.length === 0) {
    return <p className="empty-state">ยังไม่มีสัญญาในกลุ่มนี้</p>
  }

  return (
    <>
      <div className="contract-table--desktop">
        <table className="data-table">
          <thead>
            <tr>
              <th>ชื่อสัญญา</th>
              <th>ประเภท</th>
              <th>ขั้นตอนปัจจุบัน</th>
              <th>เลขที่สัญญา</th>
              <th className="numeric-cell">มูลค่า</th>
              <th><span className="visually-hidden">เปิดรายละเอียด</span></th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => (
              <tr key={contract.id}>
                <td>
                  <strong>{contract.resolvedDisplayName}</strong>
                  <small>{contract.vendor || 'ไม่ระบุคู่สัญญา'} · {contract.items.length} รายการ</small>
                </td>
                <td>{contract.contractTypeLabel}</td>
                <td><StatusChip tone={tone(contract)}>{contract.procurementStageLabel}</StatusChip></td>
                <td className="identifier">{contract.contractNumberLabel}</td>
                <td className="numeric-cell identifier">{money.format(totalValue(contract))}</td>
                <td><Link className="text-link" href={`/contracts/${contract.id}`}>ดูรายละเอียด</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="contract-task-cards" aria-label="รายการสัญญา">
        {contracts.map((contract) => (
          <li key={contract.id}>
            <div className="task-card__topline">
              <StatusChip tone={tone(contract)}>{contract.procurementStageLabel}</StatusChip>
              <span className="identifier">{money.format(totalValue(contract))}</span>
            </div>
            <h3>{contract.resolvedDisplayName}</h3>
            <p>{contract.contractTypeLabel} · {contract.contractNumberLabel}</p>
            <Link className="text-link task-card__action" href={`/contracts/${contract.id}`}>ดูรายละเอียดสัญญา</Link>
          </li>
        ))}
      </ul>
    </>
  )
}
