import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArchiveContractControl } from '@/components/contracts/ArchiveContractControl'
import { BudgetPanel } from '@/components/contracts/BudgetPanel'
import { ContractEditDialog } from '@/components/contracts/ContractEditDialog'
import { ContractCommitteeRoster } from '@/components/contracts/ContractCommitteeRoster'
import { ContractFileCard } from '@/components/contracts/ContractFileCard'
import { ContractOpeningBalanceHistory } from '@/components/contracts/ContractOpeningBalanceHistory'
import { ContractPurchaseHistory } from '@/components/contracts/ContractPurchaseHistory'
import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import { ExpireContractDialog } from '@/components/contracts/ExpireContractDialog'
import { OpeningBalanceDialog } from '@/components/contracts/OpeningBalanceDialog'
import { ResponsibleUserDialog } from '@/components/contracts/ResponsibleUserDialog'
import { RestoreContractControl } from '@/components/contracts/RestoreContractControl'
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
import { getContract, listContractOpeningBalanceHistory } from '@/lib/contracts/queries'
import { listInventoryCatalog } from '@/lib/inventory/queries'
import { listContractPurchaseHistory } from '@/lib/pr/queries'
import {
  getContractCommitteeRoster,
  listContractCommitteeCandidates,
} from '@/lib/contracts/committee-queries'

interface ContractDetailPageProps {
  params: Promise<{ id: string }>
}

const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 })
const quantity = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 })
const thaiDate = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  dateStyle: 'medium',
  timeZone: 'Asia/Bangkok',
})
const displayDate = (value: string | null) => value
  ? thaiDate.format(new Date(`${value}T00:00:00+07:00`))
  : 'ไม่ระบุ'

