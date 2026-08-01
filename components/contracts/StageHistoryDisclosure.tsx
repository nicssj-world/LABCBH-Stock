'use client'

import { useId, useState, type ReactNode } from 'react'

export function StageHistoryDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const historyId = useId()

  return (
    <div className="stage-history-disclosure">
      <button
        type="button"
        className="stage-history-toggle"
        aria-expanded={open}
        aria-controls={historyId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="stage-history-toggle__glyph" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <circle cx="7" cy="6" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="17" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="7" cy="18" r="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M9 6h2a3 3 0 0 1 3 3 3 3 0 0 0 3 3M9 18h2a3 3 0 0 0 3-3 3 3 0 0 1 3-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </span>
        <span className="stage-history-toggle__copy">
          <small>บันทึกขั้นตอนสัญญา</small>
          <strong>{open ? 'ซ่อนประวัติขั้นตอนสัญญา' : 'ดูประวัติขั้นตอนสัญญา'}</strong>
          <span className="stage-history-toggle__hint">ข้อมูลย้อนหลังและวันที่มีผล</span>
        </span>
        <svg
          className={open ? 'stage-history-toggle__icon stage-history-toggle__icon--open' : 'stage-history-toggle__icon'}
          viewBox="0 0 24 24"
          width="20"
          height="20"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div id={historyId} hidden={!open} className="stage-history-disclosure__content">
        {children}
      </div>
    </div>
  )
}
