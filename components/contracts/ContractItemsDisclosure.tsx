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
            <span className="contract-items-disclosure__identity">
              <strong>{item.name}</strong>
              <small>{item.lsCode || 'ไม่ระบุรหัส'}</small>
            </span>
            <span className="contract-items-disclosure__quantity">
              {quantityFormatter.format(item.quantity)} {item.unit}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}
