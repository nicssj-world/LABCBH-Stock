'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'

interface InventoryAnnualReportExportDialogProps {
  departments: readonly string[]
  fiscalYears: readonly number[]
  defaultFiscalYear: number
}

export function InventoryAnnualReportExportDialog({
  departments,
  fiscalYears,
  defaultFiscalYear,
}: InventoryAnnualReportExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = `inventory-annual-report-dialog-${useId().replaceAll(':', '')}`
  const titleId = `${dialogId}-title`
  const [fiscalYear, setFiscalYear] = useState(String(defaultFiscalYear))
  const [department, setDepartment] = useState('')

  const open = () => dialogRef.current?.showModal()
  const close = () => dialogRef.current?.close()

  const params = new URLSearchParams({ fiscalYear })
  if (department) params.set('department', department)
  const exportHref = `/api/inventory/annual-report/export?${params.toString()}`

  return (
    <>
      <Button variant="secondary" onClick={open}>Export รายงานประจำปี</Button>

      <dialog
        ref={dialogRef}
        className="app-dialog inventory-export-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault()
          close()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) close()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id={titleId}>Export รายงานตรวจสอบคลังประจำปี</h2>
            <p>เลือกปีงบประมาณและหน่วยงานก่อนสร้างไฟล์ Excel ตามแบบรายงานตรวจสอบพัสดุ</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่าง Export รายงานประจำปี" onClick={close}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="app-dialog__body inventory-export-dialog__body">
          <label className="field-row">
            ปีงบประมาณ
            <select value={fiscalYear} onChange={(event) => setFiscalYear(event.target.value)}>
              {fiscalYears.map((year) => <option value={year} key={year}>ปีงบประมาณ {year}</option>)}
            </select>
          </label>

          <label className="field-row">
            หน่วยงาน
            <select value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="">ทุกหน่วยงาน</option>
              {departments.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>

          <p className="inventory-export-dialog__hint">
            รายงานจะสรุปยอดยกมา รับระหว่างปี รวมรับ จ่าย และคงเหลือ ณ วันที่ 30 กันยายนของปีงบประมาณที่เลือก รวมรายการที่ยอดเป็นศูนย์ด้วย
          </p>

          <div className="inventory-export-dialog__actions">
            <Button variant="secondary" onClick={close}>ยกเลิก</Button>
            <a className="lab-link-button lab-link-button--primary" href={exportHref} onClick={close}>
              สร้าง Excel
            </a>
          </div>
        </div>
      </dialog>
    </>
  )
}
