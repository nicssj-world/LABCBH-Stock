'use client'

import { useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'

interface InventoryExportDialogProps {
  departments: readonly string[]
}

export function InventoryExportDialog({ departments }: InventoryExportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dialogId = `inventory-export-dialog-${useId().replaceAll(':', '')}`
  const titleId = `${dialogId}-title`
  const [department, setDepartment] = useState('')
  const [onlyInStock, setOnlyInStock] = useState(false)

  const open = () => dialogRef.current?.showModal()
  const close = () => dialogRef.current?.close()

  const params = new URLSearchParams()
  if (department) params.set('department', department)
  if (onlyInStock) params.set('onlyInStock', '1')
  const exportHref = `/api/inventory/export${params.toString() ? `?${params.toString()}` : ''}`

  return (
    <>
      <Button variant="secondary" onClick={open}>ส่งออก PDF</Button>

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
            <h2 id={titleId}>ส่งออกคงคลังเป็น PDF</h2>
            <p>เลือกขอบเขตรายงานก่อนสร้างไฟล์ PDF จากยอดคงเหลือล่าสุด</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดหน้าต่างส่งออก PDF" onClick={close}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="app-dialog__body inventory-export-dialog__body">
          <label className="field-row">
            หน่วยงาน
            <select value={department} onChange={(event) => setDepartment(event.target.value)}>
              <option value="">ทุกหน่วยงาน</option>
              {departments.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </label>

          <label className="field-toggle">
            <input
              type="checkbox"
              checked={onlyInStock}
              onChange={(event) => setOnlyInStock(event.target.checked)}
            />
            เฉพาะรายการที่มีอยู่ในคลัง (ยอดคงเหลือมากกว่า 0)
          </label>

          <p className="inventory-export-dialog__hint">
            รายการที่มีมากกว่า 1 Lot จะแสดงเลข Lot วันหมดอายุ และยอดคงเหลือเป็นแถวต่อเนื่องใต้รายการหลัก
          </p>

          <div className="inventory-export-dialog__actions">
            <Button variant="secondary" onClick={close}>ยกเลิก</Button>
            <a className="lab-link-button lab-link-button--primary" href={exportHref} onClick={close}>
              สร้าง PDF
            </a>
          </div>
        </div>
      </dialog>
    </>
  )
}
