'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { deleteContractExpense } from '@/lib/contracts/budget-actions'
import type { ContractExpenseRecord } from '@/lib/contracts/budget-queries'
import { expenseCsv, expenseFileBase, expenseSheetXml } from '@/lib/contracts/export'

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })
const monthLabel = new Intl.DateTimeFormat('th-TH', { year: 'numeric', month: 'short' })
const dayLabel = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium' })

function download(filename: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

interface ExpenseHistoryProps {
  contractId: number
  contractNumber: string | null
  displayName: string | null
  entries: ContractExpenseRecord[]
  canRecord: boolean
}

export function ExpenseHistory({
  contractId,
  contractNumber,
  displayName,
  entries,
  canRecord,
}: ExpenseHistoryProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [isPending, startTransition] = useTransition()

  const base = expenseFileBase({ contractNumber, displayName })

  const remove = (usageId: number) => {
    setError(null)
    setPendingId(usageId)
    startTransition(async () => {
      try {
        await deleteContractExpense(contractId, usageId)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ลบค่าใช้จ่ายไม่สำเร็จ')
      } finally {
        setPendingId(null)
      }
    })
  }

  if (entries.length === 0) {
    return <p className="empty-state">ยังไม่มีการบันทึกค่าใช้จ่าย</p>
  }

  return (
    <div className="expense-history">
      <div className="expense-history__actions">
        <Button
          variant="secondary"
          onClick={() => download(`${base}.csv`, expenseCsv(entries), 'text/csv')}
        >
          ดาวน์โหลด CSV
        </Button>
        <Button
          variant="secondary"
          onClick={() =>
            download(
              `${base}.xls`,
              expenseSheetXml({ contractNumber, displayName }, entries),
              'application/vnd.ms-excel',
            )
          }
        >
          ดาวน์โหลด Excel
        </Button>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="detail-items-table">
        <table className="data-table">
          <thead>
            <tr>
              <th>เดือน</th>
              <th>วันที่บันทึก</th>
              <th className="numeric-cell">จำนวนเงิน</th>
              <th>ผู้บันทึก</th>
              <th>หมายเหตุ</th>
              {canRecord && <th aria-label="จัดการ" />}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  {entry.usageMonth
                    ? monthLabel.format(new Date(`${entry.usageMonth}T00:00:00+07:00`))
                    : 'ไม่ระบุ'}
                </td>
                <td>
                  {entry.usageDate
                    ? dayLabel.format(new Date(`${entry.usageDate}T00:00:00+07:00`))
                    : 'ไม่ระบุ'}
                </td>
                <td className="numeric-cell identifier">
                  <strong>{money.format(entry.amount)}</strong>
                </td>
                <td>{entry.recordedBy ?? 'ไม่ระบุ'}</td>
                <td>{entry.note ?? '—'}</td>
                {canRecord && (
                  <td className="numeric-cell">
                    <Button
                      variant="secondary"
                      onClick={() => remove(entry.id)}
                      disabled={isPending && pendingId === entry.id}
                    >
                      {isPending && pendingId === entry.id ? 'กำลังลบ…' : 'ลบ'}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
