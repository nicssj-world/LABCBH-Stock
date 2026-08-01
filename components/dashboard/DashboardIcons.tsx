const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function ContractStackIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M7 3h8l4 4v14H7z" />
      <path d="M7 3v18M9 9h6M9 13h6M9 17h4" />
    </svg>
  )
}

export function PendingClockIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  )
}

export function BanknoteIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.6" />
      <path d="M6 9v0M18 15v0" />
    </svg>
  )
}

export function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h11A2.5 2.5 0 0 1 19 7.5V8H5.5A2.5 2.5 0 0 1 3 5.5" />
      <path d="M3 8h16.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5H5a2 2 0 0 1-2-2z" />
      <circle cx="16.5" cy="13.5" r="1.25" />
    </svg>
  )
}
