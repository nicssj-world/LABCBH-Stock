'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import type { ExpenseMonthlySeriesEntry } from '@/lib/contracts/budget'
import { deleteOutLabMonthlyUsage } from '@/lib/out-lab/actions'
import { outLabUsageCsv, outLabUsageFileBase, outLabUsageSheetXml } from '@/lib/out-lab/export'
import { fiscalYearOfMonth } from '@/lib/out-lab/fiscal'
import type { OutLabUsageRecord } from '@/lib/out-lab/types'

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2 })
const monthLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  year: 'numeric',
  month: 'short',
  timeZone: 'Asia/Bangkok',
})
const dayLabel = new Intl.DateTimeFormat('th-TH-u-ca-buddhist', {
  dateStyle: 'medium',
  timeZone: 'Asia/Bangkok',
})

type DisplayLimit = 10 | 20 | 50 | 'all'

function download(filename: string, contents: string, mime: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: `${mime};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

interface MonthlyUsageHistoryProps {
  contractId: string
  contractNumber: string | null
  displayName: string | null
  entries: OutLabUsageRecord[]
  series: ExpenseMonthlySeriesEntry[]
  canRecord: boolean
}

export function MonthlyUsageHistory({
  contractId,
  contractNumber,
  displayName,
  entries,
  series,
  canRecord,
}: MonthlyUsageHistoryProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [displayLimit, setDisplayLimit] = useState<DisplayLimit>(10)
  const [isPending, startTransition] = useTransition()

  const base = outLabUsageFileBase({ contractNumber, displayName })
  const displayedEntries = displayLimit === 'all' ? entries : entries.slice(0, displayLimit)

  const remove = (usageId: string) => {
    setError(null)
    setPendingId(usageId)
    startTransition(async () => {
      try {
        await deleteOutLabMonthlyUsage(contractId, usageId)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ลบยอดใช้จ่ายไม่สำเร็จ')
      } finally {
        setPendingId(null)
      }
    })
  }

  return (
    <div className="expense-history">
      <div className="expense-history__toolbar">
        <p className="expense-history__summary">
          แสดง {displayedEntries.length} จาก {entries.length} เดือน · ครอบคลุม {series.length} เดือน
        </p>
        <div className="expense-history__controls">
          <label className="expense-history__display-limit">
            <span>จำนวนที่แสดง</span>
            <select
              value={displayLimit}
              onChange={(event) =>
                setDisplayLimit(
                  event.target.value === 'all' ? 'all' : (Number(event.target.value) as DisplayLimit),
                )
              }
              aria-label="จำนวนประวัติยอดใช้จ่ายที่แสดง"
            >
              <option value={10}>10 รายการ</option>
              <option value={20}>20 รายการ</option>
              <option value={50}>50 รายการ</option>
              <option value="all">ทั้งหมด</option>
            </select>
          </label>
          <div className="expense-history__exports" aria-label="ดาวน์โหลดประวัติยอดใช้จ่าย">
            <span>ส่งออกข้อมูล</span>
            <div>
              {/* Exports always carry every month, never only the rows on screen. */}
              <Button
                variant="secondary"
                className="expense-history__export-button"
                disabled={entries.length === 0}
                onClick={() => download(`${base}.csv`, outLabUsageCsv(entries), 'text/csv')}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18v2h14v-2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ดาวน์โหลด CSV
              </Button>
              <Button
                variant="secondary"
                className="expense-history__export-button"
                disabled={entries.length === 0}
                onClick={() =>
                  download(
                    `${base}.xls`,
                    outLabUsageSheetXml({ contractNumber, displayName }, entries),
                    'application/vnd.ms-excel',
                  )
                }
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M5 3h10l4 4v14H5zM15 3v5h5M8 12h8M8 16h8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                ดาวน์โหลด Excel
              </Button>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {entries.length === 0 ? (
        <p className="empty-state">ยังไม่มีการบันทึกยอดใช้จ่ายในช่วงเวลาของสัญญานี้</p>
      ) : (
        <div className="detail-items-table">
          <table className="data-table">
            <thead>
              <tr>
                <th>เดือน</th>
                <th>ปีงบ</th>
                <th className="numeric-cell">จำนวนเงิน</th>
                <th>ผู้บันทึก</th>
                <th>แก้ไขล่าสุด</th>
                <th>หมายเหตุ</th>
                {canRecord && <th aria-label="จัดการ" />}
              </tr>
            </thead>
            <tbody>
              {displayedEntries.map((entry) => (
                <tr key={entry.id}>
                  <td>{monthLabel.format(new Date(`${entry.usageMonth}T00:00:00+07:00`))}</td>
                  <td className="identifier">{fiscalYearOfMonth(entry.usageMonth) ?? 'ไม่ระบุ'}</td>
                  <td className="numeric-cell identifier">
                    <strong>{money.format(entry.amount)}</strong>
                  </td>
                  <td>{entry.recordedBy ?? 'ไม่ระบุ'}</td>
                  <td>{dayLabel.format(new Date(entry.updatedAt))}</td>
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
      )}
    </div>
  )
}
