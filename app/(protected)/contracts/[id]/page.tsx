import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArchiveContractControl } from '@/components/contracts/ArchiveContractControl'
import { BudgetPanel } from '@/components/contracts/BudgetPanel'
import { ContractEditDialog } from '@/components/contracts/ContractEditDialog'
import { ContractFileCard } from '@/components/contracts/ContractFileCard'
import { ContractPurchaseHistory } from '@/components/contracts/ContractPurchaseHistory'
import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import { ExpireContractDialog } from '@/components/contracts/ExpireContractDialog'
import { ResponsibleUserDialog } from '@/components/contracts/ResponsibleUserDialog'
import { StageAdvanceControl } from '@/components/contracts/StageAdvanceControl'
import { StageHistoryDisclosure } from '@/components/contracts/StageHistoryDisclosure'
import { StageTimeline } from '@/components/contracts/StageTimeline'
import { StatusChip } from '@/components/ui/StatusChip'
import { canOperateStock, hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { contractMode } from '@/lib/contracts/budget'
import { canRecordContractExpense } from '@/lib/contracts/authorization'
import { fetchResponsibleCandidates } from '@/lib/contracts/budget-queries'
import { presentContract } from '@/lib/contracts/presenter'
import { getContract } from '@/lib/contracts/queries'
import { listInventoryItems } from '@/lib/inventory/queries'
import { listContractPurchaseHistory } from '@/lib/pr/queries'

interface ContractDetailPageProps {
  params: Promise<{ id: string }>
}

const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 })
const quantity = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 })
const thaiDate = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { dateStyle: 'medium' })
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
  const canManageStageHistory = canOperateStock(actor)
  const mode = contractMode(contract.contractType ?? 'e_bidding')
  const canRecord = contract.effectiveStatus === 'active' && canRecordContractExpense(actor, contract)
  const responsibleCandidates = mode === 'budget' && isAdmin
    ? await fetchResponsibleCandidates()
    : []
  const isContractStarted = contract.procurementStage === 'contract_started'
  // A lease never uses the "ซื้อในสัญญา" PR method, and a contract that hasn't
  // started yet cannot have been purchased against.
  const purchaseHistory = mode === 'supply' && isContractStarted
    ? await listContractPurchaseHistory(contract.id)
    : []
  // A lease has no line items, so the edit dialog's catalog lookup is only
  // needed for editors of a supply contract.
  const editCatalog = canEdit && mode !== 'budget' ? await listInventoryItems({}) : []
  const hasNextAction = canEdit && contract.procurementStage && !isContractStarted
  // A lease carries its value on the contract itself; a supply contract's value
  // is the sum of its lines.
  const total =
    mode === 'budget'
      ? contract.total
      : contract.items.reduce((sum, item) => sum + item.lineTotal, 0)
  const remainingTotal = mode === 'supply'
    ? contract.items.reduce((sum, item) => sum + item.remainingValue, 0)
    : null
  const stageHistory = (
    <section className="bench-panel contract-history" aria-labelledby="stage-history-title">
      <div className="bench-panel__header">
        <div>
          <p className="section-kicker">PROCUREMENT TRACK</p>
          <h2 id="stage-history-title">ประวัติขั้นตอนสัญญา</h2>
        </div>
        <p>บันทึกตามวันที่มีผลของแต่ละขั้นตอน</p>
      </div>
      <StageTimeline contract={contract} canManageStageHistory={canManageStageHistory} />
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
              <ContractEditDialog
                contract={record}
                catalog={editCatalog.map((item) => ({
                  id: item.id,
                  lsCode: item.lsCode,
                  name: item.name,
                  unit: item.baseUnit,
                }))}
              />
            )}
            {isAdmin && isContractStarted && contract.effectiveStatus === 'active' && (
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
            {mode === 'supply' && remainingTotal !== null && (
              <>
                <dt className="contract-detail-heading__remaining-label">ยอดคงเหลือรวม</dt>
                <dd className="contract-detail-heading__remaining-value">
                  <span>{money.format(remainingTotal)}</span>
                  <ContractRemainingGauge percent={contract.remainingPercent} />
                </dd>
              </>
            )}
          </dl>
        </div>

        <dl className="contract-facts contract-facts--vendor-split-with-value" aria-label="ข้อมูลสรุปสัญญา">
          <div className="contract-facts__vendor"><dt>คู่สัญญา</dt><dd>{contract.vendor || 'ไม่ระบุ'}</dd></div>
          <div><dt>ปีงบประมาณ</dt><dd className="identifier">{contract.fiscalYear ?? 'ไม่ระบุ'}</dd></div>
          <div><dt>หน่วยงาน</dt><dd>{contract.department || 'ไม่ระบุ'}</dd></div>
          <div className="contract-facts__period">
            <dt>ระยะเวลาสัญญา</dt>
            <dd>
              <span>{displayDate(contract.startDate)} – {displayDate(contract.endDate)}</span>
              {contract.expiryNotice && (
                <span className={`contract-expiry-chip contract-expiry-chip--${contract.expiryNotice.tone}`} role="status" aria-label={`${contract.expiryNotice.label}: ${contract.expiryNotice.description}`}>
                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                    <path d="M12 7v5l3 2M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {contract.expiryNotice.label}
                </span>
              )}
            </dd>
          </div>
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
      <>
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
              <thead><tr><th>รหัสพัสดุ</th><th>ชื่อน้ำยา</th><th className="numeric-cell">จำนวน</th><th className="numeric-cell">คงเหลือ</th><th>หน่วย</th><th className="numeric-cell">ราคาต่อหน่วย</th><th className="numeric-cell">รวม</th></tr></thead>
              <tbody>
                {contract.items.map((item) => (
                  <tr key={item.id}>
                    <td className="identifier">{item.lsCode}</td>
                    <td>{item.name}</td>
                    <td className="numeric-cell identifier">{quantity.format(item.quantity)}</td>
                    <td className="numeric-cell identifier contract-line-balance">
                      <strong>{quantity.format(item.remainingQuantity)}</strong>
                      <small>มูลค่า {money.format(item.remainingValue)}</small>
                      <small>ใช้ไป {quantity.format(item.allocatedQuantity)}</small>
                      <div
                        className={`contract-line-balance__track contract-line-balance__track--${item.remainingPercent < 30 ? 'danger' : 'ok'}`}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(item.remainingPercent)}
                        aria-label={`ยอดคงเหลือของ ${item.name} ${quantity.format(item.remainingPercent)}%`}
                      >
                        <span style={{ width: `${item.remainingPercent}%` }} />
                      </div>
                      <small>{quantity.format(item.remainingPercent)}% เหลือ</small>
                    </td>
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

      {isContractStarted && (
        <section className="bench-panel" aria-labelledby="contract-purchase-history-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">PURCHASE HISTORY</p>
              <h2 id="contract-purchase-history-title">ประวัติการซื้อ</h2>
            </div>
            <p>{purchaseHistory.length} ครั้ง</p>
          </div>
          <ContractPurchaseHistory entries={purchaseHistory} />
        </section>
      )}

      <section className="bench-panel contract-file-panel" aria-labelledby="contract-file-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">CONTRACT DOCUMENT</p>
            <h2 id="contract-file-title">ไฟล์สัญญา</h2>
          </div>
        </div>
        <ContractFileCard contractId={contract.id} filePath={contract.fileUrl} canEdit={canEdit} />
      </section>
      </>
      )}

      {isAdmin && <ArchiveContractControl contractId={contract.id} />}
    </div>
  )
}
