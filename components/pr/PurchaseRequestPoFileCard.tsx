'use client'

import { useRef, useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { PoFileDropzone } from '@/components/po/PoFileDropzone'
import { Button } from '@/components/ui/Button'
import { StatusChip } from '@/components/ui/StatusChip'
import { formatPoFileSize, preparePoFile } from '@/lib/po/file'
import {
  getPurchaseRequestPoFileUrl,
  retryPurchaseRequestPoFileCleanup,
  uploadPurchaseRequestPoFile,
} from '@/lib/pr/po-file-actions'
import type { PurchaseRequestPoFileRecord } from '@/lib/pr/types'
import { formatThaiDateTime } from '@/lib/inventory/presenter'

export interface PurchaseRequestPoFileCardProps {
  requestId: string
  poNumber: string | null
  file: PurchaseRequestPoFileRecord
  variant?: 'inline' | 'panel'
  canEdit: boolean
  canRetryCleanup: boolean
}

export function PurchaseRequestPoFileCard({
  requestId,
  poNumber,
  file,
  variant = 'panel',
  canEdit,
  canRetryCleanup,
}: PurchaseRequestPoFileCardProps) {
  const router = useRouter()
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'upload' | 'open' | 'retry' | null>(null)
  const [isPending, startTransition] = useTransition()

  const hasActiveFile = Boolean(file.path) && !file.deletedAt
  const isDeleted = Boolean(file.deletedAt)
  const isCleanupPending = canRetryCleanup && !isDeleted
  const state = isDeleted ? 'deleted' : isCleanupPending ? 'pending' : hasActiveFile ? 'active' : 'empty'
  const isInline = variant === 'inline'
  const statusLabel = isDeleted
    ? file.deletionReason === 'closed_short'
      ? 'ลบไฟล์แล้วเมื่อปิดยอดค้าง'
      : 'ลบไฟล์แล้วหลังบันทึกเข้าคลัง'
    : isCleanupPending
      ? 'รอล้างไฟล์ PO'
      : hasActiveFile
        ? 'แนบไฟล์ PO แล้ว'
        : 'ยังไม่ได้แนบไฟล์ PO'
  const statusTone: 'neutral' | 'attention' | 'success' = isCleanupPending
    ? 'attention'
    : hasActiveFile
      ? 'success'
      : 'neutral'

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        if (!poNumber?.trim()) throw new Error('กรุณาบันทึกเลขที่ใบสั่งซื้อ (PO) ก่อนแนบไฟล์')
        if (!selectedFile) throw new Error('กรุณาเลือกไฟล์ PO')
        setPendingAction('upload')
        const preparedFile = await preparePoFile(selectedFile)
        const formData = new FormData()
        formData.set('file', preparedFile, preparedFile.name)
        await uploadPurchaseRequestPoFile(requestId, formData)
        setSelectedFile(null)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'อัปโหลดไฟล์ PO ไม่สำเร็จ')
      } finally {
        setPendingAction(null)
      }
    })
  }

  const open = () => {
    if (!file.path) return
    setError(null)
    setPendingAction('open')
    startTransition(async () => {
      try {
        const signedUrl = await getPurchaseRequestPoFileUrl(requestId)
        if (!signedUrl) throw new Error('ไม่พบไฟล์ PO ที่เปิดดูได้')
        setPreviewUrl(signedUrl)
        previewDialogRef.current?.showModal()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปิดไฟล์ PO ไม่สำเร็จ')
      } finally {
        setPendingAction(null)
      }
    })
  }

  const retry = () => {
    setError(null)
    setPendingAction('retry')
    startTransition(async () => {
      try {
        await retryPurchaseRequestPoFileCleanup(requestId)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ล้างไฟล์ PO ไม่สำเร็จ')
      } finally {
        setPendingAction(null)
      }
    })
  }

  const closePreview = () => {
    previewDialogRef.current?.close()
    setPreviewUrl(null)
  }

  const uploadForm = canEdit && poNumber ? (
    <form className={isInline ? 'po-file-card__inline-form' : 'po-file-card__form'} onSubmit={submit}>
      {isInline ? (
        <PoFileDropzone
          compact
          file={selectedFile}
          onChange={setSelectedFile}
          disabled={isPending}
        />
      ) : (
        <div className="field-row">
          <span>ไฟล์ PO</span>
          <PoFileDropzone file={selectedFile} onChange={setSelectedFile} disabled={isPending} />
        </div>
      )}
      {(!isInline || selectedFile) && (
        <Button type="submit" variant="secondary" disabled={isPending || !selectedFile}>
          {pendingAction === 'upload' ? 'กำลังอัปโหลด…' : hasActiveFile ? 'อัปโหลดแทนไฟล์เดิม' : 'แนบไฟล์ PO'}
        </Button>
      )}
    </form>
  ) : null

  const fileActions = file.path || isCleanupPending ? (
    <div className="po-file-card__actions">
      {file.path && (
        <Button variant="ghost" onClick={open} disabled={isPending}>
          {pendingAction === 'open' ? 'กำลังเปิด…' : 'เปิดไฟล์ PO'}
        </Button>
      )}
      {isCleanupPending && (
        <Button variant="secondary" onClick={retry} disabled={isPending}>
          {pendingAction === 'retry' ? 'กำลังล้างไฟล์…' : 'ลองล้างไฟล์อีกครั้ง'}
        </Button>
      )}
    </div>
  ) : null

  const fileControls = isDeleted ? (
    <p className="po-file-card__audit">
      ลบเมื่อ {formatThaiDateTime(file.deletedAt)} โดย {file.deletedByName ?? 'เจ้าหน้าที่คลัง'}
    </p>
  ) : (
    <>
      {canEdit && !poNumber && (
        <p className="po-file-card__hint" role="note">
          กรุณาบันทึกเลขที่ใบสั่งซื้อ (PO) ก่อนแนบไฟล์
        </p>
      )}

      {uploadForm}
      {fileActions}

      {isCleanupPending && (
        <p className="po-file-card__pending-note" role="status">
          ใบ PR อยู่ในสถานะสิ้นสุดแล้ว ระบบจะลบไฟล์ PO ออกจากพื้นที่จัดเก็บ เหลือไว้เฉพาะประวัติการแนบไฟล์
        </p>
      )}
    </>
  )

  const fileStatus = isInline ? (
    <span className="po-file-card__inline-status" role={state === 'pending' ? 'status' : undefined}>
      <StatusChip tone={statusTone}>{statusLabel}</StatusChip>
    </span>
  ) : (
    <p className="po-file-card__status" role={state === 'pending' ? 'status' : undefined}>
      {statusLabel}
    </p>
  )

  const fileError = error && <p className="form-error po-file-card__error" role="alert">{error}</p>

  return (
    <>
      {isInline ? (
        <div className="po-file-card po-file-card--inline" data-po-file-state={state} role="group" aria-label="การจัดการไฟล์ PO">
          <div className="po-file-card__inline-summary">
            {fileStatus}
            {file.fileName && (
              <span className="po-file-card__inline-file" title={file.fileName}>
                {file.fileName}
                {file.sizeBytes !== null && ` · ${formatPoFileSize(file.sizeBytes)}`}
              </span>
            )}
          </div>
          <div className="po-file-card__inline-controls">
            {fileControls}
            {fileError}
          </div>
        </div>
      ) : (
        <section className="bench-panel po-file-card" data-po-file-state={state} aria-labelledby="pr-po-file-title">
          <div className="bench-panel__header po-file-card__header">
            <div>
              <p className="section-kicker">PO DOCUMENT</p>
              <h2 id="pr-po-file-title">เอกสารใบสั่งซื้อ (PO)</h2>
            </div>
            {fileStatus}
          </div>

          <div className="po-file-card__body">
            <dl className="po-file-card__facts">
              <div>
                <dt>เลขที่ใบสั่งซื้อ (PO)</dt>
                <dd className="identifier">{poNumber ?? 'ยังไม่มีเลขที่ใบสั่งซื้อ (PO)'}</dd>
              </div>
              {file.fileName && (
                <div>
                  <dt>ไฟล์</dt>
                  <dd>
                    <strong className="po-file-card__filename">{file.fileName}</strong>
                    {file.sizeBytes !== null && <small>{formatPoFileSize(file.sizeBytes)}</small>}
                  </dd>
                </div>
              )}
            </dl>

            {fileControls}
            {fileError}
          </div>
        </section>
      )}

      <dialog
        ref={previewDialogRef}
        className="app-dialog file-preview-dialog"
        aria-labelledby="pr-po-file-preview-title"
        onCancel={(event) => {
          event.preventDefault()
          closePreview()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePreview()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="pr-po-file-preview-title">ไฟล์ PO</h2>
            <p>แสดงเอกสารจากที่จัดเก็บส่วนตัวในหน้ารายละเอียดใบ PR</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดตัวอย่างไฟล์ PO" onClick={closePreview}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="app-dialog__body file-preview-dialog__body">
          {previewUrl && <iframe title="ตัวอย่างไฟล์ PO" src={previewUrl} />}
        </div>
      </dialog>
    </>
  )
}

export function PurchaseRequestPoFileOpenButton({ requestId }: { requestId: string }) {
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const open = () => {
    setError(null)
    startTransition(async () => {
      try {
        const signedUrl = await getPurchaseRequestPoFileUrl(requestId)
        if (!signedUrl) throw new Error('ไม่พบไฟล์ PO ที่เปิดดูได้')
        setPreviewUrl(signedUrl)
        previewDialogRef.current?.showModal()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปิดไฟล์ PO ไม่สำเร็จ')
      }
    })
  }

  const closePreview = () => {
    previewDialogRef.current?.close()
    setPreviewUrl(null)
  }

  return (
    <>
      <div className="po-file-open-action">
        <Button
          variant="secondary"
          className="po-file-open-button"
          onClick={open}
          disabled={isPending}
        >
          <svg className="po-file-open-button__icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 3.5h9l5 5v12H5z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {isPending ? 'กำลังเปิด…' : 'เปิดไฟล์ PO'}
        </Button>
        {error && <p className="form-error po-file-open-action__error" role="alert">{error}</p>}
      </div>

      <dialog
        ref={previewDialogRef}
        className="app-dialog file-preview-dialog"
        aria-labelledby="pr-po-file-open-preview-title"
        onCancel={(event) => {
          event.preventDefault()
          closePreview()
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) closePreview()
        }}
      >
        <header className="app-dialog__header">
          <div>
            <h2 id="pr-po-file-open-preview-title">ไฟล์ PO</h2>
            <p>แสดงเอกสารจากที่จัดเก็บส่วนตัวในหน้ารายละเอียดใบ PR</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดตัวอย่างไฟล์ PO" onClick={closePreview}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="app-dialog__body file-preview-dialog__body">
          {previewUrl && <iframe title="ตัวอย่างไฟล์ PO" src={previewUrl} />}
        </div>
      </dialog>
    </>
  )
}
