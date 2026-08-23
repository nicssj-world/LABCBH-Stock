'use client'

import { useMemo, useState, type DragEvent } from 'react'
import { Button } from '@/components/ui/Button'
import {
  derivePurchaseRequestChecklist,
  PR_MAX_ATTACHMENT_SIZE_BYTES,
  purchaseRequestAttachmentSlotKey,
  validateCommitteeAssignments,
  validatePurchaseRequestAttachment,
  type CommitteeAssignmentInput,
  type PurchaseRequestChecklistPolicy,
  type PurchaseRequestCommitteeKind,
} from '@/lib/pr/checklist'
import type { PurchaseRequestCommitteeCandidate } from '@/lib/pr/form-options'
import type { PurchaseMethodKind } from '@/lib/pr/schema'
import type { PurchaseRequestChecklistAttachmentRecord } from '@/lib/pr/types'

export type ChecklistFileSelections = Record<string, File | undefined>

export interface UploadedChecklistFile {
  uploadId: string
  fingerprint: string
}

export type UploadedChecklistFiles = Record<string, UploadedChecklistFile | undefined>

interface UploadResponse {
  uploadId: string
  uploadUrl: string
  headers: Record<string, string>
}

export function purchaseRequestFileMime(file: Pick<File, 'name' | 'type'>) {
  if (file.type && file.type !== 'application/octet-stream') return file.type.toLowerCase()
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  return file.type.toLowerCase()
}

export function checklistFileFingerprint(file: Pick<File, 'name' | 'size' | 'lastModified' | 'type'>) {
  return `${file.name}:${file.size}:${file.lastModified}:${purchaseRequestFileMime(file)}`
}

function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (loaded: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value)
    xhr.upload.addEventListener('progress', (event) => onProgress(event.loaded))
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`R2 ตอบกลับสถานะ ${xhr.status || 'ไม่ทราบสถานะ'}`))
    })
    xhr.addEventListener('error', () => reject(new Error('เชื่อมต่อ R2 ไม่สำเร็จ กรุณาตรวจ CORS และลองใหม่')))
    xhr.addEventListener('abort', () => reject(new Error('ยกเลิกการอัปโหลดแล้ว')))
    xhr.send(file)
  })
}

export async function uploadChecklistFiles(input: {
  uploadSessionId: string
  method: PurchaseMethodKind
  total: number | null
  policy: PurchaseRequestChecklistPolicy
  files: ChecklistFileSelections
  uploaded: UploadedChecklistFiles
  onUploaded: (slotKey: string, uploaded: UploadedChecklistFile) => void
  onOverallProgress: (overallProgress: number) => void
}) {
  const selected = input.policy.attachments.flatMap((requirement) => {
    const key = purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)
    const file = input.files[key]
    return file ? [{ requirement, key, file }] : []
  })
  const bytesByKey = new Map(selected.map(({ key }) => [key, 0]))
  const totalBytes = selected.reduce((sum, entry) => sum + entry.file.size, 0)
  const nextUploaded: UploadedChecklistFiles = { ...input.uploaded }

  const report = () => {
    const loaded = [...bytesByKey.values()].reduce((sum, value) => sum + value, 0)
    input.onOverallProgress(totalBytes === 0 ? 100 : Math.min(100, Math.round((loaded / totalBytes) * 100)))
  }
  report()

  for (const { requirement, key, file } of selected) {
    const fingerprint = checklistFileFingerprint(file)
    if (nextUploaded[key]?.fingerprint === fingerprint) {
      bytesByKey.set(key, file.size)
      report()
      continue
    }

    const response = await fetch('/api/purchase-requests/checklist/presign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        uploadSessionId: input.uploadSessionId,
        method: input.method,
        total: input.total,
        kind: requirement.kind,
        slot: requirement.slot,
        fileName: file.name,
        mimeType: purchaseRequestFileMime(file),
        sizeBytes: file.size,
      }),
    })
    const payload = await response.json() as UploadResponse & { error?: string }
    if (!response.ok) throw new Error(payload.error ?? `เตรียมอัปโหลด ${file.name} ไม่สำเร็จ`)
    await putFile(payload.uploadUrl, payload.headers, file, (loaded) => {
      bytesByKey.set(key, loaded)
      report()
    })
    bytesByKey.set(key, file.size)
    const uploaded = { uploadId: payload.uploadId, fingerprint }
    nextUploaded[key] = uploaded
    input.onUploaded(key, uploaded)
    report()
  }

  input.onOverallProgress(100)
  return nextUploaded
}

