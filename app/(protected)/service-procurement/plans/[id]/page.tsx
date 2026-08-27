import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExpenseMonthlyChart } from '@/components/contracts/ExpenseMonthlyChart'
import { ServicePlanExpenseControls } from '@/components/service-procurement/ServicePlanExpenseControls'
import { ServicePlanResponsibleDialog } from '@/components/service-procurement/ServicePlanResponsibleDialog'
import { requireActor } from '@/lib/auth/actor'
import { formatThaiDateInput } from '@/lib/date/thai'
import {
  fiscalYearRange,
  isServicePlanExpenseKind,
  servicePlanAverageMonthly,
  servicePlanMonthlySeries,
} from '@/lib/service-procurement/domain'
import { canManageServicePlans, canRecordServicePlanExpense } from '@/lib/service-procurement/authorization'
import { getServicePlan, listServiceCommitteeCandidates } from '@/lib/service-procurement/queries'
import { formatBaht, servicePlanTypeLabel } from '@/lib/service-procurement/presenter'

const thaiMonth = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  year: 'numeric',
  month: 'long',
  timeZone: 'Asia/Bangkok',
})

function displayDate(value: string) {
  return formatThaiDateInput(value.slice(0, 10)) || value
}

function displayMonth(value: string) {
  const month = value.slice(0, 7)
  return thaiMonth.format(new Date(month + '-01T00:00:00+07:00'))
}

