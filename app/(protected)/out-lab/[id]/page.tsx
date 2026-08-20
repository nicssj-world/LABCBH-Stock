import Link from 'next/link'
import { notFound } from 'next/navigation'
import { StageHistoryDisclosure } from '@/components/contracts/StageHistoryDisclosure'
import { StageTimeline } from '@/components/contracts/StageTimeline'
import { OutLabBudgetPanel } from '@/components/out-lab/OutLabBudgetPanel'
import { OutLabFileCard } from '@/components/out-lab/OutLabFileCard'
import {
  ArchiveOutLabControl,
  ExpireOutLabControl,
  RestoreOutLabControl,
} from '@/components/out-lab/OutLabLifecycleControls'
import { OutLabResponsibleDialog } from '@/components/out-lab/OutLabResponsibleDialog'
import { OutLabStageAdvanceControl } from '@/components/out-lab/OutLabStageAdvanceControl'
import { StatusChip } from '@/components/ui/StatusChip'
import { hasAppRole } from '@/lib/auth/access'
import { requireActor } from '@/lib/auth/actor'
import { fetchResponsibleCandidates } from '@/lib/contracts/budget-queries'
import { canRecordOutLabUsage } from '@/lib/out-lab/authorization'
import { fiscalYearBounds } from '@/lib/out-lab/fiscal'
import { OUT_LAB_CONTRACT_TYPE_LABEL, presentOutLabContract } from '@/lib/out-lab/presenter'
import { getOutLabContract } from '@/lib/out-lab/queries'

interface OutLabDetailPageProps {
  params: Promise<{ id: string }>
}

