'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { setContractOpeningBalances } from '@/lib/contracts/actions'
import type { ContractItemRecord } from '@/lib/contracts/types'
import { bangkokIsoDate } from '@/lib/date/thai'

const quantity = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 })

function todayIso() {
  return bangkokIsoDate()
}

export function OpeningBalanceDialog({ contractId, items }: { contractId: number; items: ContractItemRecord[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const router = useRouter()
  const [values, setValues] = useState<Record<string, number | ''>>({})
  const [effectiveDate, setEffectiveDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const openDialog = () => {
    setValues(Object.fromEntries(items.map((item) => [item.id, item.openingUsedQuantity])))
    setEffectiveDate(todayIso())
    setNote('')
    setError(null)
    dialogRef.current?.showModal()
  }

  const closeDialog = () => {
    if (isPending) return
    dialogRef.current?.close()
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await setContractOpeningBalances(contractId, {
          effectiveDate,
          note,
          lines: items.map((item) => {
            const value = values[item.id]
            return {
              contractItemId: item.id,
              usedQuantity: value === '' ? 0 : value ?? item.openingUsedQuantity,
            }
          }),
        })
        dialogRef.current?.close()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'บันทึกยอดใช้ก่อนเข้าระบบไม่สำเร็จ กรุณาลองใหม่')
      }
    })
  }

  return (
    <>
      <Button variant="secondary" onClick={openDialog}>บันทึกยอดใช้ก่อนเข้าระบบ</Button>

      <dialog
        ref={dialogRef}
        className="app-dialog opening-balance-dialog"
        aria-labelledby="opening-balance-dialog-title"
        aria-describedby="opening-balance-description"
        onCancel={(event) => { event.preventDefault(); closeDialog() }}
      >
        <header className="app-dialog__header">
          <div>
            <p className="section-kicker">ADMIN ONLY</p>
            <h2 id="opening-balance-dialog-title">บันทึกยอดใช้ก่อนเข้าระบบ</h2>
            <p id="opening-balance-description">
              ระบุจำนวนต่อบรรทัดที่ใช้ไปแล้วนอกระบบก่อนสัญญานี้ถูกลงทะเบียน ยอดคงเหลือในทุกหน้าจะปรับตามทันที
            </p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างบันทึกยอดใช้ก่อนเข้าระบบ" onClick={closeDialog}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <form className="app-dialog__body opening-balance-dialog__body" onSubmit={submit}>
          <div className="detail-items-table">
            <table className="data-table">
              <thead>
                <tr>
                  <th>รหัสพัสดุ</th>
                  <th>ชื่อน้ำยา</th>
                  <th className="numeric-cell">จำนวนในสัญญา</th>
                  <th className="numeric-cell">ใช้ไปแล้วก่อนเข้าระบบ</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="identifier">{item.lsCode}</td>
                    <td>{item.name}</td>
                    <td className="numeric-cell identifier">{quantity.format(item.quantity)} {item.unit}</td>
                    <td className="numeric-cell">
                      <input
                        type="number"
                        min="0"
                        max={item.quantity}
                        step="0.001"
                        inputMode="decimal"
                        value={values[item.id] ?? ''}
                        onChange={(event) => {
                          const value = event.target.value
                          setValues((current) => ({
                            ...current,
                            [item.id]: value === '' ? '' : Number(value),
                          }))
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label>
            วันที่มีผล
            <ThaiDateInput value={effectiveDate} onChange={setEffectiveDate} />
          </label>
          <label>
            หมายเหตุที่มาของยอด
            <textarea required minLength={1} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="dialog-actions">
            <Button variant="secondary" onClick={closeDialog} disabled={isPending}>ยกเลิก</Button>
            <Button type="submit" disabled={isPending || !note.trim()}>{isPending ? 'กำลังบันทึก…' : 'บันทึกยอดใช้ก่อนเข้าระบบ'}</Button>
          </div>
        </form>
      </dialog>
    </>
  )
}
