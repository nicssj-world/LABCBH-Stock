'use client'

import { useState } from 'react'
import { StickyScroll } from '@/components/ui/StickyScroll'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import type { ContractOpeningBalanceHistoryEntry } from '@/lib/contracts/types'

const VISIBLE_LIMIT = 5

export function ContractOpeningBalanceHistory({ entries }: { entries: ContractOpeningBalanceHistoryEntry[] }) {
  const [expanded, setExpanded] = useState(false)

  if (entries.length === 0) {
    return <p className="empty-state">ยังไม่มีการบันทึกยอดใช้ก่อนเข้าระบบ</p>
  }

  const visible = expanded ? entries : entries.slice(0, VISIBLE_LIMIT)
  const hiddenCount = entries.length - VISIBLE_LIMIT

  return (
    <StickyScroll className="detail-items-table" ariaLabel="ประวัติยอดยกมา เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม">
      <table className="data-table">
        <thead>
          <tr>
            <th>วันที่มีผล</th>
            <th>รายการที่เปลี่ยน</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((entry) => (
            <tr key={entry.createdAt}>
              <td className="identifier">{formatThaiDate(entry.effectiveDate)}</td>
              <td>
                <ul className="opening-balance-history__lines">
                  {entry.lines.map((line) => (
                    <li key={line.lsCode}>
                      <span className="identifier">{line.lsCode}</span> {line.name}: {formatQuantity(line.previousQuantity)} → <strong>{formatQuantity(line.targetQuantity)}</strong>
                    </li>
                  ))}
                </ul>
              </td>
              <td>{entry.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <button type="button" className="text-link" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'ย่อรายการ' : `ดูเพิ่มอีก ${hiddenCount} รายการ`}
        </button>
      )}
    </StickyScroll>
  )
}
