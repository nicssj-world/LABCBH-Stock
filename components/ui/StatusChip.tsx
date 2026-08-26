import type { ReactNode } from 'react'

type StatusTone = 'neutral' | 'info' | 'progress' | 'attention' | 'success' | 'danger'

export interface StatusChipProps {
  children: ReactNode
  tone?: StatusTone
}

export function StatusChip({ children, tone = 'neutral' }: StatusChipProps) {
  return <span className={`status-chip status-chip--${tone}`}>{children}</span>
}
