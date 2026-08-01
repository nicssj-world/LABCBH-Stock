'use client'

import { useRef, useState } from 'react'
import { ContractForm } from '@/components/contracts/ContractForm'
import type { ContractRecord } from '@/lib/contracts/types'

export function ContractEditDialog({ contract }: { contract: ContractRecord }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [formSession, setFormSession] = useState(0)
  const [dirty, setDirty] = useState(false)

  const openDialog = () => {
    setDirty(false)
    setFormSession((current) => current + 1)
    dialogRef.current?.showModal()
  }

  const requestClose = () => {
    if (dirty && !window.confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการปิดหน้าต่างแก้ไขหรือไม่')) return
    dialogRef.current?.close()
  }

  const handleSaved = () => {
    setDirty(false)
    dialogRef.current?.close()
  }

  return (
    <>
      <button
        type="button"
        className="lab-link-button lab-link-button--secondary contract-edit-trigger"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        แก้ไขข้อมูล
      </button>

      <dialog
        ref={dialogRef}
        className="app-dialog app-dialog--wide"
        aria-labelledby="contract-edit-dialog-title"
        aria-describedby="contract-edit-dialog-description"
        onCancel={(event) => {
          event.preventDefault()
          requestClose()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) requestClose()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="contract-edit-dialog-title">แก้ไขข้อมูลสัญญา</h2>
            <p id="contract-edit-dialog-description">ปรับข้อมูลหลักและรายการในสัญญา แล้วบันทึกการเปลี่ยนแปลง</p>
          </div>
          <button
            type="button"
            className="app-dialog__close"
            aria-label="ปิดหน้าต่างแก้ไขข้อมูลสัญญา"
            onClick={requestClose}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="app-dialog__body contract-edit-dialog__body">
          <ContractForm
            key={formSession}
            mode="edit"
            contract={contract}
            onCancel={requestClose}
            onSaved={handleSaved}
            onDirtyChange={setDirty}
          />
        </div>
      </dialog>
    </>
  )
}
