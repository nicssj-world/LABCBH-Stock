import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArchiveContractControl } from '@/components/contracts/ArchiveContractControl'
import { BudgetPanel } from '@/components/contracts/BudgetPanel'
import { ContractEditDialog } from '@/components/contracts/ContractEditDialog'
import { ExpireContractDialog } from '@/components/contracts/ExpireContractDialog'
import { ResponsibleUserDialog } from '@/components/contracts/ResponsibleUserDialog'
import { StageAdvanceControl } from '@/components/contracts/StageAdvanceControl'
import { StageHistoryDisclosure } from '@/components/contracts/StageHistoryDisclosure'
import { StageTimeline } from '@/components/contracts/StageTimeline'
import { StatusChip } from '@/components/ui/StatusChip'
import { hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { contractMode } from '@/lib/contracts/budget'
import { canRecordContractExpense } from '@/lib/contracts/authorization'
import { fetchResponsibleCandidates } from '@/lib/contracts/budget-queries'
import { presentContract } from '@/lib/contracts/presenter'
import { getContract } from '@/lib/contracts/queries'

interface ContractDetailPageProps {
  params: Promise<{ id: string }>
}

const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 })
const thaiDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' })
const displayDate = (value: string | null) => value
  ? thaiDate.format(new Date(`${value}T00:00:00+07:00`))
  : 'ไม่ระบุ'

