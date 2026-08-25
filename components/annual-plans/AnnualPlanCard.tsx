'use client'

import { useRouter } from 'next/navigation'
import { AnnualPlanUploadDropzone } from './AnnualPlanUploadDropzone'
import { annualPlanTypeLabel, fiscalYearLabel } from '@/lib/annual-plans/presenter'
import type { AnnualPlanSlot } from '@/lib/annual-plans/types'

export interface AnnualPlanCardProps {
  slot: AnnualPlanSlot
  canManage: boolean
  onPreview: (planId: string, fileName: string) => void
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatUploadedAt(value: string) {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeZone: 'Asia/Bangkok',
  }).format(new Date(value))
}

export function AnnualPlanCard({ slot, canManage, onPreview }: AnnualPlanCardProps) {
  const router = useRouter()
  const planLabel = annualPlanTypeLabel(slot.planType)
  const plan = slot.plan

  return (
    <article className="annual-plan-card" aria-labelledby={`annual-plan-${slot.fiscalYear}-${slot.planType}`}>
      <header className="annual-plan-card__header">
        <div className="annual-plan-card__marker" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 16h6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <p className="section-kicker">{slot.planType === 'procurement' ? 'PROCUREMENT' : 'HIRING'}</p>
          <h3 id={`annual-plan-${slot.fiscalYear}-${slot.planType}`}>{planLabel}</h3>
        </div>
      </header>

      {plan ? (
        <div className="annual-plan-card__document">
          <div className="annual-plan-card__file">
            <strong title={plan.fileName}>{plan.fileName}</strong>
            <small>
              {formatFileSize(plan.fileSize)} · อัปโหลด {formatUploadedAt(plan.uploadedAt)}
              {plan.uploadedByName ? ` โดย ${plan.uploadedByName}` : ''}
            </small>
          </div>
          <button
            type="button"
            className="lab-button lab-button--secondary annual-plan-card__view"
            onClick={() => onPreview(plan.id, plan.fileName)}
            aria-label={`เปิดดู${planLabel} ${fiscalYearLabel(slot.fiscalYear)}`}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
              <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            ดูแผน
          </button>
        </div>
      ) : (
        <p className="annual-plan-card__empty">ยังไม่มีไฟล์{planLabel}สำหรับ{fiscalYearLabel(slot.fiscalYear)}</p>
      )}

      {canManage && (
        <AnnualPlanUploadDropzone
          fiscalYear={slot.fiscalYear}
          planType={slot.planType}
          existingFile={plan}
          onUploaded={() => router.refresh()}
        />
      )}
    </article>
  )
}
