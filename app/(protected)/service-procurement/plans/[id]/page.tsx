import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ServicePlanExpenseControls } from '@/components/service-procurement/ServicePlanExpenseControls'
import { ServicePlanContractUpload } from '@/components/service-procurement/ServicePlanContractUpload'
import { requireActor } from '@/lib/auth/actor'
import { canManageServicePlans } from '@/lib/service-procurement/authorization'
import { getServicePlan } from '@/lib/service-procurement/queries'
import { fiscalYearRange } from '@/lib/service-procurement/domain'
import { formatThaiDateLong } from '@/lib/date/thai'
import { formatBaht, servicePlanTypeLabel, serviceRequestDisplayStatus, serviceRequestDisplayStatusLabel } from '@/lib/service-procurement/presenter'

const planStatusLabels = { active: 'ใช้งานอยู่', closing: 'อยู่ระหว่างปิดแผน', closed: 'ปิดแผนแล้ว' } as const

export default async function ServicePlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor(); const { id } = await params; const result = await getServicePlan(id)
  if (!result) notFound()
  const { plan, requests, ledger } = result
  const canManage = canManageServicePlans(actor) && plan.status === 'active'
  const actualLedger = ledger.filter((entry) => entry.entryKind === 'expense')
  const committed = plan.balance.spent + plan.balance.reserved
  const percent = plan.budget > 0 ? Math.min(100, Math.max(0, Math.round((committed / plan.budget) * 100))) : 0
  const fiscal = fiscalYearRange(plan.fiscalYear)
  const balanceClassName = plan.balance.available < 0
    ? 'service-plan-overview__balance is-danger'
    : 'service-plan-overview__balance'
  const statusTone = plan.status === 'closing'
    ? 'service-plan-overview__status--attention'
    : plan.status === 'closed'
      ? 'service-plan-overview__status--closed'
      : ''

  return <div className="route-stack service-plan-detail-page">
    <header className="page-heading page-heading--actions service-plan-detail__heading">
      <div className="service-plan-detail__heading-copy">
        <Link className="back-link service-plan-detail__back" href="/service-procurement/plans">← แผนงานจ้าง</Link>
        <p className="section-kicker">SERVICE PLAN · FY {plan.fiscalYear}</p>
        <h1>{plan.name}</h1>
        <p className="service-plan-detail__meta">
          <span>{plan.department}</span>
          <span aria-hidden="true">·</span>
          <span>{servicePlanTypeLabel(plan.type)}</span>
        </p>
      </div>
      <div className="page-heading__actions service-plan-detail__actions" aria-label="การทำงานกับแผน">
        <span className="status-chip status-chip--service">{planStatusLabels[plan.status]}</span>
        {plan.isRedCross && <span className="status-chip status-chip--attention">สภากาชาดไทย</span>}
        {plan.requiresContract && <span className="status-chip status-chip--service">ทำสัญญา</span>}
        {canManage && <Link className="lab-link-button lab-link-button--secondary" href={`/service-procurement/plans/${plan.id}/edit`}>แก้ไขข้อมูล</Link>}
      </div>
    </header>

    <section className="bench-panel service-plan-overview" aria-labelledby="service-plan-overview-title">
      <div className="service-plan-overview__hero">
        <div className={balanceClassName}>
          <p className="section-kicker">PLAN BALANCE</p>
          <h2 id="service-plan-overview-title">คงเหลือใช้งานได้</h2>
          <strong>{formatBaht(plan.balance.available)}</strong>
          <span className={`service-plan-overview__status ${statusTone}`}>
            <i aria-hidden="true" />
            {planStatusLabels[plan.status]}
          </span>
        </div>
        <div className="service-plan-overview__progress">
          <div className="service-plan-overview__progress-heading"><span>ใช้จริง + สำรอง</span><strong>{formatBaht(committed)}</strong></div>
          <div className="service-plan-overview__progress-track" role="progressbar" aria-label="สัดส่วนยอดใช้จริงและยอดสำรอง" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`${percent}% ของวงเงิน`}>
            <span style={{ transform: `scaleX(${percent / 100})` }} />
          </div>
          <div className="service-plan-overview__progress-scale"><span>0%</span><strong>{percent}% ของวงเงิน</strong><span>100%</span></div>
        </div>
      </div>
      <dl className="service-plan-overview__stats">
        <div className="service-plan-overview__stat"><dt>วงเงินตั้งต้น</dt><dd>{formatBaht(plan.budget)}</dd></div>
        <div className="service-plan-overview__stat"><dt>ยอดสำรองจาก PR/PO เปิด</dt><dd>{formatBaht(plan.balance.reserved)}</dd></div>
        <div className="service-plan-overview__stat"><dt>ยอดใช้จริงจาก PO ปิด</dt><dd>{formatBaht(plan.balance.spent)}</dd></div>
        <div className="service-plan-overview__stat service-plan-overview__stat--available"><dt>ยอดคงเหลือ</dt><dd>{formatBaht(plan.balance.available)}</dd></div>
      </dl>
    </section>

    <section className="bench-panel service-plan-items-panel"><div className="bench-panel__header"><div><p className="section-kicker">PLAN TEST ITEMS</p><h2>รายการในแผน</h2></div><p>{plan.isRedCross ? `${plan.testItems.length} รายการส่งตรวจ` : 'ไม่มีรายการส่งตรวจ'}</p></div>{plan.testItems.length === 0 ? <p className="empty-state">แผนนี้แสดงเฉพาะวงเงิน ไม่มีรายการส่งตรวจ</p> : <div className="service-ledger-table-wrap"><table className="data-table service-plan-test-items-table"><thead><tr><th>ลำดับ</th><th>ชื่อรายการ</th><th>หน่วย</th><th className="numeric-cell">ราคาต่อหน่วย (บาท)</th></tr></thead><tbody>{plan.testItems.map((item) => <tr key={item.id}><td>{item.lineNumber}</td><td>{item.name}</td><td>{item.unit}</td><td className="numeric-cell identifier">{item.unitPrice === null ? 'ยังไม่ระบุ' : formatBaht(item.unitPrice)}</td></tr>)}</tbody></table></div>}</section>
    <section className="bench-panel service-plan-documents-panel"><div className="bench-panel__header"><div><p className="section-kicker">PLAN DOCUMENTS</p><h2>เอกสารระดับแผน</h2></div><p>เก็บจนกว่าจะปิดปีงบประมาณ</p></div>{plan.documents.length === 0 ? <p className="empty-state">{plan.requiresContract ? 'ยังไม่มีไฟล์สัญญา' : 'ยังไม่มีใบเสนอราคา'}</p> : <ul className="service-document-list">{plan.documents.map((document) => <li key={document.id}><span>{document.kind === 'quotation' ? 'ใบเสนอราคา' : 'สัญญา'}</span><a href={`/api/service-procurement/plans/${plan.id}/documents/${document.id}`} target="_blank" rel="noreferrer">{document.fileName}</a></li>)}</ul>}{plan.requiresContract && canManage && <ServicePlanContractUpload planId={plan.id} document={plan.documents.find((document) => document.kind === 'contract_page')} />}</section>
    <section className="bench-panel service-plan-references-panel"><div className="bench-panel__header"><div><p className="section-kicker">REFERENCED PR / PO</p><h2>ใบ PR/PO ที่อ้างแผน</h2></div><p>{requests.length} ใบ</p></div>{requests.length === 0 ? <p className="empty-state">ยังไม่มีใบ PR อ้างแผนนี้</p> : <div className="service-ledger-table-wrap"><table className="data-table"><thead><tr><th>เลข PR</th><th>ผู้ขอ</th><th>ช่วงใช้ PO</th><th>วงเงิน</th><th>สถานะ</th><th>PO</th></tr></thead><tbody>{requests.map((request) => { const status = serviceRequestDisplayStatus(request); return <tr key={request.id}><td><Link className="text-link identifier" href={`/service-procurement/purchase-requests/${request.id}`}>{request.documentNumber}</Link></td><td>{request.requesterName}</td><td>{request.usageStartDate} – {request.usageEndDate}</td><td className="identifier">{formatBaht(request.requestedAmount)}</td><td>{serviceRequestDisplayStatusLabel(status)}</td><td>{request.poNumber ?? '—'}</td></tr> })}</tbody></table></div>}</section>
    <section className="bench-panel service-plan-ledger-panel"><div className="bench-panel__header"><div><p className="section-kicker">CLOSED PO LEDGER</p><h2>ยอดใช้จริงจาก PO ที่ปิดแล้ว</h2></div><p>{actualLedger.length} รายการ</p></div>{actualLedger.length === 0 ? <p className="empty-state">ยังไม่มียอดใช้จริง ระบบจะตัดยอดเมื่อผู้มีสิทธิ์กดปิดใบ PO</p> : <div className="service-ledger-table-wrap"><table className="data-table"><thead><tr><th>วันที่</th><th>เลข PR</th><th>ยอด</th><th>เหตุผล</th></tr></thead><tbody>{actualLedger.map((entry) => <tr key={entry.id}><td>{entry.eventDate}</td><td>{entry.sourceReference ?? '—'}</td><td className="identifier">{formatBaht(entry.amount)}</td><td>{entry.reason ?? '—'}</td></tr>)}</tbody></table></div>}<p className="field-help">ปีงบประมาณ {plan.fiscalYear}: {formatThaiDateLong(fiscal.start)} - {formatThaiDateLong(fiscal.end)}</p></section>
    {canManage && <ServicePlanExpenseControls plan={plan} canManage={canManage} mode="budget" />}
  </div>
}
