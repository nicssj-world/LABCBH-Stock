'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatThaiDate } from '@/lib/inventory/presenter'
import type { LeaseContractSummary } from '@/lib/dashboard/executive-types'

const money = new Intl.NumberFormat('th-TH', {
  style: 'currency',
  currency: 'THB',
  maximumFractionDigits: 0,
})

const STATUS_LABELS = {
  pending: 'อยู่ระหว่างดำเนินการ',
  active: 'ใช้งานอยู่',
  expired: 'สิ้นสุดสัญญา',
  cancelled: 'ยกเลิก',
} as const

const PAGE_SIZE = 8

function contractStatus(status: LeaseContractSummary['status']) {
  if (!status) return { label: 'ไม่ระบุสถานะ', tone: 'neutral' as const }
  return {
    label: STATUS_LABELS[status],
    tone: status === 'active' ? 'success' as const : status === 'pending' ? 'attention' as const : 'neutral' as const,
  }
}

function durationLabel(years: LeaseContractSummary['durationYears']) {
  return years ? `${years} ปี` : 'ไม่ระบุ'
}

export function ExecutiveLeaseTable({ contracts }: { contracts: LeaseContractSummary[] }) {
  const [page, setPage] = useState(0)
  const pageCount = Math.max(1, Math.ceil(contracts.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const rows = useMemo(
    () => contracts.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE),
    [contracts, currentPage],
  )

  if (contracts.length === 0) {
    return <p className="executive-empty">ยังไม่มีสัญญาเช่าเครื่องที่เกี่ยวข้องกับปีงบประมาณนี้</p>
  }

  return (
    <div className="executive-lease-table-shell">
      <div className="executive-lease-table-wrap executive-lease-table-wrap--desktop">
        <table className="executive-lease-table">
          <caption className="sr-only">รายละเอียดสัญญาเช่าเครื่องในปีงบประมาณที่เลือก</caption>
          <thead>
            <tr>
              <th scope="col">สัญญา</th>
              <th scope="col">ระยะเวลา</th>
              <th scope="col">วันที่เริ่ม</th>
              <th scope="col">วันที่สิ้นสุด</th>
              <th scope="col">ค่าใช้จ่าย FY</th>
              <th scope="col">สถานะ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((contract) => {
              const status = contractStatus(contract.status)
              return (
                <tr key={contract.contractId}>
                  <th scope="row">
                    <Link className="executive-lease-table__name" href={`/contracts/${contract.contractId}`}>
                      {contract.contractName}
                    </Link>
                    <small>{contract.contractNumber || 'ยังไม่มีเลขที่สัญญา'}</small>
                  </th>
                  <td><span className="executive-lease-table__duration">{durationLabel(contract.durationYears)}</span></td>
                  <td>{formatThaiDate(contract.startDate)}</td>
                  <td>{formatThaiDate(contract.endDate)}</td>
                  <td className="executive-lease-table__amount">{money.format(contract.fiscalYearExpense)}</td>
                  <td><StatusChip tone={status.tone}>{status.label}</StatusChip></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="executive-lease-cards">
        {rows.map((contract) => {
          const status = contractStatus(contract.status)
          return (
            <article className="executive-lease-card" key={contract.contractId}>
              <div className="executive-lease-card__topline">
                <div>
                  <Link className="executive-lease-table__name" href={`/contracts/${contract.contractId}`}>
                    {contract.contractName}
                  </Link>
                  <small>{contract.contractNumber || 'ยังไม่มีเลขที่สัญญา'}</small>
                </div>
                <StatusChip tone={status.tone}>{status.label}</StatusChip>
              </div>
              <dl className="executive-lease-card__facts">
                <div><dt>ระยะเวลา</dt><dd>{durationLabel(contract.durationYears)}</dd></div>
                <div><dt>ค่าใช้จ่าย FY</dt><dd>{money.format(contract.fiscalYearExpense)}</dd></div>
                <div><dt>วันที่เริ่ม</dt><dd>{formatThaiDate(contract.startDate)}</dd></div>
                <div><dt>วันที่สิ้นสุด</dt><dd>{formatThaiDate(contract.endDate)}</dd></div>
              </dl>
            </article>
          )
        })}
      </div>

      <div className="executive-lease-table__footer">
        <span aria-live="polite">แสดง {currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, contracts.length)} จาก {contracts.length} สัญญา</span>
        <div className="executive-pagination" aria-label="แบ่งหน้ารายละเอียดสัญญาเช่าเครื่อง">
          <button
            className="lab-button lab-button--secondary"
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          >
            ก่อนหน้า
          </button>
          <span>หน้า {currentPage + 1} / {pageCount}</span>
          <button
            className="lab-button lab-button--secondary"
            type="button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
          >
            ถัดไป
          </button>
        </div>
      </div>
    </div>
  )
}
