'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Button'
import { useDeferredDialog } from '@/components/ui/useDeferredDialog'
import { formatQuantity } from '@/lib/inventory/presenter'
import { receiveRequisition, saveDrawnSignature } from '@/lib/requisitions/actions'
import type { RequisitionItemRecord } from '@/lib/requisitions/types'
import { SignaturePad } from './SignaturePad'

interface RequisitionReceiptDialogProps {
  requisitionId: string
  items: RequisitionItemRecord[]
  actorName: string | null
  signaturePreview: string | null
  portalProfileHref: string
  triggerClassName?: string
}

export function RequisitionReceiptDialog({
  requisitionId,
  items,
  actorName,
  signaturePreview,
  portalProfileHref,
  triggerClassName = '',
}: RequisitionReceiptDialogProps) {
  const router = useRouter()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const wasRenderedRef = useRef(false)
  const { dialogRef, isRendered, open: openDialog, unmount: unmountDialog } = useDeferredDialog()
  const [signature, setSignature] = useState(signaturePreview)
  const [drawnSignature, setDrawnSignature] = useState<string | null>(null)
  const [isReplacingSignature, setIsReplacingSignature] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSavingSignature, setIsSavingSignature] = useState(false)
  const [isReceiving, setIsReceiving] = useState(false)
  const signaturePreviewRef = useRef(signaturePreview)

  const dialogId = `requisition-receipt-dialog-${requisitionId}`
  const titleId = `${dialogId}-title`
  const descriptionId = `${dialogId}-description`
  const signatureHelpId = `${dialogId}-signature-help`
  const isPending = isSavingSignature || isReceiving

  useEffect(() => {
    if (signaturePreview === signaturePreviewRef.current) return
    signaturePreviewRef.current = signaturePreview
    setSignature(signaturePreview)
  }, [signaturePreview])

  useEffect(() => {
    if (isRendered) {
      wasRenderedRef.current = true
      window.requestAnimationFrame(() => closeRef.current?.focus())
      return
    }

    if (wasRenderedRef.current) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
  }, [isRendered])

  const closeDialog = () => {
    if (isPending) return
    setError(null)
    setDrawnSignature(null)
    setIsReplacingSignature(false)
    unmountDialog()
  }

  const startSignatureReplacement = () => {
    if (isPending) return
    setError(null)
    setDrawnSignature(null)
    setIsReplacingSignature(true)
  }

  const keepExistingSignature = () => {
    if (isPending) return
    setError(null)
    setDrawnSignature(null)
    setIsReplacingSignature(false)
  }

  const saveSignature = async () => {
    if (!drawnSignature) {
      setError('กรุณาวาดลายเซ็นต์ก่อนบันทึก')
      return
    }

    setError(null)
    setIsSavingSignature(true)
    try {
      const saved = await saveDrawnSignature(requisitionId, { signature: drawnSignature })
      setSignature(saved.signature)
      setDrawnSignature(null)
      setIsReplacingSignature(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกลายเซ็นต์ไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setIsSavingSignature(false)
    }
  }

  const confirmReceipt = async () => {
    if (isReplacingSignature) {
      setError('กรุณาบันทึกลายเซ็นต์ใหม่ หรือเลือกใช้ลายเซ็นต์เดิมก่อนยืนยัน')
      return
    }

    if (!signature || !actorName?.trim()) {
      setError('ต้องมีลายเซ็นต์และชื่อผู้ตรวจรับจาก Portal ก่อนยืนยัน')
      return
    }

    setError(null)
    setIsReceiving(true)
    try {
      await receiveRequisition(requisitionId)
      unmountDialog()
      router.refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ยืนยันตรวจรับของไม่สำเร็จ กรุณาลองใหม่')
    } finally {
      setIsReceiving(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`lab-button lab-button--primary ${triggerClassName}`.trim()}
        aria-haspopup="dialog"
        aria-controls={isRendered ? dialogId : undefined}
        onClick={openDialog}
      >
        ตรวจรับของ
      </button>

      {isRendered && createPortal(
        <dialog
          ref={dialogRef}
          id={dialogId}
          className="app-dialog requisition-receipt-dialog"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          onCancel={(event) => {
            event.preventDefault()
            closeDialog()
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeDialog()
          }}
        >
          <header className="app-dialog__header">
            <div>
              <h2 id={titleId}>ตรวจรับของ</h2>
              <p id={descriptionId}>
                ตรวจสอบจำนวนที่ได้รับจริงและยืนยันด้วยลายเซ็นต์ประจำตัวจาก Portal
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              className="app-dialog__close"
              aria-label="ปิดหน้าต่างตรวจรับของ"
              onClick={closeDialog}
              disabled={isPending}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div className="app-dialog__body requisition-receipt-dialog__body">
            <section className="requisition-receipt-dialog__items" aria-labelledby={`${dialogId}-items-title`}>
              <div className="requisition-receipt-dialog__section-heading">
                <div>
                  <p className="section-kicker">RECEIPT CHECK</p>
                  <h3 id={`${dialogId}-items-title`}>รายการและจำนวนที่จ่ายจริง</h3>
                </div>
                <span>{items.length} รายการ</span>
              </div>
              <ul className="requisition-receipt-dialog__item-list">
                {items.map((item) => (
                  <li key={item.id} className="requisition-receipt-dialog__item">
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.lsCode}</small>
                      {item.shortIssueReason && (
                        <p className="requisition-receipt-dialog__reason">
                          เหตุผลจ่ายไม่ครบ: {item.shortIssueReason}
                        </p>
                      )}
                    </div>
                    <dl className="requisition-receipt-dialog__quantities">
                      <div>
                        <dt>ขอเบิก</dt>
                        <dd>{formatQuantity(item.requestedQuantity, item.unit)}</dd>
                      </div>
                      <div>
                        <dt>จ่ายจริง</dt>
                        <dd>{formatQuantity(item.fulfilledQuantity ?? 0, item.unit)}</dd>
                      </div>
                    </dl>
                  </li>
                ))}
              </ul>
            </section>

            <section className="requisition-receipt-dialog__signature" aria-labelledby={`${dialogId}-signature-title`}>
              <div className="requisition-receipt-dialog__section-heading">
                <div>
                  <p className="section-kicker">PORTAL SIGNATURE</p>
                  <h3 id={`${dialogId}-signature-title`}>ลายเซ็นต์ผู้ตรวจรับ</h3>
                </div>
                {signature && <span className="requisition-receipt-dialog__ready">พร้อมยืนยัน</span>}
              </div>

              {signature ? (
                <>
                  <div className="requisition-receipt-dialog__signature-preview">
                    {/* eslint-disable-next-line @next/next/no-img-element -- the private Portal signature is sent as an in-memory data URI */}
                    <img src={signature} alt="ลายเซ็นต์ประจำตัวจาก Portal" />
                    <p>ใช้ลายเซ็นต์ประจำตัวที่บันทึกไว้ใน Portal</p>
                  </div>
                  {isReplacingSignature ? (
                    <div className="requisition-receipt-dialog__signature-replacement">
                      <div className="requisition-receipt-dialog__signature-notice">
                        <strong>กำลังวาดลายเซ็นต์ใหม่</strong>
                        <p>
                          เมื่อบันทึก ระบบจะบันทึกลายเซ็นต์ใหม่นี้ทับลายเซ็นต์เดิมใน Portal
                        </p>
                      </div>
                      <SignaturePad
                        onChange={setDrawnSignature}
                        disabled={isPending}
                      />
                      <p id={signatureHelpId} className="form-field-note">
                        ลายเซ็นต์ใหม่จะเป็นลายเซ็นต์ประจำตัวของคุณใน Portal และใช้กับการตรวจรับครั้งต่อไป
                      </p>
                      <div className="requisition-receipt-dialog__signature-replacement-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={keepExistingSignature}
                          disabled={isPending}
                        >
                          ใช้ลายเซ็นต์เดิม
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={saveSignature}
                          disabled={isPending || !drawnSignature}
                          aria-describedby={signatureHelpId}
                        >
                          {isSavingSignature ? 'กำลังบันทึกลายเซ็นต์…' : 'บันทึกลายเซ็นต์ใหม่แทนของเดิม'}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="requisition-receipt-dialog__signature-existing-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={startSignatureReplacement}
                        disabled={isPending}
                      >
                        วาดลายเซ็นต์ใหม่
                      </Button>
                      <p>
                        หากต้องการเปลี่ยน ลายเซ็นต์ใหม่จะถูกบันทึกทับลายเซ็นต์เดิมใน Portal
                      </p>
                    </div>
                  )}
                </>
              ) : (
                <div className="requisition-receipt-dialog__signature-fallback">
                  <div className="requisition-receipt-dialog__signature-notice">
                    <strong>ยังไม่มีลายเซ็นต์ใน Portal</strong>
                    <p>
                      วาดลายเซ็นต์ด้านล่างเพื่อบันทึกเป็นลายเซ็นต์ประจำตัวใน Portal ก่อนตรวจรับของ
                    </p>
                    <a className="text-link" href={portalProfileHref} target="_blank" rel="noreferrer">
                      เปิด Portal: จัดการโปรไฟล์ที่ /staff/profile
                    </a>
                  </div>
                  <SignaturePad
                    onChange={setDrawnSignature}
                    disabled={isPending}
                  />
                  <p id={signatureHelpId} className="form-field-note">
                    ลายเซ็นต์ที่บันทึกจะเป็นลายเซ็นต์ประจำตัวของคุณใน Portal และใช้กับการตรวจรับครั้งต่อไป
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={saveSignature}
                    disabled={isPending || !drawnSignature}
                    aria-describedby={signatureHelpId}
                  >
                    {isSavingSignature ? 'กำลังบันทึกลายเซ็นต์…' : 'บันทึกลายเซ็นต์'}
                  </Button>
                </div>
              )}
            </section>

            {error && <p className="form-error" role="alert">{error}</p>}

            <div className="requisition-receipt-dialog__receiver">
              <span>ผู้ตรวจรับ</span>
              <strong>{actorName || 'ไม่พบชื่อใน Portal'}</strong>
            </div>
          </div>

          <footer className="requisition-receipt-dialog__actions">
            <Button variant="secondary" type="button" onClick={closeDialog} disabled={isPending}>
              ปิด
            </Button>
            <Button
              type="button"
              onClick={confirmReceipt}
              disabled={isPending || isReplacingSignature || !signature || !actorName?.trim()}
              aria-describedby={signature && !isReplacingSignature ? undefined : signatureHelpId}
            >
              {isReceiving ? 'กำลังยืนยันตรวจรับ…' : 'ยืนยันตรวจรับของ'}
            </Button>
          </footer>
        </dialog>,
        document.body,
      )}
    </>
  )
}
