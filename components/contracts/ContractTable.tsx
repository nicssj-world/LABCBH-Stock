import { ContractItemsDisclosure } from '@/components/contracts/ContractItemsDisclosure'
import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import { ContractSummaryDialog } from '@/components/contracts/ContractSummaryDialog'
import { StageProgress } from '@/components/contracts/StageProgress'
import { DetailIconLink } from '@/components/ui/DetailIconLink'
import { StatusChip } from '@/components/ui/StatusChip'
import type { PresentedContract } from '@/lib/contracts/presenter'

function tone(contract: PresentedContract) {
  if (contract.effectiveStatus === 'active') return 'success' as const
  if (contract.effectiveStatus === 'cancelled' || contract.effectiveStatus === 'expired') return 'danger' as const
  return 'attention' as const
}

export function ContractTable({ contracts }: { contracts: PresentedContract[] }) {
  if (contracts.length === 0) {
    return <p className="empty-state">ยังไม่มีสัญญาในกลุ่มนี้</p>
  }

  return (
    <>
      <div className="contract-table--desktop">
        <table className="data-table contract-register-table">
          <colgroup>
            <col className="contract-register-table__number" />
            <col className="contract-register-table__name" />
            <col className="contract-register-table__type" />
            <col className="contract-register-table__stage" />
            <col className="contract-register-table__status" />
            <col className="contract-register-table__remaining" />
            <col className="contract-register-table__action" />
          </colgroup>
          <thead>
            <tr>
              <th>เลขที่สัญญา</th>
              <th>ชื่อสัญญา</th>
              <th className="contract-register-table__cell--center">ประเภท</th>
              <th className="contract-register-table__cell--center">ขั้นตอนจัดซื้อ</th>
              <th className="contract-register-table__cell--center">สถานะสัญญา</th>
              <th>คงเหลือ</th>
              <th className="contract-register-table__cell--center"><span className="visually-hidden">เปิดรายละเอียด</span></th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((contract) => (
              <tr key={contract.id}>
                <td className="identifier">
                  <span className="contract-number-token">{contract.contractNumberLabel}</span>
                </td>
                <td>
                  <ContractSummaryDialog contract={contract} />
                  <small>{contract.vendor || 'ไม่ระบุคู่สัญญา'} · {contract.department || 'ไม่ระบุหน่วยงาน'}</small>
                  {contract.expiryNotice && (
                    <span className={`contract-renewal-hint contract-renewal-hint--${contract.expiryNotice.tone}`} role="status">
                      <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                        <path d="M12 7v5l3 2M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      {contract.expiryNotice.label}
                    </span>
                  )}
                  {contract.contractType !== 'equipment_lease' && <ContractItemsDisclosure items={contract.items} />}
                </td>
                <td className="contract-register-table__cell--center">{contract.contractTypeLabel}</td>
                <td className="contract-register-table__cell--center"><StageProgress stage={contract.procurementStage} label={contract.procurementStageLabel} /></td>
                <td className="contract-register-table__cell--center"><StatusChip tone={tone(contract)}>{contract.contractStatusLabel}</StatusChip></td>
                <td><ContractRemainingGauge percent={contract.remainingPercent} /></td>
                <td className="contract-register-table__cell--center">
                  <div className="detail-actions">
                    <DetailIconLink
                      href={`/contracts/${contract.id}`}
                      label={`ดูรายละเอียดสัญญา ${contract.contractNumberLabel}`}
                      title="ดูรายละเอียดสัญญา"
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="contract-task-cards" aria-label="รายการสัญญา">
        {contracts.map((contract) => (
          <li key={contract.id}>
            <div className="task-card__topline">
              <StatusChip tone={tone(contract)}>{contract.contractStatusLabel}</StatusChip>
              <ContractRemainingGauge percent={contract.remainingPercent} />
            </div>
            <div className="contract-task-card__title"><ContractSummaryDialog contract={contract} variant="card" /></div>
            <p>{contract.contractTypeLabel} · {contract.procurementStageLabel} · {contract.contractNumberLabel}</p>
            <p>{contract.department || 'ไม่ระบุหน่วยงาน'}</p>
            {contract.contractType !== 'equipment_lease' && <ContractItemsDisclosure items={contract.items} />}
            {contract.expiryNotice && (
              <p className={`contract-renewal-hint contract-renewal-hint--${contract.expiryNotice.tone}`} role="status">
                <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                  <path d="M12 7v5l3 2M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {contract.expiryNotice.label}
              </p>
            )}
            <div className="detail-actions task-card__action">
              <DetailIconLink
                href={`/contracts/${contract.id}`}
                label={`ดูรายละเอียดสัญญา ${contract.contractNumberLabel}`}
                title="ดูรายละเอียดสัญญา"
              />
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}
