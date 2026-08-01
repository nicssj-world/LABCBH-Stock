'use client'

import { useId, useState, type ReactNode } from 'react'

export function StageHistoryDisclosure({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const historyId = useId()

  return (
    <div className="stage-history-disclosure">
      <button
        type="button"
        className="bench-panel stage-history-toggle"
        aria-expanded={open}
        aria-controls={historyId}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <small>PROCUREMENT TRACK</small>
          <strong>{open ? 'ซ่อนประวัติขั้นตอนสัญญา' : 'ดูประวัติขั้นตอนสัญญา'}</strong>
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
