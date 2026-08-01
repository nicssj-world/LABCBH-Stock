'use client'

import { useRef, useState, useTransition, type ChangeEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  contractFileUrl,
  removeContractFile,
  uploadContractFile,
} from '@/lib/contracts/file-actions'

export interface ContractFileCardProps {
  contractId: number
  filePath: string | null
  canEdit: boolean
}

export function ContractFileCard({ contractId, filePath, canEdit }: ContractFileCardProps) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const previewDialogRef = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [openUrl, setOpenUrl] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'upload' | 'open' | 'remove' | null>(null)
  const [isPending, startTransition] = useTransition()

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setPendingAction('upload')
    const formData = new FormData()
    formData.set('file', file)

    startTransition(async () => {
      try {
        await uploadContractFile(contractId, formData)
        setOpenUrl(null)
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'อัปโหลดไฟล์สัญญาไม่สำเร็จ')
      } finally {
        event.target.value = ''
        setPendingAction(null)
      }
    })
  }

  const open = () => {
    if (!filePath) return
    setError(null)
    setPendingAction('open')
    startTransition(async () => {
      try {
        const signedUrl = await contractFileUrl(contractId, filePath)
        setOpenUrl(signedUrl)
        previewDialogRef.current?.showModal()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'เปิดไฟล์สัญญาไม่สำเร็จ')
      } finally {
        setPendingAction(null)
      }
    })
  }

  const closePreview = () => {
    previewDialogRef.current?.close()
    setOpenUrl(null)
  }

  const detach = () => {
    setError(null)
    setPendingAction('remove')
    startTransition(async () => {
      try {
        await removeContractFile(contractId)
        closePreview()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'ลบไฟล์สัญญาไม่สำเร็จ')
      } finally {
        setPendingAction(null)
      }
    })
  }

  return (
    <div className="contract-file-card" data-has-file={filePath ? 'true' : 'false'}>
      <div className="contract-file-card__document">
        <span className="contract-file-card__document-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M6 3h8l4 4v14H6zM14 3v5h5M9 14h6M9 17h6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <p>
          <strong>{filePath ? 'แนบไฟล์สัญญาแล้ว' : 'ยังไม่ได้แนบไฟล์สัญญา'}</strong>
          <small>{filePath ? 'เปิดดูไฟล์ในหน้านี้ได้ทันที' : 'รองรับ PDF, JPG, PNG และ WEBP'}</small>
        </p>
      </div>

      <div className="contract-file-card__controls" aria-label="จัดการไฟล์สัญญา">
        {canEdit && (
          <>
            <input
              ref={fileInputRef}
              className="contract-file-card__input"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={upload}
              tabIndex={-1}
            />
            <Button
              variant="ghost"
              className="contract-file-control"
              aria-label={filePath ? 'อัปโหลดแทนไฟล์สัญญาเดิม' : 'อัปโหลดไฟล์สัญญา'}
              title={filePath ? 'อัปโหลดแทนไฟล์เดิม' : 'อัปโหลดไฟล์สัญญา'}
              disabled={isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {pendingAction === 'upload' ? <span className="contract-file-control__spinner" aria-hidden="true" /> : (
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                  <path d="M12 15V3m0 0L8 7m4-4 4 4M5 14v5h14v-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </Button>
          </>
        )}
        {filePath && (
          <Button
            variant="ghost"
            className="contract-file-control contract-file-control--view"
            aria-label="เปิดดูไฟล์สัญญา"
            title="เปิดดูไฟล์สัญญา"
            disabled={isPending}
            onClick={open}
          >
            {pendingAction === 'open' ? <span className="contract-file-control__spinner" aria-hidden="true" /> : (
              <svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </Button>
        )}
        {canEdit && filePath && (
          <Button
            variant="ghost"
            className="contract-file-control contract-file-control--remove"
            aria-label="นำไฟล์สัญญาออก"
            title="นำไฟล์สัญญาออก"
            disabled={isPending}
            onClick={detach}
          >
            {pendingAction === 'remove' ? <span className="contract-file-control__spinner" aria-hidden="true" /> : (
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="M4 7h16M10 11v6m4-6v6M9 7l1-3h4l1 3m-9 0 1 13h10l1-13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </Button>
        )}
      </div>

      {error && <p className="form-error contract-file-card__error" role="alert">{error}</p>}

      <dialog
        ref={previewDialogRef}
        className="app-dialog contract-file-preview-dialog"
        aria-labelledby="contract-file-preview-title"
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
            <h2 id="contract-file-preview-title">ไฟล์สัญญา</h2>
            <p>แสดงเอกสารจากที่จัดเก็บส่วนตัวในหน้ารายละเอียดนี้</p>
          </div>
          <button type="button" className="app-dialog__close" aria-label="ปิดตัวอย่างไฟล์สัญญา" onClick={closePreview}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="app-dialog__body contract-file-preview-dialog__body">
          {openUrl && <iframe title="ตัวอย่างไฟล์สัญญา" src={openUrl} />}
        </div>
      </dialog>
    </div>
  )
}
