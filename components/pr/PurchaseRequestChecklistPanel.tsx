'use client'

import { useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import {
  PR_ATTACHMENT_KIND_LABELS,
  PR_COMMITTEE_KIND_LABELS,
  type PurchaseRequestCommitteeKind,
} from '@/lib/pr/checklist'
import { retryPurchaseRequestChecklistCleanup } from '@/lib/pr/checklist-actions'
import type {
  PurchaseRequestChecklistAttachmentRecord,
  PurchaseRequestChecklistRecord,
} from '@/lib/pr/types'

interface PurchaseRequestChecklistPanelProps {
  requestId: string
  checklist: PurchaseRequestChecklistRecord
  stockAccess: boolean
  canRetryCleanup: boolean
}

const COMMITTEE_ORDER: PurchaseRequestCommitteeKind[] = ['specification', 'result', 'inspection']

function formatSize(value: number) {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`
}

export function PurchaseRequestChecklistPanel({
  requestId,
  checklist,
  stockAccess,
  canRetryCleanup,
}: PurchaseRequestChecklistPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [preview, setPreview] = useState<PurchaseRequestChecklistAttachmentRecord | null>(null)
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const activeAttachments = checklist.attachments.filter((attachment) => !attachment.deletedAt)
  const deletedAttachments = checklist.attachments.filter((attachment) => attachment.deletedAt || attachment.objectDeletedAt)

  const openPreview = (attachment: PurchaseRequestChecklistAttachmentRecord) => {
    setPreview(attachment)
    dialogRef.current?.showModal()
  }
  const closePreview = () => {
    dialogRef.current?.close()
    setPreview(null)
  }

  return (
    <div className="pr-checklist-detail">
      <div className="pr-checklist-detail__toolbar">
        <div>
          <strong>Checklist เอกสารประกอบ</strong>
          <span>{activeAttachments.length} ไฟล์ · {checklist.committees.length} รายชื่อ</span>
        </div>
        {stockAccess && (
          <div className="pr-checklist-detail__actions">
            {activeAttachments.length > 0 && !checklist.downloadsBlocked && (
              <a className="lab-button lab-button--secondary" href={`/api/purchase-requests/${requestId}/checklist/download-all`}>
                Download all
              </a>
            )}
            {checklist.canDownloadCommitteePdf ? (
              <a className="lab-button lab-button--secondary" href={`/api/purchase-requests/${requestId}/checklist/committee-pdf`}>
                ดาวน์โหลด PDF กรรมการ
              </a>
            ) : (
              <button className="lab-button lab-button--secondary" type="button" disabled title="ต้องมีตำแหน่งบุคลากรครบทุกคน">
                ดาวน์โหลด PDF กรรมการ
              </button>
            )}
          </div>
        )}
      </div>

      {checklist.downloadsBlocked && (
        <p className="pr-checklist-detail__notice">ไฟล์ต้นฉบับครบอายุงานและถูกปิดการเข้าถึงแล้ว เหลือ metadata สำหรับตรวจสอบย้อนหลัง</p>
      )}

      <div className="pr-checklist-detail__files">
        {activeAttachments.map((attachment) => (
          <article key={attachment.id}>
            <div>
              <strong>{PR_ATTACHMENT_KIND_LABELS[attachment.kind]}{attachment.kind === 'quotation' ? ` บริษัทที่ ${attachment.slot}` : ''}</strong>
              <span>{attachment.fileName} · {formatSize(attachment.sizeBytes)}</span>
            </div>
            {!checklist.downloadsBlocked && !attachment.objectDeletedAt && (
              <Button type="button" variant="secondary" onClick={() => openPreview(attachment)}>เปิดดู</Button>
            )}
          </article>
        ))}
        {activeAttachments.length === 0 && <p className="empty-state">ไม่มีไฟล์ต้นฉบับที่เปิดดูได้</p>}
      </div>

      <div className="pr-checklist-detail__committees">
        {COMMITTEE_ORDER.map((kind) => {
          const members = checklist.committees.filter((member) => member.kind === kind).sort((a, b) => a.seat - b.seat)
          if (members.length === 0) return null
          return (
            <section key={kind}>
              <h3>{PR_COMMITTEE_KIND_LABELS[kind]}</h3>
              <ol>
                {members.map((member) => (
                  <li key={member.id}>
                    <span>{member.name}</span>
                    <small className={member.positionTitle ? '' : 'field-error'}>{member.positionTitle ?? 'ยังไม่ระบุตำแหน่งในข้อมูลบุคลากร'}</small>
                  </li>
                ))}
              </ol>
            </section>
          )
        })}
      </div>

      {deletedAttachments.length > 0 && (
        <details className="pr-checklist-detail__audit">
          <summary>ร่องรอยเอกสารที่นำออก/ลบแล้ว ({deletedAttachments.length})</summary>
          <ul>
            {deletedAttachments.map((attachment) => (
              <li key={attachment.id}>
                <span>{attachment.fileName}</span>
                <small>{attachment.deletionReason ?? 'ลบตามอายุงาน'} · {attachment.objectDeletedAt ? 'ลบไฟล์จาก R2 แล้ว' : 'รอลบไฟล์จาก R2'}</small>
              </li>
            ))}
          </ul>
        </details>
      )}

      {canRetryCleanup && checklist.cleanupPendingCount > 0 && (
        <div className="pr-checklist-detail__cleanup">
          <p>มีไฟล์ {checklist.cleanupPendingCount} รายการที่ยังรอลบจาก R2</p>
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() => startTransition(async () => {
              setCleanupError(null)
              try {
                await retryPurchaseRequestChecklistCleanup(requestId)
                window.location.reload()
              } catch (error) {
                setCleanupError(error instanceof Error ? error.message : 'ล้างไฟล์ไม่สำเร็จ')
              }
            })}
          >
            {isPending ? 'กำลังล้างไฟล์…' : 'ลองล้างไฟล์อีกครั้ง'}
          </Button>
          {cleanupError && <p className="form-error" role="alert">{cleanupError}</p>}
        </div>
      )}

      <dialog ref={dialogRef} className="app-dialog pr-checklist-preview" onClose={() => setPreview(null)}>
        <div className="pr-checklist-preview__header">
          <div><strong>{preview?.fileName ?? 'ตัวอย่างเอกสาร'}</strong><span>เปิดดูในหน้านี้</span></div>
          <Button type="button" variant="ghost" onClick={closePreview}>ปิด</Button>
        </div>
        {preview && (
          preview.mimeType.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/api/purchase-requests/${requestId}/checklist/${preview.id}`} alt={preview.fileName} />
          ) : (
            <iframe
              title={`ตัวอย่าง ${preview.fileName}`}
              src={`/api/purchase-requests/${requestId}/checklist/${preview.id}`}
            />
          )
        )}
      </dialog>
    </div>
  )
}
