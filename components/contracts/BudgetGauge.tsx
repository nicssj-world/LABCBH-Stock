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
          <div className="budget-gauge__figure--used">
            <dt>ใช้ไปแล้ว</dt>
            <dd className="identifier">{money.format(snapshot.used)}</dd>
          </div>
        </dl>
      </div>
    )
  }

  const usedPercent = Math.min(100, Math.max(0, snapshot.percentUsed))
  const remainingPercent = Math.max(0, 100 - usedPercent)
  const tone = snapshot.exhausted ? 'danger' : lowBudget ? 'danger' : 'ok'
  const healthLabel = snapshot.exhausted
    ? 'งบสัญญาถูกใช้ครบแล้ว'
    : lowBudget
      ? 'งบคงเหลือต่ำกว่า 30%'
      : 'งบคงเหลือเพียงพอ'

  return (
    <div className="budget-gauge">
      <div
        className={`budget-gauge__track budget-gauge__track--${tone}`}
        role="meter"
        aria-valuenow={Math.round(remainingPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="สัดส่วนงบคงเหลือ"
      >
        <span className="budget-gauge__fill" style={{ transform: `scaleX(${remainingPercent / 100})` }} />
      </div>
      <div className="budget-gauge__progress-meta" aria-hidden="true">
        <span className="budget-gauge__progress-used"><i />ใช้ไปแล้ว <strong>{usedPercent.toFixed(1)}%</strong></span>
        <span className={`budget-gauge__progress-remaining--${tone}`}><i />คงเหลือ <strong>{remainingPercent.toFixed(1)}%</strong></span>
      </div>
      <dl className="budget-gauge__figures">
        <div className="budget-gauge__figure--total">
          <dt>มูลค่าสัญญา</dt>
          <dd className="identifier">{money.format(total)}</dd>
        </div>
        <div className="budget-gauge__figure--used">
          <dt>ใช้ไปแล้ว</dt>
          <dd className="identifier">
            {money.format(snapshot.used)} ({snapshot.percentUsed.toFixed(1)}%)
          </dd>
        </div>
        <div className={`budget-gauge__figure--remaining-${tone}`}>
          <dt>คงเหลือ</dt>
          <dd className="identifier">
            {money.format(snapshot.remaining)}
          </dd>
        </div>
      </dl>
      <p className={`budget-gauge__health budget-gauge__health--${tone}`} role="status">{healthLabel}</p>
    </div>
  )
}
