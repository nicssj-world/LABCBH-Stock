'use client'

import { useId, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/Button'
import { DocumentPreview } from '@/components/ui/DocumentPreview'
import {
  PR_ATTACHMENT_KIND_LABELS,
  PR_COMMITTEE_KIND_LABELS,
  type PurchaseRequestCommitteeKind,
} from '@/lib/pr/checklist'
import { retryPurchaseRequestChecklistCleanup } from '@/lib/pr/checklist-actions'
import { formatProfileName } from '@/lib/profiles/name'
import type {
  PurchaseRequestChecklistAttachmentRecord,
  PurchaseRequestChecklistRecord,
} from '@/lib/pr/types'

interface PurchaseRequestChecklistPanelProps {
  requestId: string
  checklist: PurchaseRequestChecklistRecord
  canRetryCleanup: boolean
}

interface PurchaseRequestChecklistActionsProps {
  requestId: string
  checklist: PurchaseRequestChecklistRecord
}

const COMMITTEE_ORDER: PurchaseRequestCommitteeKind[] = ['specification', 'result', 'inspection']
const attachmentKindOrder: Record<PurchaseRequestChecklistAttachmentRecord['kind'], number> = {
  tor: 0,
  plan_page: 1,
  contract_page: 2,
  quotation: 3,
}

function formatSize(value: number | null) {
  if (value === null) return 'ไม่ระบุขนาด'
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`
}

export function PurchaseRequestChecklistActions({ requestId, checklist }: PurchaseRequestChecklistActionsProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = `pr-committee-pdf-preview-title-${useId().replaceAll(':', '')}`
  const [isCommitteePdfOpen, setIsCommitteePdfOpen] = useState(false)
  const activeAttachmentCount = checklist.attachments.filter((attachment) => !attachment.deletedAt).length

  const openCommitteePdf = () => {
    setIsCommitteePdfOpen(true)
    dialogRef.current?.showModal()
  }
  const closeCommitteePdf = () => {
    dialogRef.current?.close()
    setIsCommitteePdfOpen(false)
  }

  return (
    <>
      <div className="pr-stock-officer__actions">
        {activeAttachmentCount > 0 && !checklist.downloadsBlocked && (
          <a className="lab-button lab-button--primary" href={`/api/purchase-requests/${requestId}/checklist/download-all`}>
            ดาวน์โหลดทั้งหมด
          </a>
        )}
        {checklist.canDownloadCommitteePdf ? (
          <Button type="button" variant="primary" onClick={openCommitteePdf}>
            เปิดดู PDF กรรมการ
          </Button>
        ) : (
          <button className="lab-button lab-button--primary" type="button" disabled title="ต้องมีตำแหน่งบุคลากรครบทุกคน">
            เปิดดู PDF กรรมการ
          </button>
        )}
      </div>

      <dialog
        ref={dialogRef}
        className="app-dialog file-preview-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault()
          closeCommitteePdf()
        }}
        onClose={() => setIsCommitteePdfOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeCommitteePdf()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id={titleId}>PDF รายชื่อกรรมการ</h2>
            <p>แสดงเอกสารจากที่จัดเก็บส่วนตัวในหน้ารายละเอียดใบ PR</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดตัวอย่าง PDF รายชื่อกรรมการ" onClick={closeCommitteePdf}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="app-dialog__body file-preview-dialog__body">
          {isCommitteePdfOpen && (
            <DocumentPreview
              title="ตัวอย่าง PDF รายชื่อกรรมการ"
              src={`/api/purchase-requests/${requestId}/checklist/committee-pdf`}
              fileName="committee.pdf"
              mimeType="application/pdf"
            />
          )}
        </div>
      </dialog>
    </>
  )
}

export function PurchaseRequestChecklistPanel({
  requestId,
  checklist,
  canRetryCleanup,
}: PurchaseRequestChecklistPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previewTitleId = `pr-checklist-preview-title-${useId().replaceAll(':', '')}`
  const [preview, setPreview] = useState<PurchaseRequestChecklistAttachmentRecord | null>(null)
  const [cleanupError, setCleanupError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const activeAttachments = checklist.attachments
    .filter((attachment) => !attachment.deletedAt)
    .sort((left, right) => attachmentKindOrder[left.kind] - attachmentKindOrder[right.kind] || left.slot - right.slot)
  const primaryAttachments = activeAttachments.filter((attachment) => attachment.kind !== 'quotation')
  const quotationAttachments = activeAttachments.filter((attachment) => attachment.kind === 'quotation')
  const deletedAttachments = checklist.attachments.filter((attachment) => attachment.deletedAt || attachment.objectDeletedAt)

  const openPreview = (attachment: PurchaseRequestChecklistAttachmentRecord) => {
    setPreview(attachment)
    dialogRef.current?.showModal()
  }
  const closePreview = () => {
    dialogRef.current?.close()
    setPreview(null)
  }
  const renderAttachment = (attachment: PurchaseRequestChecklistAttachmentRecord) => (
    <article key={attachment.id}>
      <div>
        <strong>{attachment.kind === 'quotation' ? `บริษัทที่ ${attachment.slot}` : PR_ATTACHMENT_KIND_LABELS[attachment.kind]}</strong>
        <span>{attachment.fileName} · {formatSize(attachment.sizeBytes)}{attachment.sourceContractId ? ' · ไฟล์กลางจากสัญญา' : ''}</span>
      </div>
      {!checklist.downloadsBlocked && !attachment.objectDeletedAt && (
        <Button type="button" variant="primary" onClick={() => openPreview(attachment)}>เปิดดู</Button>
      )}
    </article>
  )

  return (
    <div className="pr-checklist-detail">
      <div className="pr-checklist-detail__toolbar">
        <div>
          <strong>เอกสารประกอบ</strong>
        </div>
      </div>

      {checklist.downloadsBlocked && (
        <p className="pr-checklist-detail__notice">ไฟล์ต้นฉบับครบอายุงานและถูกปิดการเข้าถึงแล้ว เหลือ metadata สำหรับตรวจสอบย้อนหลัง</p>
      )}

      <section className="pr-checklist-detail__group" aria-label="เอกสารแนบ">
        <div className="pr-checklist-detail__file-groups">
          {primaryAttachments.length > 0 && (
            <section className="pr-checklist-detail__file-group" aria-labelledby="pr-checklist-detail-primary-files-title">
              <div className="pr-checklist-detail__file-group-heading">
                <h4 id="pr-checklist-detail-primary-files-title">เอกสารหลัก</h4>
                <span>{primaryAttachments.length} ไฟล์</span>
              </div>
              <div className="pr-checklist-detail__files pr-checklist-detail__files--primary">
                {primaryAttachments.map(renderAttachment)}
              </div>
            </section>
          )}
          {quotationAttachments.length > 0 && (
            <section className="pr-checklist-detail__file-group" aria-labelledby="pr-checklist-detail-quotation-files-title">
              <div className="pr-checklist-detail__file-group-heading">
                <h4 id="pr-checklist-detail-quotation-files-title">ใบเสนอราคาจากบริษัท</h4>
                <span>{quotationAttachments.length} ไฟล์</span>
              </div>
              <div className="pr-checklist-detail__files pr-checklist-detail__files--quotation">
                {quotationAttachments.map(renderAttachment)}
              </div>
            </section>
          )}
          {activeAttachments.length === 0 && <p className="empty-state">ไม่มีไฟล์ต้นฉบับที่เปิดดูได้</p>}
        </div>
      </section>

      <section className="pr-checklist-detail__group" aria-labelledby="pr-checklist-detail-committees-title">
        <div className="pr-checklist-detail__group-heading">
          <h3 id="pr-checklist-detail-committees-title">รายชื่อคณะกรรมการ</h3>
        </div>
        <div className="pr-checklist-detail__committees">
          {COMMITTEE_ORDER.map((kind) => {
            const members = checklist.committees.filter((member) => member.kind === kind).sort((a, b) => a.seat - b.seat)
            if (members.length === 0) return null
            return (
              <section key={kind} aria-labelledby={`pr-checklist-detail-committee-${kind}-title`}>
                <h4 id={`pr-checklist-detail-committee-${kind}-title`}>{PR_COMMITTEE_KIND_LABELS[kind]}</h4>
                <ol>
                  {members.map((member) => (
                    <li key={member.id}>
                      <span>{formatProfileName(member.name, member.namePrefix)}</span>
                      <small className={member.positionTitle ? '' : 'field-error'}>{member.positionTitle ?? 'ยังไม่ระบุตำแหน่งในข้อมูลบุคลากร'}</small>
                    </li>
                  ))}
                </ol>
              </section>
            )
          })}
        </div>
      </section>

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

      <dialog
        ref={dialogRef}
        className="app-dialog pr-checklist-preview"
        aria-labelledby={previewTitleId}
        onClose={() => {
          setPreview(null)
        }}
      >
        <div className="pr-checklist-preview__header">
          <div>
            <strong id={previewTitleId}>{preview?.fileName ?? 'ตัวอย่างเอกสาร'}</strong>
            <span>เปิดดูในหน้านี้</span>
          </div>
          <Button type="button" variant="ghost" onClick={closePreview}>ปิด</Button>
        </div>
        {preview && (
          <DocumentPreview
            title={`ตัวอย่าง ${preview.fileName}`}
            src={`/api/purchase-requests/${requestId}/checklist/${preview.id}`}
            fileName={preview.fileName}
            mimeType={preview.mimeType}
          />
        )}
      </dialog>
    </div>
  )
}
