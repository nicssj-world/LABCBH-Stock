import { contractSpendingRates } from '@/lib/contracts/budget'
import type { ContractDurationYears } from '@/lib/contracts/types'
import { formatBaht } from '@/lib/pr/presenter'

interface ContractSpendingRatesProps {
  actualUsed: number | null
  durationYears: ContractDurationYears | null
  actualUsageLabel?: string
}

export function ContractSpendingRates({ actualUsed, durationYears, actualUsageLabel }: ContractSpendingRatesProps) {
  const rates = contractSpendingRates(actualUsed, durationYears)
  const monthly = rates.monthly
  const annual = rates.annual
  const termLabel = durationYears === null ? 'ยังไม่ระบุระยะเวลา' : `สัญญา ${durationYears} ปี`
  const usageBasis = actualUsageLabel ?? 'รายการใช้จ่ายที่บันทึกแล้ว'

  return (
    <section className="bench-panel contract-spending-rates" aria-labelledby="contract-spending-rates-title">
      <div className="bench-panel__header contract-spending-rates__header">
        <div>
          <h2 id="contract-spending-rates-title">อัตราใช้จ่ายเฉลี่ยจากยอดใช้จริง</h2>
          <p>คำนวณจากยอดใช้จริงสะสม ÷ ระยะเวลาสัญญา เพื่อเปรียบเทียบสัญญา 1 ปีและ 3 ปี</p>
        </div>
        <span
          className={`contract-spending-rates__term${durationYears === null ? ' contract-spending-rates__term--missing' : ''}`}
        >
          {termLabel}
        </span>
      </div>

      {monthly !== null && annual !== null ? (
        <>
          <dl className="contract-spending-rates__grid">
            <div>
              <dt>เฉลี่ย/เดือน</dt>
              <dd>{formatBaht(monthly)}</dd>
              <small>ยอดใช้จริงสะสม ÷ {rates.durationMonths} เดือน</small>
            </div>
            <div>
              <dt>เฉลี่ย/ปี</dt>
              <dd>{formatBaht(annual)}</dd>
              <small>ยอดใช้จริงสะสม ÷ {durationYears} ปี</small>
            </div>
          </dl>
          <p className="contract-spending-rates__note">
            ยอดใช้จริงสะสม: {actualUsed === null ? 'ไม่ระบุ' : formatBaht(actualUsed)} · {usageBasis}
          </p>
        </>
      ) : (
        <div className="contract-spending-rates__missing">
          <strong>ยังคำนวณอัตราเฉลี่ยไม่ได้</strong>
          <p>
            {durationYears === null
              ? 'ยังไม่ได้ระบุจำนวนปีของสัญญา กรุณาเลือก 1 ปีหรือ 3 ปี'
              : 'ยังไม่มียอดใช้จริงที่ใช้เป็นฐานคำนวณ'}
          </p>
        </div>
      )}
    </section>
  )
}
