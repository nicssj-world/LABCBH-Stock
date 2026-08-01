import Link from 'next/link'
import { StatusChip } from '@/components/ui/StatusChip'
import { contractListValue, type PresentedContract } from '@/lib/contracts/presenter'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

function tone(contract: PresentedContract) {
  if (contract.effectiveStatus === 'active') return 'success' as const
  if (contract.effectiveStatus === 'cancelled' || contract.effectiveStatus === 'expired') return 'danger' as const
  return 'attention' as const
}

function formatContractValue(contract: PresentedContract) {
  const value = contractListValue(contract)
  return value === null ? 'ไม่ระบุ' : money.format(value)
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
              <th>ขั้นตอนจัดซื้อ</th>
              <th>สถานะสัญญา</th>
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
                  <small>{contract.vendor || 'ไม่ระบุคู่สัญญา'}</small>
                </td>
                <td>{contract.contractTypeLabel}</td>
                <td><StatusChip tone="info">{contract.procurementStageLabel}</StatusChip></td>
                <td>
                  <div className="contract-table__status-stack">
                    <StatusChip tone={tone(contract)}>{contract.contractStatusLabel}</StatusChip>
                    {contract.expiryNotice && <StatusChip tone={contract.expiryNotice.tone}>{contract.expiryNotice.label}</StatusChip>}
                  </div>
                </td>
                <td className="identifier">{contract.contractNumberLabel}</td>
                <td className="numeric-cell identifier">{formatContractValue(contract)}</td>
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
              <div className="contract-table__status-stack">
                <StatusChip tone={tone(contract)}>{contract.contractStatusLabel}</StatusChip>
                {contract.expiryNotice && <StatusChip tone={contract.expiryNotice.tone}>{contract.expiryNotice.label}</StatusChip>}
              </div>
              <span className="identifier">{formatContractValue(contract)}</span>
            </div>
            <h3>{contract.resolvedDisplayName}</h3>
            <p>{contract.contractTypeLabel} · {contract.procurementStageLabel} · {contract.contractNumberLabel}</p>
            <Link className="text-link task-card__action" href={`/contracts/${contract.id}`}>ดูรายละเอียดสัญญา</Link>
          </li>
        ))}
      </ul>
    </>
  )
}
