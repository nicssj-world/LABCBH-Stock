'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { PurchaseRequestLineNotifyButton } from '@/components/pr/PurchaseRequestLineNotifyButton'
import {
  PurchaseRequestRemainingClosePanel,
  PurchaseRequestShortClosedAudit,
} from '@/components/pr/PurchaseRequestRemainingClosePanel'
import { PurchaseRequestPoFileCard } from '@/components/pr/PurchaseRequestPoFileCard'
import { ThaiDateInput } from '@/components/ui/ThaiDateInput'
import { bangkokIsoDate } from '@/lib/date/thai'
import { CONTRACT_TYPE_LABELS } from '@/lib/contracts/presenter'
import type { ContractType } from '@/lib/contracts/types'
import { formatQuantity, formatThaiDateTime } from '@/lib/inventory/presenter'
import {
  confirmPurchaseRequest,
  reversePurchaseRequest,
  setEphisPrNumber,
  setPurchaseOrderNumber,
} from '@/lib/pr/actions'
import { formatBaht } from '@/lib/pr/presenter'
import { contractTypeForMethod } from '@/lib/pr/schema'
import type { PurchaseRequestLineNotificationSummary, PurchaseRequestRecord } from '@/lib/pr/types'

interface ContractDraftDetails {
  fiscalYear: number
  displayName: string
  vendor: string | null
  /** Only present for an equipment-lease draft — the ceiling budget.ts calls "ไม่ระบุ" when null. */
  total: number | null
}

/** `methodDetails` is read as unknown JSON; this reads back only the shape a
 *  contract-originating PR is guaranteed to carry, per contractDraftSchema. */
function readContractDraft(methodDetails: Record<string, unknown>): ContractDraftDetails | null {
  const draft = methodDetails.contractDraft
  if (!draft || typeof draft !== 'object') return null
  const { fiscalYear, displayName, vendor, total } = draft as Record<string, unknown>
  if (typeof fiscalYear !== 'number' || typeof displayName !== 'string') return null
  return {
    fiscalYear,
    displayName,
    vendor: typeof vendor === 'string' ? vendor : null,
    total: typeof total === 'number' ? total : null,
  }
}

