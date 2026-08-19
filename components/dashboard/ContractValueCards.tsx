'use client'

import { useState } from 'react'
import { StatusChip } from '@/components/ui/StatusChip'
import { BanknoteIcon, WalletIcon } from '@/components/dashboard/DashboardIcons'
import type { ContractValueScope } from '@/lib/dashboard/contracts'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

type Scope = 'all' | 'lease' | 'supply'

const SCOPE_OPTIONS: Array<{ key: Scope; label: string }> = [
  { key: 'all', label: 'รวม' },
  { key: 'lease', label: 'เช่า' },
  { key: 'supply', label: 'อื่นๆ' },
]

const SCOPE_COPY: Record<Scope, {
  totalLabel: string
  totalHint: string
  remainingLabel: string
  remainingHint: string
  percentHint: string
}> = {
  all: {
    totalLabel: 'มูลค่าสัญญารวม',
    totalHint: 'รายการน้ำยาในสัญญาซื้อ และมูลค่าสัญญาเช่า',
    remainingLabel: 'มูลค่าคงเหลือในสัญญา',
    remainingHint: 'หลังหักการยืนยันใน PR และการตัดงบรายเดือน',
    percentHint: 'ของมูลค่ารวม',
  },
  lease: {
    totalLabel: 'มูลค่าสัญญาเช่า',
    totalHint: 'มูลค่าสัญญาเช่าทั้งหมด',
    remainingLabel: 'คงเหลือในสัญญาเช่า',
    remainingHint: 'หลังหักการตัดงบรายเดือน',
    percentHint: 'ของมูลค่าสัญญาเช่า',
  },
  supply: {
    totalLabel: 'มูลค่าสัญญาอื่นๆ',
    totalHint: 'รายการน้ำยาในสัญญาซื้อประเภทอื่นทั้งหมด',
    remainingLabel: 'คงเหลือในสัญญาอื่นๆ',
    remainingHint: 'หลังหักการยืนยันใน PR',
    percentHint: 'ของมูลค่าสัญญาอื่นๆ',
  },
}

export function ContractValueCards({
  total,
  lease,
  supply,
}: {
  total: ContractValueScope
  lease: ContractValueScope
  supply: ContractValueScope
}) {
  const [scope, setScope] = useState<Scope>('all')
  const scopeValue = scope === 'all' ? total : scope === 'lease' ? lease : supply
  const copy = SCOPE_COPY[scope]

  const remainingPercent = scopeValue.total > 0 ? (scopeValue.remaining / scopeValue.total) * 100 : null
  const atRisk = remainingPercent !== null && remainingPercent < 30

  return (
    <div className="executive-strip__value-cluster">
      <div className="executive-strip__scope-toggle" role="group" aria-label="ขอบเขตมูลค่าสัญญา">
        {SCOPE_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={scope === option.key}
            onClick={() => setScope(option.key)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="executive-strip__value-cluster__cards">
        <div className="executive-strip__card">
          <div className="executive-strip__head">
            <span>{copy.totalLabel}</span>
            <span className="executive-strip__icon" aria-hidden="true"><BanknoteIcon /></span>
          </div>
          <strong>{money.format(scopeValue.total)}</strong>
          <small>{copy.totalHint}</small>
        </div>
        <div className={`executive-strip__card${atRisk ? ' executive-strip__cell--risk' : ''}`}>
          <div className="executive-strip__head">
            <span>{copy.remainingLabel}</span>
            <span className="executive-strip__icon" aria-hidden="true"><WalletIcon /></span>
          </div>
          <div className="executive-strip__value">
            <strong>{money.format(scopeValue.remaining)}</strong>
            {atRisk && <StatusChip tone="danger">ต่ำกว่า 30%</StatusChip>}
          </div>
          <small>
            {copy.remainingHint}
            {remainingPercent !== null &&
              ` · เหลือ ${remainingPercent.toLocaleString('th-TH', { maximumFractionDigits: 1 })}% ${copy.percentHint}`}
          </small>
        </div>
      </div>
    </div>
  )
}
