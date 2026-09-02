'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { formatBaht } from '@/lib/pr/presenter'
import { purchaseCreditNoteSourceOptions } from '@/lib/pr/expense'
import type { PurchaseRequestExpenseDocumentType } from '@/lib/pr/expense'
import type { PurchaseRequestRecord } from '@/lib/pr/types'
import { ServiceBarcodeScanner } from '@/components/service-procurement/ServiceBarcodeScanner'

interface Props {
  request: Pick<PurchaseRequestRecord, 'expenseEvents'>
  idPrefix: string
  documentType: PurchaseRequestExpenseDocumentType
  sourceExpenseId: string | null
  sourceError?: string | null
  invoiceNumber: string
  invoiceError: string | null
  disabled?: boolean
  onDocumentTypeChange: (value: PurchaseRequestExpenseDocumentType) => void
  onSourceExpenseChange: (value: string | null) => void
  onInvoiceNumberChange: (value: string) => void
  onInvoiceErrorClear: () => void
  onInvoiceEnter?: () => void
}

export function PurchaseRequestExpenseDocumentFields({
  request,
  idPrefix,
  documentType,
  sourceExpenseId,
  sourceError = null,
  invoiceNumber,
  invoiceError,
  disabled = false,
  onDocumentTypeChange,
  onSourceExpenseChange,
  onInvoiceNumberChange,
  onInvoiceErrorClear,
  onInvoiceEnter,
}: Props) {
  const [scannerOpen, setScannerOpen] = useState(false)
  const invoiceInputRef = useRef<HTMLInputElement>(null)
  const sourceOptions = purchaseCreditNoteSourceOptions(request.expenseEvents)
  const sourceErrorId = `${idPrefix}-source-error`
  const invoiceErrorId = `${idPrefix}-invoice-error`
  const source = sourceOptions.find((option) => option.id === sourceExpenseId) ?? null
  const hasSourceOptions = sourceOptions.length > 0

  function handleDocumentTypeChange(nextType: PurchaseRequestExpenseDocumentType) {
    onDocumentTypeChange(nextType)
    onInvoiceErrorClear()
    if (nextType === 'invoice') onSourceExpenseChange(null)
  }

  function handleDetected(value: string) {
    onInvoiceNumberChange(value)
    onInvoiceErrorClear()
    setScannerOpen(false)
    window.requestAnimationFrame(() => invoiceInputRef.current?.focus())
  }

  return (
    <>
      <div className="purchase-expense-document-toggle form-grid__wide">
        <label className="purchase-expense-document-toggle__control">
          <input
            type="checkbox"
            checked={documentType === 'credit_note'}
            disabled={disabled}
            aria-controls={`${idPrefix}-credit-fields`}
            aria-expanded={documentType === 'credit_note'}
            onChange={(event) => handleDocumentTypeChange(event.target.checked ? 'credit_note' : 'invoice')}
          />
          <span>ใบลดหนี้</span>
        </label>
        <small>ติ๊กเมื่อต้องการหักยอดจาก Invoice ที่บันทึกไว้แล้ว</small>
      </div>

      {documentType === 'credit_note' && (
        <label id={`${idPrefix}-credit-fields`} className="purchase-expense-document-source">
          <span>Invoice ต้นทาง <span className="field-required" aria-hidden="true">*</span></span>
          <select
            required
            value={sourceExpenseId ?? ''}
            disabled={disabled || !hasSourceOptions}
            aria-invalid={Boolean(sourceError)}
            aria-describedby={sourceError ? sourceErrorId : `${idPrefix}-source-help`}
            onChange={(event) => {
              onSourceExpenseChange(event.target.value || null)
              onInvoiceErrorClear()
            }}
          >
            <option value="">{hasSourceOptions ? 'เลือก Invoice ต้นทาง' : 'ยังไม่มี Invoice ให้ลด'}</option>
            {sourceOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {(option.invoiceNumber ?? 'ไม่ระบุเลข Invoice')} · เดิม {formatBaht(option.originalAmount)} · ลดแล้ว {formatBaht(option.creditedAmount)} · เหลือ {formatBaht(option.remainingAmount)}
              </option>
            ))}
          </select>
          {sourceError && <small id={sourceErrorId} className="field-error" role="alert">{sourceError}</small>}
          {!sourceError && <small id={`${idPrefix}-source-help`}>
            {source ? `ลดได้อีกไม่เกิน ${formatBaht(source.remainingAmount)}` : hasSourceOptions ? 'เลือก Invoice ที่ต้องการนำใบลดหนี้ไปหัก' : 'ต้องบันทึก Invoice ปกติก่อนจึงจะสร้างใบลดหนี้ได้'}
          </small>}
        </label>
      )}

      <label className="purchase-expense-document-number">
        <span>{documentType === 'credit_note' ? 'เลขที่ใบลดหนี้' : 'Invoice'} {documentType === 'credit_note' && <span className="field-required" aria-hidden="true">*</span>}</span>
        <div className="purchase-expense-document-number__control">
          <input
            ref={invoiceInputRef}
            id={`${idPrefix}-invoice`}
            value={invoiceNumber}
            required={documentType === 'credit_note'}
            disabled={disabled}
            autoComplete="off"
            inputMode="text"
            spellCheck={false}
            aria-invalid={Boolean(invoiceError)}
            aria-describedby={invoiceError ? invoiceErrorId : `${idPrefix}-invoice-help`}
            onChange={(event) => {
              onInvoiceNumberChange(event.target.value)
              onInvoiceErrorClear()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onInvoiceEnter?.()
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            className="purchase-expense-document-number__scan"
            disabled={disabled}
            aria-label={`สแกน${documentType === 'credit_note' ? 'เลขที่ใบลดหนี้' : 'เลข Invoice'}ด้วยกล้อง`}
            title="สแกนด้วยกล้อง"
            onClick={() => setScannerOpen(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17M7 12h10M7 9h10M7 15h7" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" />
            </svg>
            <span className="visually-hidden">สแกนด้วยกล้อง</span>
          </Button>
        </div>
        {invoiceError && <small id={invoiceErrorId} className="field-error" role="alert">{invoiceError}</small>}
        {!invoiceError && <small id={`${idPrefix}-invoice-help`}>รองรับเครื่องยิง USB/Bluetooth หรือปุ่มสแกนด้วยกล้อง · กด Enter เพื่อไปช่องยอดเงิน</small>}
      </label>

      <ServiceBarcodeScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onDetected={handleDetected}
      />
    </>
  )
}