export function PrReviewPanel({
  request,
  lineNotification = null,
  lineNotificationConfigured = false,
  checklistReadyForConfirmation = true,
}: {
  request: PurchaseRequestRecord
  lineNotification?: PurchaseRequestLineNotificationSummary | null
  lineNotificationConfigured?: boolean
  checklistReadyForConfirmation?: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')
  const [poNumber, setPoNumber] = useState(request.poNumber ?? '')
  const [ephisPrNumberInput, setEphisPrNumberInput] = useState(request.ephisPrNumber ?? '')
  // Once a number is saved, the field locks — "แก้ไข" is a deliberate second
  // step before it can be typed over again.
  const [isEditingEphisPrNumber, setIsEditingEphisPrNumber] = useState(!request.ephisPrNumber)
  const [isEditingPoNumber, setIsEditingPoNumber] = useState(!request.poNumber)
  const [sentToProcurementDate, setSentToProcurementDate] = useState(() => bangkokIsoDate())
  const [isPending, startTransition] = useTransition()

  const contractType: ContractType | null = contractTypeForMethod(request.purchaseMethod)
  const contractDraft = contractType ? readContractDraft(request.methodDetails) : null
  const canEditPoNumber = !contractType && ['completed', 'partially_received'].includes(request.status)
  const hasActivePoFile = Boolean(request.poNumber && request.poFile.path && !request.poFile.deletedAt)
  const showPoWorkbench =
    (!contractType && ['completed', 'partially_received', 'received', 'closed_short'].includes(request.status)) ||
    hasActivePoFile
  const hasDraftReceipt = request.receiptHistory.some((receipt) => receipt.status === 'draft')
  const hasPostedReceipt = request.receiptHistory.some((receipt) => receipt.status === 'posted')
  const receiptBlocksReversal = hasDraftReceipt || hasPostedReceipt

  const run = (operation: () => Promise<unknown>, fallback: string, onSuccess?: () => void) => {
    setError(null)
    startTransition(async () => {
      try {
        await operation()
        onSuccess?.()
        router.refresh()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : fallback)
      }
    })
  }

  return (
    <div className="pr-review">
      <section className="pr-review__section" aria-labelledby="pr-review-reference-title">
        <div className="pr-review__section-heading">
          <div>
            <h3 id="pr-review-reference-title">ข้อมูลอ้างอิง</h3>
            <p className="pr-review__intro">บันทึกเลขจากระบบ E-Phis เพื่อใช้ติดตามใบ PR</p>
          </div>
        </div>
        <div className="pr-review__identifier-row">
          <label className="field-row pr-review__identifier-field">
            <span>เลข PR จาก E-Phis</span>
            <input
              type="text"
              readOnly={!isEditingEphisPrNumber}
              value={ephisPrNumberInput}
              onChange={(event) => setEphisPrNumberInput(event.target.value)}
            />
          </label>
          <div className="pr-review__identifier-actions">
            <Button
              variant="secondary"
              type="button"
              className="pr-review__number-action"
              disabled={isPending || (isEditingEphisPrNumber && !ephisPrNumberInput.trim())}
              onClick={() => {
                if (!isEditingEphisPrNumber) {
                  setIsEditingEphisPrNumber(true)
                  return
                }
                run(
                  () => setEphisPrNumber(request.id, { ephisPrNumber: ephisPrNumberInput }),
                  'บันทึกเลข PR จาก E-Phis ไม่สำเร็จ',
                  () => setIsEditingEphisPrNumber(false),
                )
              }}
            >
              {isEditingEphisPrNumber ? 'บันทึกเลข PR จาก E-Phis' : 'แก้เลข PR จาก E-Phis'}
            </Button>
            {request.ephisPrNumber && request.updatedByName && (
              <p className="pr-review__intro">บันทึกโดย {request.updatedByName}</p>
            )}
          </div>
        </div>
      </section>

      {showPoWorkbench && (
        <section className="pr-review__section" aria-labelledby="pr-review-po-title">
          <div className="pr-review__section-heading">
            <div>
              <h3 id="pr-review-po-title">ข้อมูลใบสั่งซื้อ</h3>
              <p className="pr-review__intro">เลขที่ใบสั่งซื้อและเอกสารประกอบ</p>
            </div>
          </div>
          <div className="pr-review__po-workbench">
          {canEditPoNumber && (
            <div className="pr-review__po-number">
              <label className="field-row pr-review__identifier-field">
                เลขที่ใบสั่งซื้อ (PO)
                <input
                  type="text"
                  readOnly={!isEditingPoNumber}
                  value={poNumber}
                  onChange={(event) => setPoNumber(event.target.value)}
                />
              </label>
              <div className="pr-review__actions">
                <div className="pr-review__actions-buttons">
                  <Button
                    variant="secondary"
                    type="button"
                    className="pr-review__number-action"
                    disabled={isPending || (isEditingPoNumber && !poNumber.trim())}
                    onClick={() => {
                      if (!isEditingPoNumber) {
                        setIsEditingPoNumber(true)
                        return
                      }
                      run(
                        () => setPurchaseOrderNumber(request.id, { poNumber }),
                        'บันทึกเลขที่ใบสั่งซื้อ (PO) ไม่สำเร็จ',
                        () => setIsEditingPoNumber(false),
                      )
                    }}
                  >
                    {isEditingPoNumber ? 'บันทึกเลขที่ใบสั่งซื้อ (PO)' : 'แก้ไขเลขที่ใบสั่งซื้อ (PO)'}
                  </Button>
                </div>
                {request.poNumber && request.updatedByName && (
                  <p className="pr-review__intro">บันทึกเลขที่ใบสั่งซื้อ (PO) โดย {request.updatedByName}</p>
                )}
              </div>
            </div>
          )}

          <div className="pr-review__po-file">
            <div className="pr-review__po-file-heading">
              <div className="pr-review__po-file-heading-copy">
                <strong>เอกสารใบสั่งซื้อ (PO)</strong>
                <span>PDF, JPG, PNG หรือ WEBP · ไม่เกิน 10 MB</span>
              </div>
              {request.poNumber && request.poFile.path && !request.poFile.deletedAt && (
                <PurchaseRequestLineNotifyButton
                  requestId={request.id}
                  documentNumber={request.documentNumber}
                  poNumber={request.poNumber}
                  latest={lineNotification}
                  configured={lineNotificationConfigured}
                />
              )}
            </div>
            <PurchaseRequestPoFileCard
              requestId={request.id}
              poNumber={request.poNumber}
              file={request.poFile}
              variant="inline"
              canEdit={canEditPoNumber}
              canRetryCleanup={
                ['received', 'closed_short'].includes(request.status) &&
                !request.poFile.deletedAt &&
                Boolean(request.poFile.path)
              }
            />
          </div>
          </div>
        </section>
      )}

      {request.status === 'pending' && contractType && contractDraft && (
        <section className="pr-review__section pr-review__section--decision" aria-labelledby="pr-review-contract-title">
          <div className="pr-review__section-heading">
            <div>
              <h3 id="pr-review-contract-title">ยืนยันและสร้างสัญญา</h3>
              <p className="pr-review__intro">
                ยืนยันแล้วระบบจะสร้างสัญญาใหม่ทันทีที่ขั้นตอน &quot;ส่งพัสดุ&quot; — ย้อนกลับไม่ได้ด้วยการกลับรายการ
              </p>
            </div>
          </div>
          <dl className="item-picker__facts">
            <div>
              <dt>ประเภทสัญญา</dt>
              <dd>{CONTRACT_TYPE_LABELS[contractType]}</dd>
            </div>
            <div>
              <dt>ชื่อสัญญา</dt>
              <dd>{contractDraft.displayName}</dd>
            </div>
            <div>
              <dt>คู่สัญญา</dt>
              <dd>{contractDraft.vendor ?? 'ไม่ระบุ'}</dd>
            </div>
            <div>
              <dt>ปีงบประมาณ</dt>
              <dd>{contractDraft.fiscalYear}</dd>
            </div>
            {contractType === 'equipment_lease' ? (
              <div>
                <dt>มูลค่าสัญญา</dt>
                <dd>{contractDraft.total === null ? 'ไม่ระบุ' : formatBaht(contractDraft.total)}</dd>
              </div>
            ) : (
              <>
                <div>
                  <dt>จำนวนรายการ</dt>
                  <dd>{formatQuantity(request.items.length)} รายการ</dd>
                </div>
                <div>
                  <dt>มูลค่ารวม</dt>
                  <dd>{formatBaht(request.total)}</dd>
                </div>
              </>
            )}
          </dl>

          <label className="field-row">
            วันที่ส่งพัสดุ
            <ThaiDateInput required value={sentToProcurementDate} onChange={setSentToProcurementDate} />
          </label>

          <div className="pr-review__confirm-zone">
            {!checklistReadyForConfirmation && (
              <div className="pr-review__blocker" role="status">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M10 2.25 18 17.5H2L10 2.25Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
                  <path d="M10 7v4.5M10 14.25v.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                </svg>
                <div>
                  <strong>ยังยืนยันใบ PR ไม่ได้</strong>
                  <p>กรรมการอย่างน้อยหนึ่งคนยังไม่มีตำแหน่งในข้อมูลบุคลากร กรุณาแก้ที่ระบบบุคลากรแล้วโหลดหน้าใหม่</p>
                </div>
              </div>
            )}
            <Button
              type="button"
              disabled={isPending || !sentToProcurementDate || !checklistReadyForConfirmation}
              onClick={() =>
                run(
                  () => confirmPurchaseRequest(request.id, sentToProcurementDate),
                  'ยืนยันใบ PR ไม่สำเร็จ',
                )
              }
            >
              {isPending ? 'กำลังยืนยัน…' : 'ยืนยันและสร้างสัญญา'}
            </Button>
          </div>
        </section>
      )}

      {request.status === 'pending' && !(contractType && contractDraft) && (
        <section className="pr-review__section pr-review__section--decision" aria-labelledby="pr-review-impact-title">
          <div className="pr-review__section-heading">
            <div>
              <h3 id="pr-review-impact-title">ผลกระทบต่อยอดสัญญา</h3>
              <p className="pr-review__intro">
                ยืนยันแล้วยอดในสัญญาจะถูกตัดทันทีและย้อนกลับได้ด้วยการกลับรายการเท่านั้น
              </p>
            </div>
          </div>
          <div className="detail-items-table">
            <table className="data-table">
              <caption className="visually-hidden">ผลกระทบต่อยอดคงเหลือในสัญญา</caption>
              <thead>
                <tr>
                  <th>รายการ</th>
                  <th className="numeric-cell">คงเหลือปัจจุบัน</th>
                  <th className="numeric-cell">ขอตัด</th>
                  <th className="numeric-cell">คงเหลือหลังยืนยัน</th>
                </tr>
              </thead>
              <tbody>
                {request.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small className="identifier">{item.lsCode}</small>
                    </td>
                    <td className="numeric-cell identifier">
                      {item.contractRemaining === null
                        ? 'ไม่ตัดยอดสัญญา'
                        : formatQuantity(item.contractRemaining, item.unit)}
                    </td>
                    <td className="numeric-cell identifier">
                      {formatQuantity(item.requestedQuantity, item.unit)}
                    </td>
                    <td className="numeric-cell identifier">
                      {item.contractRemaining === null ? (
                        '—'
                      ) : (
                        <strong>
                          {formatQuantity(item.contractRemaining - item.requestedQuantity, item.unit)}
                        </strong>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pr-review__confirm-zone">
            {!checklistReadyForConfirmation && (
              <div className="pr-review__blocker" role="status">
                <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                  <path d="M10 2.25 18 17.5H2L10 2.25Z" fill="none" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
                  <path d="M10 7v4.5M10 14.25v.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
                </svg>
                <div>
                  <strong>ยังยืนยันใบ PR ไม่ได้</strong>
                  <p>กรรมการอย่างน้อยหนึ่งคนยังไม่มีตำแหน่งในข้อมูลบุคลากร กรุณาแก้ที่ระบบบุคลากรแล้วโหลดหน้าใหม่</p>
                </div>
              </div>
            )}
            <Button
              type="button"
              disabled={isPending || !checklistReadyForConfirmation}
              onClick={() => run(() => confirmPurchaseRequest(request.id), 'ยืนยันใบ PR ไม่สำเร็จ')}
            >
              {isPending ? 'กำลังยืนยัน…' : 'ยืนยันใบ PR'}
            </Button>
          </div>
        </section>
      )}

      {request.status === 'completed' && (
        <>
          <div className="pr-review__actions">
            <div className="pr-review__actions-buttons">
              {!reversing && !receiptBlocksReversal && (
                <Button variant="ghost" type="button" onClick={() => setReversing(true)}>
                  กลับรายการใบ PR
                </Button>
              )}
            </div>
            <div className="pr-review__meta">
              <p className="pr-review__intro">
                ยืนยันโดย {request.acknowledgedByName ?? 'เจ้าหน้าที่คลัง'} · {formatThaiDateTime(request.acknowledgedAt)}
              </p>
              {hasDraftReceipt && (
                <p className="pr-review__intro">ต้องยกเลิกใบรับเข้าฉบับร่างก่อน จึงจะกลับรายการใบ PR ได้</p>
              )}
              {hasPostedReceipt && (
                <p className="pr-review__intro">ไม่สามารถกลับรายการใบ PR ที่มีใบรับเข้า Posted แล้ว</p>
              )}
            </div>
          </div>

          {reversing && (
            <div className="decision-panel decision-panel--danger">
              <div>
                <strong>ยืนยันการกลับรายการ</strong>
                <p>ระบบจะบันทึกรายการตรงข้ามเพื่อคืนยอดสัญญา โดยไม่ลบประวัติเดิม</p>
              </div>
              <label>
                เหตุผลในการกลับรายการ
                <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
              </label>
              <div className="decision-panel__actions">
                <Button variant="secondary" type="button" onClick={() => setReversing(false)} disabled={isPending}>
                  กลับไปตรวจสอบ
                </Button>
                <Button
                  variant="danger"
                  type="button"
                  disabled={isPending || !reason.trim()}
                  onClick={() =>
                    run(
                      () => reversePurchaseRequest(request.id, { reason }),
                      'กลับรายการใบ PR ไม่สำเร็จ',
                    )
                  }
                >
                  {isPending ? 'กำลังดำเนินการ…' : 'ยืนยันกลับรายการ'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {request.status === 'partially_received' && (
        <PurchaseRequestRemainingClosePanel request={request} />
      )}

      {request.status === 'closed_short' && (
        <PurchaseRequestShortClosedAudit request={request} />
      )}

      {request.status === 'reversed' && (
        <div className="pr-review__closed">
          <p className="pr-review__intro">
            ยืนยันโดย {request.acknowledgedByName ?? 'เจ้าหน้าที่คลัง'} · {formatThaiDateTime(request.acknowledgedAt)}
          </p>
          <p className="pr-review__intro">
            กลับรายการโดย {request.reversedByName ?? 'เจ้าหน้าที่คลัง'} · {formatThaiDateTime(request.reversedAt)}
          </p>
          {request.reversalReason && (
            <p className="pr-review__intro">เหตุผลที่กลับรายการ: {request.reversalReason}</p>
          )}
        </div>
      )}

      {request.status === 'cancelled' && (
        <p className="empty-state">ใบ PR นี้ปิดแล้ว ไม่มีการดำเนินการเพิ่มเติม</p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}
