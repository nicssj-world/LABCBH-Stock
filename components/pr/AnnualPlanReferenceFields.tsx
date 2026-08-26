'use client'

import { useMemo, useState } from 'react'
import { AnnualPlanPreviewDialog } from '@/components/annual-plans/AnnualPlanPreviewDialog'
import {
  matchAnnualPlanContractName,
  matchAnnualPlanLine,
  normalizePlanText,
  type AnnualPlanForPurchaseRequest,
  type AnnualPlanReferenceLine,
  type AnnualPlanRow,
} from '@/lib/annual-plans/pr-reference'

interface AnnualPlanDraftLine {
  key: string
  name: string
  lsCode: string
}

export interface AnnualPlanReferenceFieldsProps {
  plan: AnnualPlanForPurchaseRequest
  lines: AnnualPlanDraftLine[]
  selections: Record<string, AnnualPlanReferenceLine | undefined>
  contractName?: string
  contractSelection?: AnnualPlanReferenceLine
  disabled?: boolean
  onSelect: (lineKey: string, reference: AnnualPlanReferenceLine | undefined) => void
  onContractSelect?: (reference: AnnualPlanReferenceLine | undefined) => void
}

function rowLabel(row: AnnualPlanRow) {
  const code = row.lsCode?.trim()
  const itemName = row.itemName || row.rawText
  const displayName = code
    ? itemName.split(code).join(' ').split(' ').filter(Boolean).join(' ')
    : itemName
  return `ลำดับ ${row.planSequence}${code ? ` · ${code}` : ''} · ${displayName}`
}

export function AnnualPlanReferenceFields({
  plan,
  lines,
  selections,
  contractName,
  contractSelection,
  disabled = false,
  onSelect,
  onContractSelect,
}: AnnualPlanReferenceFieldsProps) {
  const [queries, setQueries] = useState<Record<string, string>>({})
  const [isPlanPreviewOpen, setIsPlanPreviewOpen] = useState(false)
  const isHiringPlan = plan.planType === 'hiring'
  const planLabel = isHiringPlan ? 'แผนจัดจ้าง' : 'แผนจัดซื้อ'

  const canPreviewPlan = plan.status === 'ready' && Boolean(plan.planVersionId)

  return (
    <section className="bench-panel annual-plan-reference" aria-labelledby="annual-plan-reference-title">
      <div className="bench-panel__header annual-plan-reference__header">
        <div>
          <p className="section-kicker">{isHiringPlan ? 'HIRING PLAN MATCHING' : 'PROCUREMENT PLAN MATCHING'}</p>
          <h2 id="annual-plan-reference-title">{isHiringPlan ? 'จับคู่ชื่อสัญญากับแผนจัดจ้าง' : 'จับคู่รายการกับแผนจัดซื้อ'}</h2>
          <p>
            ใช้{planLabel}ปีงบประมาณ {plan.currentFiscalYear} · {isHiringPlan ? 'จับคู่จากชื่อสัญญาเท่านั้น' : 'ค้นหาจากชื่อก่อน และใช้รหัส LS ช่วยยืนยัน'}
          </p>
          <small className="annual-plan-reference__helper">
            ระบบจะสร้างไฟล์แผนที่ไฮไลท์รายการให้อัตโนมัติ ไม่ต้องแนบไฟล์แผนซ้ำ
          </small>
        </div>
        <div className="annual-plan-reference__header-actions">
          <span
            className={`annual-plan-reference__status${plan.status === 'ready' ? ' is-ready' : ''}`}
            title={plan.status === 'ready' && plan.fileName ? `ชื่อไฟล์: ${plan.fileName}` : undefined}
            aria-label={plan.status === 'ready' && plan.fileName ? `ไฟล์แผนปัจจุบัน: ${plan.fileName}` : undefined}
          >
            {plan.status === 'ready' && plan.fileName ? (
              <>
                <span className="annual-plan-reference__status-label">ไฟล์แผนปัจจุบัน</span>
                <span className="annual-plan-reference__filename">{plan.fileName}</span>
              </>
            ) : 'ยังใช้แผนไม่ได้'}
          </span>
          {canPreviewPlan && (
            <button
              type="button"
              className="lab-button lab-button--secondary annual-plan-reference__view"
              onClick={() => setIsPlanPreviewOpen(true)}
              aria-label={`เปิดดู${planLabel} ปีงบประมาณ ${plan.fiscalYear}`}
            >
              <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              เปิดดู{planLabel}
            </button>
          )}
        </div>
      </div>

      {plan.status !== 'ready' ? (
        <p className="annual-plan-reference__notice" role="alert">
          {plan.message ?? `ยังไม่มีไฟล์${planLabel}ปีงบประมาณ ${plan.currentFiscalYear} กรุณาแจ้งผู้ดูแลให้อัปโหลดก่อน`}
        </p>
      ) : isHiringPlan ? (
        contractName ? (
          <AnnualPlanContractPicker
            contractName={contractName}
            rows={plan.rows}
            selected={contractSelection}
            query={queries.contract ?? ''}
            disabled={disabled}
            onQueryChange={(query) => setQueries((current) => ({ ...current, contract: query }))}
            onSelect={onContractSelect ?? (() => undefined)}
          />
        ) : (
          <p className="empty-state">กรอกชื่อสัญญาก่อนจับคู่กับแผนจัดจ้าง</p>
        )
      ) : lines.length === 0 ? (
        <p className="empty-state">เพิ่มรายการในใบ PR ก่อนจับคู่กับแผนจัดซื้อ</p>
      ) : (
        <div className="annual-plan-reference__lines">
          {lines.map((line, index) => (
            <AnnualPlanLinePicker
              key={line.key}
              line={line}
              index={index}
              rows={plan.rows}
              selected={selections[line.key]}
              query={queries[line.key] ?? ''}
              disabled={disabled}
              onQueryChange={(query) => setQueries((current) => ({ ...current, [line.key]: query }))}
              onSelect={(reference) => onSelect(line.key, reference)}
            />
          ))}
        </div>
      )}
      <AnnualPlanPreviewDialog
        planId={null}
        planVersionId={plan.planVersionId}
        fileName={plan.fileName}
        open={isPlanPreviewOpen && canPreviewPlan}
        onCancel={() => setIsPlanPreviewOpen(false)}
      />
    </section>
  )
}

