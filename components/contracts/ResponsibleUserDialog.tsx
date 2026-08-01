'use client'

import { useRef, useState } from 'react'
import {
  ResponsibleUserPicker,
  type ResponsibleCandidate,
} from '@/components/contracts/ResponsibleUserPicker'

interface ResponsibleUserDialogProps {
  contractId: number
  candidates: ResponsibleCandidate[]
  selected: string[]
}

export function ResponsibleUserDialog({
  contractId,
  candidates,
  selected,
}: ResponsibleUserDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [pickerSession, setPickerSession] = useState(0)
  const closeDialog = () => dialogRef.current?.close()
  const openDialog = () => {
    setPickerSession((current) => current + 1)
    dialogRef.current?.showModal()
  }

  return (
    <>
      <button
        type="button"
        className="lab-link-button lab-link-button--secondary contract-responsible-trigger"
        aria-haspopup="dialog"
        onClick={openDialog}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        กำหนดผู้รับผิดชอบ
      </button>

      <dialog
        ref={dialogRef}
        className="app-dialog responsible-dialog"
        aria-labelledby="responsible-dialog-title"
        aria-describedby="responsible-dialog-description"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="responsible-dialog-title">กำหนดผู้รับผิดชอบสัญญา</h2>
            <p id="responsible-dialog-description">ผู้ที่ได้รับมอบหมายสามารถบันทึกค่าใช้จ่ายของสัญญานี้ได้</p>
          </div>
          <button
            type="button"
            className="app-dialog__close"
            aria-label="ปิดหน้าต่างกำหนดผู้รับผิดชอบ"
            onClick={closeDialog}
          >
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="app-dialog__body responsible-dialog__body">
          <ResponsibleUserPicker
            key={pickerSession}
            contractId={contractId}
            candidates={candidates}
            selected={selected}
            canEdit
            onSaved={closeDialog}
          />
        </div>
      </dialog>
    </>
  )
}
