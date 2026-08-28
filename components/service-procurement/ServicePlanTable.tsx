import Link from 'next/link'
import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import { formatBaht, servicePlanTypeLabel } from '@/lib/service-procurement/presenter'
import type { ServicePlanRecord } from '@/lib/service-procurement/types'

function planRemainingPercent(plan: ServicePlanRecord) {
  if (plan.balance.budget <= 0) return null
  return (plan.balance.available / plan.balance.budget) * 100
}

export function ServicePlanTable({ plans }: { plans: ServicePlanRecord[] }) {
  return (
    <>
      <div className="service-plan-table-wrap">
        <table className="data-table service-plan-table">
          <thead>
            <tr>
              <th>ชื่อแผน</th>
              <th>หน่วยงาน</th>
              <th>ประเภท / เงื่อนไข</th>
              <th className="service-plan-table__number">วงเงิน</th>
              <th>สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id}>
                <td>
                  <Link className="text-link" href={`/service-procurement/plans/${plan.id}`}>
                    {plan.name}
                  </Link>
                </td>
                <td>{plan.department}</td>
                <td>{servicePlanTypeLabel(plan.type)}<small>{[plan.isRedCross ? 'สภากาชาดไทย' : '', plan.requiresContract ? 'ทำสัญญา' : ''].filter(Boolean).join(' · ') || 'ทั่วไป'}</small></td>
                <td className="identifier service-plan-table__number">{formatBaht(plan.balance.budget)}</td>
                <td className="service-plan-table__gauge">
                  <span className="status-chip status-chip--service">{plan.status === 'active' ? 'ใช้งานอยู่' : plan.status === 'closing' ? 'อยู่ระหว่างปิด' : 'ปิดแล้ว'}</span>
                  <small>คงเหลือ {formatBaht(plan.balance.available)}</small>
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
                <p>{plan.department} · {servicePlanTypeLabel(plan.type)} · {plan.status === 'active' ? 'ใช้งานอยู่' : plan.status === 'closing' ? 'อยู่ระหว่างปิด' : 'ปิดแล้ว'}</p>
              </div>
            </div>
            <dl className="service-plan-card__balance">
              <div>
                <dt>วงเงิน</dt>
                <dd className="identifier">{formatBaht(plan.balance.budget)}</dd>
              </div>
              <div className="service-plan-card__balance-gauge">
                <dt>สถานะวงเงิน</dt>
                <dd><ContractRemainingGauge percent={planRemainingPercent(plan)} /></dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