export default async function ContractDetailPage({ params }: ContractDetailPageProps) {
  const actor = await requireActor()
  const { id } = await params
  const contractId = Number(id)
  if (!Number.isInteger(contractId) || contractId <= 0) notFound()
  const record = await getContract(contractId)
  if (!record) notFound()
  const contract = presentContract(record)
  const canEdit = hasAppRole(actor, 'admin', 'head')
  const isAdmin = hasAppRole(actor, 'admin')
  const mode = contractMode(contract.contractType ?? 'e_bidding')
  const canRecord = contract.effectiveStatus === 'active' && canRecordContractExpense(actor, contract)
  const responsibleCandidates = mode === 'budget' && isAdmin
    ? await fetchResponsibleCandidates()
    : []
  const isContractStarted = contract.procurementStage === 'contract_started'
  const hasNextAction = canEdit && contract.procurementStage && !isContractStarted
  // A lease carries its value on the contract itself; a supply contract's value
  // is the sum of its lines.
  const total =
    mode === 'budget'
      ? contract.total
      : contract.items.reduce((sum, item) => sum + item.lineTotal, 0)
  const stageHistory = (
    <section className="bench-panel contract-history" aria-labelledby="stage-history-title">
      <div className="bench-panel__header">
        <div>
          <p className="section-kicker">PROCUREMENT TRACK</p>
          <h2 id="stage-history-title">ประวัติขั้นตอนสัญญา</h2>
        </div>
        <p>บันทึกตามวันที่มีผลของแต่ละขั้นตอน</p>
      </div>
      <StageTimeline contract={contract} />
    </section>
  )

  return (
    <div className="route-stack contract-detail-page">
      <header className="contract-detail-heading">
        <div className="contract-detail-heading__top">
          <Link className="contract-detail-back" href="/contracts">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="m14 6-6 6 6 6M8 12h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>รายการสัญญา</span>
          </Link>
          <div className="contract-detail-heading__status">
            <StatusChip tone="info">{contract.procurementStageLabel}</StatusChip>
            <StatusChip tone={contract.effectiveStatus === 'active' ? 'success' : contract.effectiveStatus === 'expired' || contract.effectiveStatus === 'cancelled' ? 'danger' : 'attention'}>{contract.contractStatusLabel}</StatusChip>
            <StatusChip tone="neutral">{contract.contractTypeLabel}</StatusChip>
            {canEdit && (
              <ContractEditDialog contract={record} />
            )}
            {canEdit && isContractStarted && contract.effectiveStatus === 'active' && (
              <ExpireContractDialog contractId={contract.id} />
            )}
            {mode === 'budget' && isAdmin && (
              <ResponsibleUserDialog
                contractId={contract.id}
                candidates={responsibleCandidates}
                selected={contract.responsibleUserIds}
              />
            )}
          </div>
        </div>

        <div className="contract-detail-heading__body">
          <div className="contract-detail-heading__identity">
            <p className="contract-detail-heading__number">
              <span>เลขที่สัญญา</span>
              <strong>{contract.contractNumberLabel}</strong>
            </p>
            <h1>{contract.resolvedDisplayName}</h1>
          </div>
          <dl className="contract-detail-heading__value">
            <dt>มูลค่าสัญญา</dt>
            <dd>{total === null ? 'ไม่ระบุ' : money.format(total)}</dd>
          </dl>
        </div>

        <dl className="contract-facts" aria-label="ข้อมูลสรุปสัญญา">
          <div className="contract-facts__vendor"><dt>คู่สัญญา</dt><dd>{contract.vendor || 'ไม่ระบุ'}</dd></div>
          <div><dt>ปีงบประมาณ</dt><dd className="identifier">{contract.fiscalYear ?? 'ไม่ระบุ'}</dd></div>
          <div><dt>ระยะเวลาสัญญา</dt><dd>{displayDate(contract.startDate)} – {displayDate(contract.endDate)}</dd></div>
        </dl>
      </header>

      <div className={hasNextAction ? 'contract-detail-grid' : 'contract-detail-grid contract-detail-grid--single'}>
        {isContractStarted ? (
          <StageHistoryDisclosure>
            {stageHistory}
          </StageHistoryDisclosure>
        ) : (
          stageHistory
        )}

        {canEdit && contract.procurementStage && !isContractStarted && (
          <aside className="bench-panel next-action" aria-labelledby="next-action-title">
            <div className="bench-panel__header">
              <div>
                <p className="section-kicker">NEXT ACTION</p>
                <h2 id="next-action-title">ดำเนินการขั้นถัดไป</h2>
              </div>
            </div>
            <StageAdvanceControl contractId={contract.id} currentStage={contract.procurementStage} />
          </aside>
        )}
      </div>

      {mode === 'budget' ? (
        <BudgetPanel
          contractId={contract.id}
          contractNumber={contract.contractNumber}
          displayName={contract.resolvedDisplayName}
          total={contract.total}
          startDate={contract.startDate}
          endDate={contract.endDate}
          filePath={contract.fileUrl}
          canRecord={canRecord}
          canEdit={canEdit}
        />
      ) : (
      <section className="bench-panel" aria-labelledby="contract-lines-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">CONTRACT LINES</p>
            <h2 id="contract-lines-title">รายการน้ำยาในสัญญา</h2>
          </div>
          <p>{contract.items.length} รายการ · {total === null ? 'ไม่ระบุ' : money.format(total)}</p>
        </div>
        {contract.items.length === 0 ? <p className="empty-state">ยังไม่มีรายการน้ำยา</p> : (
          <div className="detail-items-table">
            <table className="data-table">
              <thead><tr><th>รหัส LS</th><th>ชื่อน้ำยา</th><th className="numeric-cell">จำนวน</th><th>หน่วย</th><th className="numeric-cell">ราคาต่อหน่วย</th><th className="numeric-cell">รวม</th></tr></thead>
              <tbody>
                {contract.items.map((item) => (
                  <tr key={item.id}>
                    <td className="identifier">{item.lsCode}</td>
                    <td>{item.name}</td>
                    <td className="numeric-cell identifier">{item.quantity.toLocaleString('th-TH')}</td>
                    <td>{item.unit}</td>
                    <td className="numeric-cell identifier">{money.format(item.unitPrice)}</td>
                    <td className="numeric-cell identifier"><strong>{money.format(item.lineTotal)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      )}

      {canEdit && <ArchiveContractControl contractId={contract.id} />}
    </div>
  )
}
