import { ContractRemainingGauge } from '@/components/contracts/ContractRemainingGauge'
import type { ContractItemRecord } from '@/lib/contracts/types'

const quantityFormatter = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 3,
})

export function ContractItemsDisclosure({ items }: { items: ContractItemRecord[] }) {
  if (items.length === 0) return null

  return (
    <details className="contract-items-disclosure">
      <summary>
        <span>รายการสินค้า</span>
        <small>{items.length} รายการ</small>
      </summary>
      <ul className="contract-items-disclosure__list">
        {items.map((item) => (
          <li key={item.id}>
            <div className="contract-items-disclosure__identity">
              <strong>{item.name}</strong>
              <div className="contract-items-disclosure__meta">
                <span>
                  คงเหลือ {quantityFormatter.format(item.remainingQuantity)} / {quantityFormatter.format(item.quantity)} {item.unit}
                </span>
              </div>
            </div>
            <div className="contract-items-disclosure__gauge">
              <ContractRemainingGauge compact percent={item.remainingPercent} />
            </div>
          </li>
        ))}
      </ul>
    </details>
  )
}
