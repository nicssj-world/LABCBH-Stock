import type { BudgetSnapshot } from '@/lib/contracts/budget'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  minimumFractionDigits: 2,
})

interface BudgetGaugeProps {
  total: number | null
  snapshot: BudgetSnapshot
  lowBudget: boolean
}

export function BudgetGauge({ total, snapshot, lowBudget }: BudgetGaugeProps) {
  // A contract with no recorded value has an unknown ceiling, not an exhausted
  // one. Drawing an empty bar would read as "no budget left", which is the
  // opposite of what it means.
  if (total === null || snapshot.remaining === null || snapshot.percentUsed === null) {
    return (
      <div className="budget-gauge budget-gauge--unknown">
        <p className="budget-gauge__unknown">ยังไม่ระบุมูลค่าสัญญา จึงคำนวณงบคงเหลือไม่ได้</p>
        <dl className="budget-gauge__figures">
          <div>
            <dt>ใช้ไปแล้ว</dt>
            <dd className="identifier">{money.format(snapshot.used)}</dd>
          </div>
        </dl>
      </div>
    )
  }

  const capped = Math.min(100, Math.max(0, snapshot.percentUsed))
  const tone = snapshot.exhausted ? 'danger' : lowBudget ? 'warn' : 'ok'

  return (
    <div className="budget-gauge">
      <div
        className={`budget-gauge__track budget-gauge__track--${tone}`}
        role="meter"
        aria-valuenow={Math.round(snapshot.percentUsed)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="สัดส่วนงบที่ใช้ไป"
      >
        <span className="budget-gauge__fill" style={{ width: `${capped}%` }} />
      </div>
      <dl className="budget-gauge__figures">
        <div>
          <dt>มูลค่าสัญญา</dt>
          <dd className="identifier">{money.format(total)}</dd>
        </div>
        <div>
          <dt>ใช้ไปแล้ว</dt>
          <dd className="identifier budget-gauge__used">
            {money.format(snapshot.used)} ({snapshot.percentUsed.toFixed(1)}%)
          </dd>
        </div>
        <div>
          <dt>คงเหลือ</dt>
          <dd className={`identifier budget-gauge__remaining--${tone}`}>
            {money.format(snapshot.remaining)}
          </dd>
        </div>
      </dl>
      {snapshot.exhausted && (
        <p className="budget-gauge__flag" role="status">
          ใช้งบครบตามมูลค่าสัญญาแล้ว
        </p>
      )}
      {!snapshot.exhausted && lowBudget && (
        <p className="budget-gauge__flag" role="status">
          งบคงเหลือต่ำกว่า 30% ของมูลค่าสัญญา
        </p>
      )}
    </div>
  )
}