export default async function ServicePlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireActor()
  const { id } = await params
  const result = await getServicePlan(id)
  if (!result) notFound()

  const { plan, ledger } = result
  const canManage = canManageServicePlans(actor)
  const canRecord = canRecordServicePlanExpense(actor, plan.responsibles.map((person) => person.profileId))
  const candidates = canManage ? await listServiceCommitteeCandidates() : []
  const expenseLedger = ledger.filter((entry) => isServicePlanExpenseKind(entry.entryKind))
  const monthlySeries = servicePlanMonthlySeries(plan.fiscalYear, expenseLedger)
  const averageMonthly = servicePlanAverageMonthly(plan.balance.spent)
  const committedAmount = plan.balance.spent + plan.balance.reserved
  const usagePercentage = plan.balance.budget > 0 ? Math.round((committedAmount / plan.balance.budget) * 100) : 0
  const usageBarPercentage = Math.min(100, Math.max(0, usagePercentage))
  const statusLabel = plan.balance.available < 0
    ? 'เกินวงเงิน'
    : usagePercentage >= 80
      ? 'ใกล้เต็มวงเงิน'
      : 'อยู่ในกรอบวงเงิน'
  const statusTone = plan.balance.available < 0 ? 'danger' : usagePercentage >= 80 ? 'attention' : 'success'
  const fiscalPeriod = fiscalYearRange(plan.fiscalYear)

  return (
    <div className="route-stack service-plan-detail-page">
      <header className="page-heading page-heading--actions service-plan-detail__heading">
        <div className="service-plan-detail__heading-copy">
          <Link className="back-link service-plan-detail__back" href="/service-procurement/plans">← แผนงานจ้าง</Link>
          <div className="service-plan-detail__heading-row">
            <div>
              <p className="section-kicker">SERVICE PLAN · FY {plan.fiscalYear}</p>
              <h1>{plan.name}</h1>
              <p className="service-plan-detail__meta"><span>{plan.department}</span><span aria-hidden="true">·</span><span>{servicePlanTypeLabel(plan.type)}</span></p>
            </div>
            <span className={'status-chip status-chip--' + statusTone}>{statusLabel}</span>
          </div>
        </div>
        <div className="page-heading__actions service-plan-detail__actions">
          <a className="lab-link-button lab-link-button--secondary" href={'/api/service-procurement/plans/' + plan.id + '/export'}>Export Excel</a>
          {canManage && <ServicePlanExpenseControls plan={plan} canManage={canManage} mode="budget" />}
          {canManage && <ServicePlanResponsibleDialog planId={plan.id} candidates={candidates} selected={plan.responsibles.map((person) => person.profileId)} />}
          {canManage && <Link className="lab-link-button lab-link-button--secondary" href={'/service-procurement/plans/' + plan.id + '/edit'}>แก้ไขข้อมูล</Link>}
        </div>
      </header>

      <section className="bench-panel service-plan-overview" aria-labelledby="service-plan-overview-title">
        <div className="service-plan-overview__hero">
          <div className={'service-plan-overview__balance' + (plan.balance.available < 0 ? ' is-danger' : '')}>
            <p className="section-kicker">PLAN BALANCE</p>
            <h2 id="service-plan-overview-title">คงเหลือใช้งานได้</h2>
            <strong>{formatBaht(plan.balance.available)}</strong>
            <span className={'service-plan-overview__status service-plan-overview__status--' + statusTone}>
              <i aria-hidden="true" />
              {statusLabel}
            </span>
          </div>
          <div className="service-plan-overview__progress">
            <div className="service-plan-overview__progress-heading">
              <span>ใช้ไปแล้ว + สำรอง</span>
              <strong>{formatBaht(committedAmount)}</strong>
            </div>
            <div
              className="service-plan-overview__progress-track"
              role="progressbar"
              aria-label="สัดส่วนวงเงินที่ใช้ไปแล้วและสำรอง"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={usageBarPercentage}
              aria-valuetext={usagePercentage + '% ของวงเงินแผน'}
            >
              <span style={{ transform: 'scaleX(' + usageBarPercentage / 100 + ')' }} />
            </div>
            <div className="service-plan-overview__progress-scale"><span>0%</span><strong>{usagePercentage}% ของวงเงิน</strong><span>100%</span></div>
            <p><span><i className="service-plan-overview__legend-dot service-plan-overview__legend-dot--spent" />ใช้จริง {formatBaht(plan.balance.spent)}</span><span><i className="service-plan-overview__legend-dot service-plan-overview__legend-dot--reserved" />สำรอง {formatBaht(plan.balance.reserved)}</span></p>
          </div>
        </div>
        <dl className="service-plan-overview__stats">
          <div><dt>วงเงินแผน</dt><dd>{formatBaht(plan.balance.budget)}</dd></div>
          <div><dt>ใช้จริง</dt><dd>{formatBaht(plan.balance.spent)}</dd></div>
          <div><dt>สำรองจาก PR</dt><dd>{formatBaht(plan.balance.reserved)}</dd></div>
          <div><dt>เฉลี่ยใช้/เดือน</dt><dd>{formatBaht(averageMonthly)} <small>จาก 12 เดือนในปีงบประมาณ</small></dd></div>
        </dl>
      </section>

      {canRecord && <ServicePlanExpenseControls plan={plan} canManage={canManage} mode="expense" />}

      <section className="bench-panel service-plan-expense-panel" aria-labelledby="service-plan-expense-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">EXPENSE HISTORY</p>
            <h2 id="service-plan-expense-title">ประวัติค่าใช้จ่าย</h2>
          </div>
          <p>{expenseLedger.length} รายการ · ปีงบประมาณ {plan.fiscalYear}</p>
        </div>

        <ExpenseMonthlyChart
          series={monthlySeries}
          title="ยอดใช้จ่ายรายเดือน"
          summaryLabel="ยอดใช้จริงรวม"
          legendLabel="ยอดใช้จริงต่อเดือน"
          emptyMessage="ยังไม่มีช่วงเวลาสำหรับแสดงกราฟรายเดือน"
        />

        {expenseLedger.length === 0 ? (
          <div className="service-plan-empty-state">
            <div className="service-plan-empty-state__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="22" height="22">
                <path d="M6 3.5h9l3 3V20.5H6zM15 3.5v3h3M9 12h6M9 15.5h4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div><strong>ยังไม่มีรายการค่าใช้จ่าย</strong><p>เมื่อมีการบันทึกค่าใช้จ่าย รายการและกราฟรายเดือนจะแสดงที่นี่</p></div>
          </div>
        ) : (
          <div className="service-ledger-table-wrap service-plan-expense-table-wrap">
            <table className="data-table service-plan-expense-table">
              <caption className="visually-hidden">ประวัติค่าใช้จ่ายของแผน {plan.name}</caption>
              <thead><tr><th>เดือนที่ใช้จ่าย</th><th>วันที่บันทึก</th><th className="service-plan-table__number">ยอดใช้</th><th>เลข PR/PO</th><th>หมายเหตุ</th><th>ผู้บันทึก</th></tr></thead>
              <tbody>
                {expenseLedger.map((entry) => (
                  <tr key={entry.id}>
                    <td className="service-plan-ledger-table__date">{displayMonth(entry.eventDate)}</td>
                    <td className="service-plan-ledger-table__date">{displayDate(entry.createdAt)}</td>
                    <td className={'identifier service-plan-table__number' + (entry.amount < 0 ? ' is-negative' : '')}>{formatBaht(entry.amount)}</td>
                    <td>{entry.sourceReference ?? '—'}</td>
                    <td>{entry.reason ?? '—'}</td>
                    <td>{entry.actorName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="service-plan-expense-panel__period">แสดงรายการค่าใช้จ่ายทั้งหมดของปีงบประมาณ {plan.fiscalYear} ({fiscalPeriod.start.slice(0, 7)} – {fiscalPeriod.end.slice(0, 7)})</p>
      </section>

      {canManage && <ServicePlanExpenseControls plan={plan} canManage={canManage} mode="danger" />}
    </div>
  )
}
