'use client'

import { useId, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatQuantity, formatThaiDate } from '@/lib/inventory/presenter'
import {
  PURCHASE_REQUEST_STATUS_LABELS,
  PURCHASE_REQUEST_STATUS_TONES,
  formatBaht,
} from '@/lib/pr/presenter'
import type { PurchaseRequestRecord } from '@/lib/pr/types'

const VISIBLE_LIMIT = 5

/** Reads back the sequence create_purchase_request assigned per contract. */
function purchaseSequenceOf(entry: PurchaseRequestRecord): number | null {
  const value = Number(entry.methodDetails.purchaseSequence)
  return Number.isInteger(value) && value > 0 ? value : null
}

export function ContractPurchaseHistory({ entries }: { entries: PurchaseRequestRecord[] }) {
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<PurchaseRequestRecord | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = useId()

  if (entries.length === 0) {
    return <p className="empty-state">ยังไม่มีการซื้อภายใต้สัญญานี้</p>
  }

  const visible = expanded ? entries : entries.slice(0, VISIBLE_LIMIT)
  const hiddenCount = entries.length - VISIBLE_LIMIT

  const openSummary = (entry: PurchaseRequestRecord) => {
    setSelected(entry)
    dialogRef.current?.showModal()
  }
  const closeSummary = () => dialogRef.current?.close()

  return (
    <div className="detail-items-table">
      <table className="data-table">
        <thead>
          <tr>
            <th>ครั้งที่</th>
            <th>เลขที่ใบ PR</th>
            <th>วันที่ขอซื้อ</th>
            <th>สถานะ</th>
            <th className="numeric-cell">มูลค่า</th>
            <th>เลขที่ PO</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((entry) => (
            <tr key={entry.id}>
              <td className="identifier">{purchaseSequenceOf(entry) ?? '—'}</td>
              <td>
                <button
                  type="button"
                  className="text-link"
                  aria-haspopup="dialog"
                  aria-controls={dialogId}
                  onClick={() => openSummary(entry)}
                >
                  {entry.documentNumber}
                </button>
              </td>
              <td>{formatThaiDate(entry.requestedDate)}</td>
              <td>
                <StatusChip tone={PURCHASE_REQUEST_STATUS_TONES[entry.status]}>
                  {PURCHASE_REQUEST_STATUS_LABELS[entry.status]}
                </StatusChip>
              </td>
              <td className="numeric-cell identifier">{formatBaht(entry.total)}</td>
              <td className="identifier">{entry.poNumber ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <button type="button" className="text-link" onClick={() => setExpanded((current) => !current)}>
          {expanded ? 'ย่อรายการ' : `ดูเพิ่มอีก ${hiddenCount} รายการ`}
        </button>
      )}

      <dialog
        ref={dialogRef}
        id={dialogId}
        className="app-dialog"
        aria-labelledby={`${dialogId}-title`}
        onCancel={(event) => {
          event.preventDefault()
          closeSummary()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeSummary()
        }}
      >
        {selected && (
          <>
            <header className="app-dialog__header">
              <div>
                <h2 id={`${dialogId}-title`}>{selected.documentNumber}</h2>
                <p>
                  ครั้งที่ {purchaseSequenceOf(selected) ?? '—'} · {formatThaiDate(selected.requestedDate)}
                </p>
              </div>
              <button type="button" className="app-dialog__close" aria-label="ปิดสรุปการซื้อ" onClick={closeSummary}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="app-dialog__body">
              {selected.items.length === 0 ? (
                <p className="empty-state">ใบ PR นี้ไม่มีรายการ</p>
              ) : (
                <div className="detail-items-table">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>รหัสพัสดุ</th>
                        <th>ชื่อน้ำยา</th>
                        <th className="numeric-cell">จำนวน</th>
                        <th className="numeric-cell">ราคาต่อหน่วย</th>
                        <th className="numeric-cell">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item) => (
                        <tr key={item.id}>
                          <td className="identifier">{item.lsCode}</td>
                          <td>{item.name}</td>
                          <td className="numeric-cell identifier">{formatQuantity(item.requestedQuantity, item.unit)}</td>
                          <td className="numeric-cell identifier">{formatBaht(item.unitPrice)}</td>
                          <td className="numeric-cell identifier"><strong>{formatBaht(item.lineTotal)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="items-editor__grand-total">
                <span>{selected.items.length} รายการ · ยอดรวม</span>
                <strong>{formatBaht(selected.total)}</strong>
              </p>
            </div>

            <footer className="contract-summary-dialog__footer">
              <Link className="lab-link-button lab-link-button--primary" href={`/purchase-requests/${selected.id}`} onClick={closeSummary}>
                เปิดรายละเอียดเต็ม
              </Link>
              <Button variant="secondary" onClick={closeSummary}>ปิด</Button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  )
}