const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', minimumFractionDigits: 2 })
const thaiDate = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  dateStyle: 'medium',
  timeZone: 'Asia/Bangkok',
})
const displayDate = (value: string) => thaiDate.format(new Date(`${value}T00:00:00+07:00`))

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function OutLabDetailPage({ params }: OutLabDetailPageProps) {
  const [actor, { id }] = await Promise.all([requireActor(), params])
  if (!UUID.test(id)) notFound()
  const isAdmin = hasAppRole(actor, 'admin')

  // The candidate list depends on the actor alone, so it is read alongside the
  // contract instead of waiting behind it. It is settled rather than left as a
  // bare promise: notFound() below can leave it unawaited, and a bare rejection
  // would then surface as an unhandled one.
  const candidatesSettled = isAdmin
    ? fetchResponsibleCandidates().then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      )
    : null

  // Only an admin can see that an archived row exists — archiving is meant for
  // mistaken or duplicate records; anyone else hitting its id gets not-found.
  const record = await getOutLabContract(id, { includeArchived: isAdmin })
  if (!record) notFound()

  const contract = presentOutLabContract(record)
  const canEdit = hasAppRole(actor, 'admin', 'head') && !record.isArchived
  const canRecord =
    !record.isArchived &&
    contract.effectiveStatus === 'active' &&
    canRecordOutLabUsage(actor, record)
  const isPlan = record.kind === 'annual_plan'
  const isContractStarted = record.procurementStage === 'contract_started'
  const hasNextAction = canEdit && !isPlan && record.procurementStage !== null && !isContractStarted
  const planPeriod = isPlan ? fiscalYearBounds(record.fiscalYear) : null

  const responsibleCandidates = candidatesSettled
    ? await candidatesSettled.then((settled) =>
        'error' in settled ? Promise.reject(settled.error) : settled.value,
      )
    : []

  // An annual plan is a budget line that already exists — it is never procured
  // through this register, so there is no timeline to show at all.
  const stageHistory = isPlan ? null : (
    <section className="bench-panel contract-history" aria-labelledby="out-lab-stage-history-title">
      <div className="bench-panel__header">
        <div>
          <p className="section-kicker">PROCUREMENT TRACK</p>
          <h2 id="out-lab-stage-history-title">ประวัติขั้นตอนสัญญา</h2>
        </div>
        <p>บันทึกตามวันที่มีผลของแต่ละขั้นตอน</p>
      </div>
      <StageTimeline contract={record} />
    </section>
  )

  return (
    <div className="route-stack contract-detail-page">
      <header className="contract-detail-heading">
        <div className="contract-detail-heading__top">
          <Link className="contract-detail-back" href="/out-lab">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="m14 6-6 6 6 6M8 12h10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span>ทะเบียน Out Lab</span>
          </Link>
          <div className="contract-detail-heading__status">
            {contract.procurementStageLabel && <StatusChip tone="info">{contract.procurementStageLabel}</StatusChip>}
            <StatusChip
              tone={
                contract.effectiveStatus === 'active'
                  ? 'success'
                  : contract.effectiveStatus === 'expired' || contract.effectiveStatus === 'cancelled'
                    ? 'danger'
                    : 'attention'
              }
            >
              {contract.statusLabel}
            </StatusChip>
            <StatusChip tone="neutral">{contract.kindLabel}</StatusChip>
            {record.isArchived && <StatusChip tone="danger">ถูกลบออกจากทะเบียน</StatusChip>}
            {canEdit && (
              <Link className="lab-link-button lab-link-button--secondary" href={`/out-lab/${record.id}/edit`}>
                แก้ไขสัญญา
              </Link>
            )}
            {isAdmin && !record.isArchived && contract.effectiveStatus === 'active' && (isPlan || isContractStarted) && (
              <ExpireOutLabControl contractId={record.id} />
            )}
            {isAdmin && !record.isArchived && (
              <OutLabResponsibleDialog
                contractId={record.id}
                candidates={responsibleCandidates}
                selected={record.responsibleUserIds}
              />
            )}
            {isAdmin && !record.isArchived && <ArchiveOutLabControl contractId={record.id} />}
          </div>
        </div>

        <div className="contract-detail-heading__body">
          <div className="contract-detail-heading__identity">
            <p className="contract-detail-heading__number">
              <span>เลขที่สัญญา</span>
              <strong>{contract.contractNumberLabel}</strong>
            </p>
            <h1>{record.displayName}</h1>
          </div>
          <dl className="contract-detail-heading__value">
            <dt>{isPlan ? 'งบตามแผน' : 'มูลค่าสัญญา'}</dt>
            {/* An unstated ceiling is unknown, not zero, so it never draws as a figure. */}
            <dd>{record.total === null ? 'ไม่ระบุ' : money.format(record.total)}</dd>
          </dl>
        </div>

        <dl className="contract-facts contract-facts--vendor-split-with-value" aria-label="ข้อมูลสรุปสัญญา">
          <div className="contract-facts__vendor"><dt>คู่สัญญา</dt><dd>{contract.vendorLabel}</dd></div>
          <div><dt>ปีงบประมาณ</dt><dd className="identifier">{record.fiscalYear}</dd></div>
          <div><dt>หน่วยงาน</dt><dd>{contract.departmentLabel}</dd></div>
          <div><dt>ประเภทสัญญา</dt><dd>{OUT_LAB_CONTRACT_TYPE_LABEL}</dd></div>
          <div><dt>งวดลงข้อมูล</dt><dd>{contract.cadenceLabel}</dd></div>
          <div className="contract-facts__period">
            <dt>ระยะเวลา{isPlan ? 'ตามปีงบประมาณ' : 'สัญญา'}</dt>
            <dd>
              <span>{displayDate(record.startDate)} – {displayDate(record.endDate)}</span>
              {planPeriod && <small>คิดจากปีงบประมาณ {record.fiscalYear} โดยอัตโนมัติ</small>}
              {contract.expiryNotice && (
                <span
                  className={`contract-expiry-chip contract-expiry-chip--${contract.expiryNotice.tone}`}
                  role="status"
                  aria-label={`${contract.expiryNotice.label}: ${contract.expiryNotice.description}`}
                >
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

      {record.isArchived && (
        <section className="bench-panel" aria-labelledby="out-lab-archived-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">ARCHIVED</p>
              <h2 id="out-lab-archived-title">สัญญานี้ถูกลบออกจากทะเบียน</h2>
            </div>
          </div>
          <p>{record.archiveReason ?? 'ไม่ได้ระบุเหตุผล'}</p>
          {isAdmin && <RestoreOutLabControl contractId={record.id} />}
        </section>
      )}

      {stageHistory && (
        <div className={hasNextAction ? 'contract-detail-grid' : 'contract-detail-grid contract-detail-grid--single'}>
          {/* Once a contract has started, its six-stage history is settled
              history rather than a live workflow, so it collapses out of the way. */}
          {isContractStarted ? <StageHistoryDisclosure>{stageHistory}</StageHistoryDisclosure> : stageHistory}

          {hasNextAction && record.procurementStage && (
            <aside className="bench-panel next-action" aria-labelledby="out-lab-next-action-title">
              <div className="bench-panel__header">
                <div>
                  <p className="section-kicker">NEXT ACTION</p>
                  <h2 id="out-lab-next-action-title">ขั้นตอนถัดไป</h2>
                </div>
              </div>
              <OutLabStageAdvanceControl contractId={record.id} currentStage={record.procurementStage} />
            </aside>
          )}
        </div>
      )}

      {record.note && (
        <section className="bench-panel" aria-labelledby="out-lab-note-title">
          <div className="bench-panel__header">
            <div>
              <p className="section-kicker">NOTE</p>
              <h2 id="out-lab-note-title">หมายเหตุ</h2>
            </div>
          </div>
          <p>{record.note}</p>
        </section>
      )}

      <OutLabBudgetPanel contract={record} canRecord={canRecord} />

      <section className="bench-panel contract-file-panel" aria-labelledby="out-lab-file-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">CONTRACT DOCUMENT</p>
            <h2 id="out-lab-file-title">ไฟล์สัญญา</h2>
          </div>
        </div>
        <OutLabFileCard contractId={record.id} filePath={record.fileUrl} canEdit={canEdit} />
      </section>
    </div>
  )
}
