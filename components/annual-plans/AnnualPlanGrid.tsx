'use client'

import { useState } from 'react'
import { AnnualPlanCard } from './AnnualPlanCard'
import { AnnualPlanPreviewDialog } from './AnnualPlanPreviewDialog'
import { fiscalYearLabel } from '@/lib/annual-plans/presenter'
import type { AnnualPlanYearGroup } from '@/lib/annual-plans/types'

export interface AnnualPlanGridProps {
  groups: AnnualPlanYearGroup[]
  canManage: boolean
}

export function AnnualPlanGrid({ groups, canManage }: AnnualPlanGridProps) {
  const [preview, setPreview] = useState<{ planId: string; fileName: string } | null>(null)

  return (
    <div className="annual-plan-groups">
      <section className="annual-plan-retention-note" aria-label="นโยบายการเก็บเอกสาร">
        <span className="annual-plan-retention-note__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M12 3v18M5 7h14M5 17h14M7 3h10v18H7z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p><strong>เก็บเอกสาร 2 ปีงบประมาณ</strong> ระบบจะแสดงปีงบประมาณปัจจุบันและย้อนหลัง 1 ปีเท่านั้น</p>
      </section>

      {groups.map((group) => (
        <section className="bench-panel annual-plan-group" key={group.fiscalYear} aria-labelledby={`annual-plan-year-${group.fiscalYear}`}>
          <header className="bench-panel__header annual-plan-group__header">
            <div>
              <p className="section-kicker">FISCAL YEAR</p>
              <h2 id={`annual-plan-year-${group.fiscalYear}`}>{fiscalYearLabel(group.fiscalYear)}</h2>
            </div>
            <p>2 แผน · PDF</p>
          </header>
          <div className="annual-plan-grid">
            {group.slots.map((slot) => (
              <AnnualPlanCard
                key={`${slot.fiscalYear}-${slot.planType}`}
                slot={slot}
                canManage={canManage}
                onPreview={(planId, fileName) => setPreview({ planId, fileName })}
              />
            ))}
          </div>
        </section>
      ))}

      <AnnualPlanPreviewDialog
        planId={preview?.planId ?? null}
        fileName={preview?.fileName ?? null}
        open={preview !== null}
        onCancel={() => setPreview(null)}
      />
    </div>
  )
}