export default async function ContractDetailPage({ params }: ContractDetailPageProps) {
  const [actor, { id }] = await Promise.all([requireActor(), params])
  const contractId = Number(id)
  if (!Number.isInteger(contractId) || contractId <= 0) notFound()
  const isAdmin = hasAppRole(actor, 'admin')

  // The candidate list depends on the actor alone, so it is read alongside the
  // contract instead of waiting behind it. Settling it into a result rather
  // than holding a bare promise matters: notFound() below can leave this
  // unawaited, and a bare rejection would then surface as an unhandled one.
  const responsibleCandidatesSettled = isAdmin
    ? fetchResponsibleCandidates().then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
    : null

  // Only an admin can even see that an archived contract exists, since
  // archiving is meant for mistaken/duplicate records; anyone else hitting
  // the id of one gets the same not-found as before.
  const record = await getContract(contractId, { includeArchived: isAdmin })
  if (!record) notFound()
  const contract = presentContract(record)
  const canEdit = hasAppRole(actor, 'admin', 'head') && !record.isArchived
  const canManageStageHistory = canOperateStock(actor)
  const canManageCommitteeRoster = canOperateStock(actor) && !record.isArchived
  const mode = contractMode(contract.contractType ?? 'e_bidding')
  const canRecord = contract.effectiveStatus === 'active' && canRecordContractExpense(actor, contract)
  const isContractStarted = contract.procurementStage === 'contract_started'
  const isStartedSupplyContract = mode === 'supply' && isContractStarted
  const openingBalanceHistoryPromise = isStartedSupplyContract
    ? listContractOpeningBalanceHistory(contract.id)
        .then((history) => ({ history, error: null as string | null }))
        .catch((error) => {
          console.error(`listContractOpeningBalanceHistory failed for contract ${contract.id}`, error)
          return {
            history: [] as Awaited<ReturnType<typeof listContractOpeningBalanceHistory>>,
            error: 'ไม่สามารถโหลดประวัติยอดใช้ก่อนเข้าระบบได้ กรุณาลองใหม่อีกครั้ง',
          }
        })
    : Promise.resolve({
        history: [] as Awaited<ReturnType<typeof listContractOpeningBalanceHistory>>,
        error: null as string | null,
      })

  // What each of these reads needs — the contract's mode and stage — is known
  // by now, so they overlap on the wire instead of queueing. A started supply
  // contract used to pay for all four one after another.
  const [responsibleCandidates, purchaseHistory, openingBalanceResult, editCatalog, committeeRoster, committeeCandidates] =
    await Promise.all([
      mode === 'budget' && responsibleCandidatesSettled
        ? responsibleCandidatesSettled.then((settled) =>
            'error' in settled ? Promise.reject(settled.error) : settled.value,
          )
        : [],
      // A lease never uses the "ซื้อในสัญญา" PR method, and a contract that
      // hasn't started yet cannot have been purchased against.
      isStartedSupplyContract ? listContractPurchaseHistory(contract.id) : [],
      // Supplementary display only — a failure here (e.g. a transient DB
      // error) must not take down the whole contract page. Keep the failure
      // visible so an empty array is not mistaken for "no history".
      openingBalanceHistoryPromise,
      // A lease has no line items, so the edit dialog's catalog lookup is only
      // needed for editors of a supply contract.
      canEdit && mode !== 'budget' ? listInventoryCatalog() : [],
      getContractCommitteeRoster(contract.id),
      canManageCommitteeRoster ? listContractCommitteeCandidates() : [],
    ])
  const openingBalanceHistory = openingBalanceResult.history
  const openingBalanceHistoryError = openingBalanceResult.error
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
      <StageTimeline
        contract={contract}
        canManageStageHistory={canManageStageHistory}
        stageHistoryEditorContractId={contract.id}
      />
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
              <strong className="contract-number-token">{contract.contractNumberLabel}</strong>
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
            <StageAdvanceControl
              contractId={contract.id}
              currentStage={contract.procurementStage}
              contractType={contract.contractType}
              total={contract.total}
            />
          </aside>
        )}
      </div>

      <ContractCommitteeRoster
        contractId={contract.id}
        contractType={contract.contractType}
        members={committeeRoster}
        candidates={committeeCandidates}
        canEdit={canManageCommitteeRoster}
      />

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
          {isAdmin && isContractStarted && !record.isArchived && (
            <OpeningBalanceDialog contractId={contract.id} items={contract.items} />
          )}
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
                      {item.openingUsedQuantity > 0 && (
                        <small>ใช้ก่อนเข้าระบบ {quantity.format(item.openingUsedQuantity)}</small>
                      )}
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

      {isContractStarted && (openingBalanceHistoryError || openingBalanceHistory.length > 0) && (
        <section className="bench-panel" aria-labelledby="contract-opening-balance-history-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">OPENING BALANCE</p>
              <h2 id="contract-opening-balance-history-title">ประวัติยอดใช้ก่อนเข้าระบบ</h2>
            </div>
          <p>{openingBalanceHistoryError ? 'โหลดไม่สำเร็จ' : `${openingBalanceHistory.length} ครั้ง`}</p>
          </div>
          {openingBalanceHistoryError ? (
            <p className="inline-alert" role="alert">
              {openingBalanceHistoryError}{' '}
              <Link className="text-link" href={`/contracts/${contract.id}?retry=opening-balance`}>ลองโหลดอีกครั้ง</Link>
            </p>
          ) : (
            <ContractOpeningBalanceHistory entries={openingBalanceHistory} />
          )}
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

      {isAdmin && (
        record.isArchived
          ? (
            <section className="bench-panel archive-zone" aria-labelledby="restore-contract-title">
              <div className="archive-control__copy">
                <p className="archive-control__eyebrow">ADMIN CLEANUP</p>
                <h2 id="restore-contract-title">สัญญานี้ถูกลบออกจากรายการใช้งาน</h2>
                <p>{record.archiveReason ? `เหตุผลที่ลบ: ${record.archiveReason}` : 'ไม่ระบุเหตุผลที่ลบ'}</p>
              </div>
              <RestoreContractControl contractId={contract.id} />
            </section>
          )
          : <ArchiveContractControl contractId={contract.id} />
      )}
    </div>
  )
}