function AnnualPlanLinePicker({
  line,
  index,
  rows,
  selected,
  query,
  disabled,
  onQueryChange,
  onSelect,
}: {
  line: AnnualPlanDraftLine
  index: number
  rows: AnnualPlanRow[]
  selected?: AnnualPlanReferenceLine
  query: string
  disabled: boolean
  onQueryChange: (query: string) => void
  onSelect: (reference: AnnualPlanReferenceLine | undefined) => void
}) {
  const automatic = matchAnnualPlanLine(line.name, line.lsCode, rows)
  const selectedRow = rows.find((row) => row.id === selected?.planRowId) ?? automatic.selected
  const options = useMemo(() => {
    const needle = normalizePlanText(query)
    const searched = needle
      ? rows.filter((row) => normalizePlanText(`${row.planSequence} ${row.itemName} ${row.rawText} ${row.lsCode ?? ''}`).includes(needle))
      : []
    const candidates = [...automatic.candidates, ...searched, ...(selectedRow ? [selectedRow] : [])]
    return [...new Map(candidates.map((row) => [row.id, row])).values()].slice(0, 30)
  }, [automatic.candidates, query, rows, selectedRow])

  const value = selected?.planRowId ?? automatic.selected?.id ?? ''
  const status = selected
    ? selected.matchMethod === 'manual_confirmed'
      ? 'ยืนยันแถวนี้แล้ว'
      : selected.matchMethod === 'code_exact' ? 'จับคู่จากรหัส LS แล้ว' : 'จับคู่จากชื่อแล้ว'
    : automatic.selected
      ? automatic.matchMethod === 'code_exact' ? 'จับคู่จากรหัส LS แล้ว' : 'จับคู่จากชื่อแล้ว'
      : automatic.candidates.length > 0 ? 'พบหลายแถว กรุณาเลือกเลขลำดับ' : 'ยังไม่พบแถวที่ตรงกัน'

  return (
    <article className={`annual-plan-reference__line${selectedRow ? ' is-matched' : ''}`}>
      <div className="annual-plan-reference__line-copy">
        <strong>รายการที่ {index + 1}: {line.name || 'ยังไม่ระบุชื่อ'}</strong>
        <small>LS {line.lsCode || 'ยังไม่ระบุรหัส'} · {status}</small>
      </div>
      {selectedRow && (
        <p className="annual-plan-reference__selected">
          แผน: หน้า {selectedRow.pageNumber} · ลำดับ {selectedRow.planSequence} · {selectedRow.itemName}
        </p>
      )}
      <div className="annual-plan-reference__controls">
        <label className="field-row">
          <span>ค้นหาเลขลำดับ/ชื่อในแผน</span>
          <input
            type="search"
            value={query}
            disabled={disabled}
            placeholder="พิมพ์ชื่อหรือเลขลำดับเพื่อค้นหา"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <label className="field-row">
          <span>แถวในแผน <span className="field-required" aria-hidden="true">*</span></span>
          <select
            required
            disabled={disabled}
            value={value}
            onChange={(event) => {
              const row = rows.find((candidate) => candidate.id === event.target.value)
              onSelect(row ? {
                lineNumber: row.lineNumber,
                planRowId: row.id,
                matchMethod: automatic.selected?.id === row.id && automatic.matchMethod
                  ? automatic.matchMethod
                  : 'manual_confirmed',
              } : undefined)
            }}
          >
            <option value="">เลือกเลขลำดับในแผน</option>
            {options.map((row) => <option key={row.id} value={row.id}>{rowLabel(row)} · หน้า {row.pageNumber}</option>)}
          </select>
        </label>
      </div>
      {automatic.candidates.length > 1 && !selected && (
        <small className="annual-plan-reference__hint">ชื่อซ้ำกันในแผน กรุณาเลือกเลขลำดับให้ตรงกับรายการที่จะสั่งซื้อ</small>
      )}
      {!selectedRow && <small className="field-error">ต้องเลือกแถวในแผนก่อนส่งใบ PR</small>}
    </article>
  )
}

