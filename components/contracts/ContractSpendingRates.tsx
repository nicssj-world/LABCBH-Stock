import { contractSpendingRates } from '@/lib/contracts/budget'
import type { ContractDurationYears } from '@/lib/contracts/types'
import { formatBaht } from '@/lib/pr/presenter'

interface ContractSpendingRatesProps {
  total: number | null
  durationYears: ContractDurationYears | null
}

export function ContractSpendingRates({ total, durationYears }: ContractSpendingRatesProps) {
  const rates = contractSpendingRates(total, durationYears)
  const monthly = rates.monthly
  const annual = rates.annual
  const termLabel = durationYears === null ? 'ยังไม่ระบุระยะเวลา' : `สัญญา ${durationYears} ปี`

  return (
    <section className="bench-panel contract-spending-rates" aria-labelledby="contract-spending-rates-title">
      <div className="bench-panel__header contract-spending-rates__header">
        <div>
          <h2 id="contract-spending-rates-title">อัตราใช้จ่ายเฉลี่ยตามสัญญา</h2>
          <p>ใช้มูลค่าสัญญาเป็นฐานสำหรับเปรียบเทียบสัญญา 1 ปีและ 3 ปี</p>
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
              <small>มูลค่าสัญญา ÷ {rates.durationMonths} เดือน</small>
            </div>
            <div>
              <dt>เฉลี่ย/ปี</dt>
              <dd>{formatBaht(annual)}</dd>
              <small>
                {durationYears === 1 ? 'เท่ากับมูลค่าสัญญา เนื่องจากอายุสัญญา 1 ปี' : `มูลค่าสัญญา ÷ ${durationYears} ปี`}
              </small>
            </div>
          </dl>
          <p className="contract-spending-rates__note">
            เป็นค่าเฉลี่ยตามมูลค่าสัญญา ไม่ใช่ยอดใช้จ่ายจริงสะสม
          </p>
        </>
      ) : (
        <div className="contract-spending-rates__missing">
          <strong>ยังคำนวณอัตราเฉลี่ยไม่ได้</strong>
          <p>
            {durationYears === null
              ? 'ยังไม่ได้ระบุจำนวนปีของสัญญา กรุณาเลือก 1 ปีหรือ 3 ปี'
              : 'ยังไม่มีมูลค่าสัญญาที่ใช้เป็นฐานคำนวณ'}
          </p>
        </div>
      )}
    </section>
  )
}
