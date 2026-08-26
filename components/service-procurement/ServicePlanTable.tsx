import Link from 'next/link'
import { formatBaht, formatServiceBalance, servicePlanTypeLabel } from '@/lib/service-procurement/presenter'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'

export function ServicePlanTable({ plans }: { plans: ServicePlanRecord[] }) {
  return (
    <>
      <div className="service-plan-table-wrap">
        <table className="data-table service-plan-table">
          <thead>
            <tr>
              <th>ชื่อแผน</th>
              <th>หน่วยงาน</th>
              <th>ประเภท</th>
              <th className="service-plan-table__number">วงเงิน</th>
              <th className="service-plan-table__number">ใช้จริง</th>
              <th className="service-plan-table__number">สำรอง</th>
              <th className="service-plan-table__number">คงเหลือ</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id}>
                <td>
                  <Link className="text-link" href={`/service-procurement/plans/${plan.id}`}>
                    {plan.name}
                  </Link>
                  <small>ผู้รับผิดชอบ {plan.responsibles.length || 'ยังไม่กำหนด'} คน</small>
                </td>
                <td>{plan.department}</td>
                <td>{servicePlanTypeLabel(plan.type)}</td>
                <td className="identifier service-plan-table__number">{formatBaht(plan.balance.budget)}</td>
                <td className="identifier service-plan-table__number">{formatBaht(plan.balance.spent)}</td>
                <td className="identifier service-plan-table__number">{formatBaht(plan.balance.reserved)}</td>
                <td className={`identifier service-plan-table__number${plan.balance.available < 0 ? ' is-danger' : ''}`}>
                  <strong>{formatBaht(plan.balance.available)}</strong>
                  <small>{formatServiceBalance(plan.balance)}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="service-plan-cards" aria-label="รายการแผนงานจ้าง">
        {plans.map((plan) => (
          <li key={plan.id} className="bench-panel service-plan-card">
            <div className="service-plan-card__heading">
              <div>
                <p className="section-kicker">ปีงบประมาณ {plan.fiscalYear}</p>
                <h3><Link className="text-link" href={`/service-procurement/plans/${plan.id}`}>{plan.name}</Link></h3>
                <p>{plan.department} · {servicePlanTypeLabel(plan.type)}</p>
              </div>
            </div>
            <dl className="service-plan-card__balance">
              <div><dt>วงเงิน</dt><dd>{formatBaht(plan.balance.budget)}</dd></div>
              <div><dt>ใช้จริง</dt><dd>{formatBaht(plan.balance.spent)}</dd></div>
              <div><dt>สำรอง</dt><dd>{formatBaht(plan.balance.reserved)}</dd></div>
              <div><dt>คงเหลือ</dt><dd><strong>{formatBaht(plan.balance.available)}</strong></dd></div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