function AnnualPlanContractPicker({
  contractName,
  rows,
  selected,
  query,
  disabled,
  onQueryChange,
  onSelect,
}: {
  contractName: string
  rows: AnnualPlanRow[]
  selected?: AnnualPlanReferenceLine
  query: string
  disabled: boolean
  onQueryChange: (query: string) => void
  onSelect: (reference: AnnualPlanReferenceLine | undefined) => void
}) {
  const automatic = matchAnnualPlanContractName(contractName, rows)
  const selectedRow = rows.find((row) => row.id === selected?.planRowId) ?? automatic.selected
  const options = useMemo(() => {
    const needle = normalizePlanText(query)
    const searched = needle
      ? rows.filter((row) => normalizePlanText(`${row.planSequence} ${row.itemName} ${row.rawText}`).includes(needle))
      : []
    const candidates = [...automatic.candidates, ...searched, ...(selectedRow ? [selectedRow] : [])]
    return [...new Map(candidates.map((row) => [row.id, row])).values()].slice(0, 30)
  }, [automatic.candidates, query, rows, selectedRow])

  const value = selected?.planRowId ?? automatic.selected?.id ?? ''
  const status = selected
    ? selected.matchMethod === 'manual_confirmed' ? 'ยืนยันแถวนี้แล้ว' : 'จับคู่จากชื่อแล้ว'
    : automatic.selected
      ? 'จับคู่จากชื่อแล้ว'
      : automatic.candidates.length > 0 ? 'พบหลายแถว กรุณาเลือกเลขลำดับ' : 'ยังไม่พบแถวที่ตรงกัน'

  return (
    <article className={`annual-plan-reference__line${selectedRow ? ' is-matched' : ''}`}>
      <div className="annual-plan-reference__line-copy">
        <strong>ชื่อสัญญา: {contractName}</strong>
        <small>{status} · ไม่ใช้รหัสพัสดุ</small>
      </div>
      {selectedRow && (
        <p className="annual-plan-reference__selected">
          แผนจัดจ้าง: หน้า {selectedRow.pageNumber} · ลำดับ {selectedRow.planSequence} · {selectedRow.itemName}
        </p>
      )}
      <div className="annual-plan-reference__controls">
        <label className="field-row">
          <span>ค้นหาเลขลำดับ/ชื่อสัญญาในแผน</span>
          <input
            type="search"
            value={query}
            disabled={disabled}
            placeholder="พิมพ์ชื่อหรือเลขลำดับเพื่อค้นหา"
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
        <label className="field-row">
          <span>แถวในแผน <span className="field-required" aria-hidden="true">*</span></span>
          <select
            required
            disabled={disabled}
            value={value}
            onChange={(event) => {
              const row = rows.find((candidate) => candidate.id === event.target.value)
              onSelect(row ? {
                lineNumber: row.lineNumber,
                planRowId: row.id,
                matchMethod: automatic.selected?.id === row.id ? 'name_exact' : 'manual_confirmed',
              } : undefined)
            }}
          >
            <option value="">เลือกเลขลำดับในแผนจัดจ้าง</option>
            {options.map((row) => <option key={row.id} value={row.id}>{rowLabel(row)} · หน้า {row.pageNumber}</option>)}
          </select>
        </label>
      </div>
      {automatic.candidates.length > 1 && !selected && (
        <small className="annual-plan-reference__hint">ชื่อสัญญาตรงหลายแถว กรุณาเลือกเลขลำดับให้ตรงกับสัญญาที่จะจัดจ้าง</small>
      )}
      {!selectedRow && <small className="field-error">ต้องเลือกแถวในแผนจัดจ้างก่อนส่งใบ PR</small>}
    </article>
  )
}