function formatFileSize(size: number) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`
}

export interface CommitteeMemberComboboxProps {
  kind: PurchaseRequestCommitteeKind
  seat: number
  candidates: PurchaseRequestCommitteeCandidate[]
  selectedProfileId: string | null
  disabledProfileIds: Set<string>
  disabled: boolean
  onSelect: (profileId: string | null) => void
}

export function CommitteeMemberCombobox({
  kind,
  seat,
  candidates,
  selectedProfileId,
  disabledProfileIds,
  disabled,
  onSelect,
}: CommitteeMemberComboboxProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const selected = candidates.find((candidate) => candidate.id === selectedProfileId) ?? null
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('th')
    return candidates
      .filter((candidate) => !needle || [candidate.name, candidate.ephisId, candidate.positionTitle]
        .some((value) => value?.toLocaleLowerCase('th').includes(needle)))
      .slice(0, 12)
  }, [candidates, query])
  const listId = `committee-${kind}-${seat}-options`

  return (
    <div className="committee-picker">
      <label htmlFor={`committee-${kind}-${seat}`}>คนที่ {seat}</label>
      <div className="committee-picker__control">
        <input
          id={`committee-${kind}-${seat}`}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          value={open ? query : selected?.name ?? ''}
          placeholder="พิมพ์ชื่อหรือรหัส E-Phis เพื่อค้นหา"
          onFocus={() => { setQuery(''); setOpen(true) }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false)
          }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true) }}
        />
        {selected && !disabled && (
          <button type="button" aria-label={`ลบ ${selected.name}`} onClick={() => onSelect(null)}>×</button>
        )}
      </div>
      {open && (
        <ul id={listId} role="listbox" className="committee-picker__options">
          {matches.map((candidate) => {
            const optionDisabled = disabledProfileIds.has(candidate.id) && candidate.id !== selectedProfileId
            return (
              <li key={candidate.id} role="option" aria-selected={candidate.id === selectedProfileId}>
                <button
                  type="button"
                  disabled={optionDisabled}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => { onSelect(candidate.id); setOpen(false); setQuery('') }}
                >
                  <strong>{candidate.name}</strong>
                  <small>{candidate.ephisId ? `E-Phis ${candidate.ephisId}` : 'ไม่มีรหัส E-Phis'} · {candidate.positionTitle ?? 'ยังไม่ระบุตำแหน่ง'}</small>
                </button>
              </li>
            )
          })}
          {matches.length === 0 && <li className="committee-picker__empty">ไม่พบบุคลากรที่ค้นหา</li>}
        </ul>
      )}
      <p className={selected?.positionTitle ? 'committee-picker__position' : 'committee-picker__position committee-picker__position--warning'}>
        ตำแหน่ง: {selected?.positionTitle ?? (selected ? 'ยังไม่ระบุในข้อมูลบุคลากร' : 'เลือกบุคลากรก่อน')}
      </p>
    </div>
  )
}

export interface PurchaseRequestChecklistFieldsProps {
  method: PurchaseMethodKind
  total: number | null
  candidates: PurchaseRequestCommitteeCandidate[]
  files: ChecklistFileSelections
  existingAttachments: PurchaseRequestChecklistAttachmentRecord[]
  assignments: CommitteeAssignmentInput[]
  contractRosterReady: boolean
  checklistComplete: boolean
  overallProgress: number | null
  disabled?: boolean
  onFileChange: (slotKey: string, file: File | undefined) => void
  onAssignmentsChange: (assignments: CommitteeAssignmentInput[]) => void
}

export function PurchaseRequestChecklistFields({
  method,
  total,
  candidates,
  files,
  existingAttachments,
  assignments,
  contractRosterReady,
  checklistComplete,
  overallProgress,
  disabled = false,
  onFileChange,
  onAssignmentsChange,
}: PurchaseRequestChecklistFieldsProps) {
  const [draggingSlotKey, setDraggingSlotKey] = useState<string | null>(null)
  const policy = derivePurchaseRequestChecklist(method, total)
  const existingBySlot = new Map(
    existingAttachments
      .filter((attachment) => !attachment.deletedAt)
      .map((attachment) => [purchaseRequestAttachmentSlotKey(attachment.kind, attachment.slot), attachment]),
  )
  const assignmentFor = (kind: PurchaseRequestCommitteeKind, seat: number) =>
    assignments.find((assignment) => assignment.kind === kind && assignment.seat === seat) ?? null
  const setAssignment = (kind: PurchaseRequestCommitteeKind, seat: number, profileId: string | null) => {
    const retained = assignments.filter((assignment) => !(assignment.kind === kind && assignment.seat === seat))
    onAssignmentsChange(profileId ? [...retained, { kind, seat, profileId }] : retained)
  }
  const committeeErrors = validateCommitteeAssignments(policy, assignments)
  const attachmentItems = policy.attachments.map((requirement) => {
    const key = purchaseRequestAttachmentSlotKey(requirement.kind, requirement.slot)
    const file = files[key]
    const existing = existingBySlot.get(key)
    const mimeType = file ? purchaseRequestFileMime(file) : ''
    const errors = file
      ? validatePurchaseRequestAttachment({ kind: requirement.kind, mimeType, sizeBytes: file.size })
      : []
    return {
      requirement,
      key,
      file,
      existing,
      errors,
      complete: errors.length === 0 && Boolean(file || existing),
      isDragging: draggingSlotKey === key,
      dropzoneHintId: `pr-checklist-${requirement.kind}-${requirement.slot}-hint`,
    }
  })
  const primaryAttachments = attachmentItems.filter((item) => item.requirement.kind !== 'quotation')
  const quotationAttachments = attachmentItems.filter((item) => item.requirement.kind === 'quotation')
  const completeAttachmentCount = attachmentItems.filter((item) => item.complete).length

  const handleFileDragOver = (event: DragEvent<HTMLLabelElement>, slotKey: string) => {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'
    if (!disabled) setDraggingSlotKey(slotKey)
  }

  const handleFileDragLeave = (event: DragEvent<HTMLLabelElement>, slotKey: string) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
    setDraggingSlotKey((current) => current === slotKey ? null : current)
  }

  const handleFileDrop = (event: DragEvent<HTMLLabelElement>, slotKey: string) => {
    event.preventDefault()
    event.stopPropagation()
    setDraggingSlotKey((current) => current === slotKey ? null : current)
    if (disabled) return
    const droppedFile = event.dataTransfer.files?.[0]
    if (droppedFile) onFileChange(slotKey, droppedFile)
  }

  const disabledFor = (kind: PurchaseRequestCommitteeKind, seat: number) => {
    const ids = new Set<string>()
    for (const assignment of assignments) {
      if (assignment.kind === kind && assignment.seat !== seat) ids.add(assignment.profileId)
      if (kind === 'inspection' && ['specification', 'result'].includes(assignment.kind)) ids.add(assignment.profileId)
      if (['specification', 'result'].includes(kind) && assignment.kind === 'inspection') ids.add(assignment.profileId)
    }
    return ids
  }

  const renderAttachmentCard = (item: (typeof attachmentItems)[number]) => {
    const { requirement, key, file, existing, errors, complete, isDragging, dropzoneHintId } = item
    const visibleLabel = requirement.kind === 'quotation'
      ? `บริษัทที่ ${item.requirement.slot}`
      : requirement.label

    return (
      <article className={`pr-checklist__file${complete ? ' is-complete' : ''}`} key={key}>
        <div className="pr-checklist__file-copy">
          <div>
            <strong>{visibleLabel}</strong>
            <small>{requirement.kind === 'tor' ? 'PDF เท่านั้น' : 'PDF, JPG, PNG หรือ WEBP'} · สูงสุด 20 MB</small>
          </div>
          <span className={`pr-checklist__file-state${complete ? ' is-complete' : ''}`}>
            {complete && (
              <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
                <path d="m2.25 6.25 2.2 2.2 5.3-5.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              </svg>
            )}
            {complete ? 'แนบแล้ว' : 'รอแนบ'}
          </span>
        </div>
        {(file || existing) && (
          <p className="pr-checklist__file-name">
            {file?.name ?? existing?.fileName} · {formatFileSize(file?.size ?? existing?.sizeBytes ?? 0)}
            {file && existing && <small>จะแทนที่ไฟล์เดิมเมื่อบันทึก</small>}
          </p>
        )}
        {errors.map((message) => <p className="field-error" key={message}>{message}</p>)}
        <div className="pr-checklist__file-actions">
          <label
            className={`pr-checklist__dropzone${isDragging ? ' is-dragging' : ''}`}
            aria-disabled={disabled}
            onDragEnter={(event) => handleFileDragOver(event, key)}
            onDragOver={(event) => handleFileDragOver(event, key)}
            onDragLeave={(event) => handleFileDragLeave(event, key)}
            onDrop={(event) => handleFileDrop(event, key)}
          >
            <svg className="pr-checklist__dropzone-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 15.5V4m0 0L7.5 8.5M12 4l4.5 4.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
              <path d="M5 14.5v3A2.5 2.5 0 0 0 7.5 20h9a2.5 2.5 0 0 0 2.5-2.5v-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
            </svg>
            <span className="pr-checklist__dropzone-copy">
              <strong>{isDragging ? 'วางไฟล์ที่นี่' : file || existing ? 'ลากไฟล์ใหม่มาวางเพื่อเปลี่ยน' : 'ลากไฟล์มาวางที่นี่'}</strong>
              <small id={dropzoneHintId}>หรือคลิกเลือกไฟล์ · {requirement.kind === 'tor' ? 'PDF เท่านั้น' : 'PDF, JPG, PNG หรือ WEBP'}</small>
            </span>
            <input
              key={file ? checklistFileFingerprint(file) : 'empty'}
              type="file"
              accept={requirement.accept.join(',')}
              disabled={disabled}
              aria-label={`แนบ ${requirement.label}`}
              aria-describedby={dropzoneHintId}
              onChange={(event) => onFileChange(key, event.target.files?.[0])}
            />
          </label>
          {file && (
            <Button variant="ghost" type="button" disabled={disabled} onClick={() => onFileChange(key, undefined)}>
              ยกเลิกไฟล์ที่เลือก
            </Button>
          )}
        </div>
      </article>
    )
  }

  return (
    <section className="bench-panel pr-checklist" aria-labelledby="pr-checklist-title">
      <div className="bench-panel__header pr-checklist__header">
        <div>
          <p className="section-kicker">REQUIRED CHECKLIST</p>
          <h2 id="pr-checklist-title" tabIndex={-1}>เอกสารและรายชื่อกรรมการก่อนส่งใบ PR</h2>
          <p>ต้องครบทุกช่องจึงจะกดส่งได้ · ไฟล์ละไม่เกิน 20 MB</p>
        </div>
        <span className={checklistComplete ? 'pr-checklist__status is-complete' : 'pr-checklist__status'}>
          {checklistComplete ? 'ครบแล้ว' : 'ยังไม่ครบ'}
        </span>
      </div>

      <div className="pr-checklist__section">
        <div className="pr-checklist__section-heading">
          <h3>เอกสารแนบ</h3>
          <span aria-live="polite">แนบแล้ว {completeAttachmentCount}/{policy.attachments.length} ไฟล์</span>
        </div>
        <div className="pr-checklist__attachment-groups">
          {primaryAttachments.length > 0 && (
            <section className="pr-checklist__file-group" aria-labelledby="pr-checklist-primary-files">
              <div className="pr-checklist__file-group-heading">
                <h4 id="pr-checklist-primary-files">เอกสารหลัก</h4>
                <span>แนบแล้ว {primaryAttachments.filter((item) => item.complete).length}/{primaryAttachments.length}</span>
              </div>
              <div className="pr-checklist__file-grid pr-checklist__file-grid--primary">
                {primaryAttachments.map(renderAttachmentCard)}
              </div>
            </section>
          )}
          {quotationAttachments.length > 0 && (
            <section className="pr-checklist__file-group" aria-labelledby="pr-checklist-quotation-files">
              <div className="pr-checklist__file-group-heading">
                <h4 id="pr-checklist-quotation-files">ใบเสนอราคาจากบริษัท</h4>
                <span>แนบแล้ว {quotationAttachments.filter((item) => item.complete).length}/{quotationAttachments.length}</span>
              </div>
              <div className="pr-checklist__file-grid pr-checklist__file-grid--quotation">
                {quotationAttachments.map(renderAttachmentCard)}
              </div>
            </section>
          )}
        </div>
      </div>

      {policy.committeeSource === 'contract' ? (
        <div className={`pr-checklist__contract-roster${contractRosterReady ? ' is-complete' : ' is-blocked'}`}>
          <strong>{contractRosterReady ? 'ใช้รายชื่อกรรมการจากสัญญาอัตโนมัติ' : 'สัญญานี้ยังไม่มีรายชื่อกรรมการครบถ้วน'}</strong>
          <p>{contractRosterReady ? 'ไม่ต้องเลือกชื่อซ้ำ ระบบจะบันทึก snapshot จาก roster ของสัญญา' : 'ให้เจ้าหน้าที่คลังตั้งค่า roster ที่หน้ารายละเอียดสัญญาก่อนส่งใบ PR'}</p>
        </div>
      ) : (
        <div className="pr-checklist__section">
          <div className="pr-checklist__section-heading">
            <h3>รายชื่อคณะกรรมการ</h3>
            <span>เลือกจากบุคลากรในระบบเท่านั้น</span>
          </div>
          <p className="pr-checklist__committee-note">พิมพ์ค้นหาด้วยชื่อหรือรหัส E-Phis · ตำแหน่งดึงจากข้อมูลบุคลากรและแก้ในช่องนี้ไม่ได้</p>
          <div className="pr-checklist__committees">
            {policy.committees.map((requirement) => (
              <fieldset key={requirement.kind}>
                <legend>{requirement.label} · {requirement.seats} คน</legend>
                <div className="pr-checklist__committee-grid">
                  {Array.from({ length: requirement.seats }, (_, index) => index + 1).map((seat) => (
                    <CommitteeMemberCombobox
                      key={seat}
                      kind={requirement.kind}
                      seat={seat}
                      candidates={candidates}
                      selectedProfileId={assignmentFor(requirement.kind, seat)?.profileId ?? null}
                      disabledProfileIds={disabledFor(requirement.kind, seat)}
                      disabled={disabled}
                      onSelect={(profileId) => setAssignment(requirement.kind, seat, profileId)}
                    />
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          {committeeErrors.length > 0 && (
            <ul className="pr-checklist__errors" aria-live="polite">
              {committeeErrors.map((message) => <li key={message}>{message}</li>)}
            </ul>
          )}
        </div>
      )}

      {overallProgress !== null && (
        <div className="pr-checklist__progress" aria-live="polite">
          <div><span>กำลังอัปโหลดเอกสารทั้งหมด</span><strong>{overallProgress}%</strong></div>
          <progress aria-label="overall progress" max={100} value={overallProgress} />
        </div>
      )}
    </section>
  )
}

export { PR_MAX_ATTACHMENT_SIZE_BYTES }
