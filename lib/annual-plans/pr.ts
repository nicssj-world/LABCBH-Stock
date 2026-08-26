import 'server-only'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { normalizeLsCode } from '@/lib/inventory/ls-code'
import { currentFiscalYear } from './fiscal'
import { ANNUAL_PLAN_BUCKET } from './files'
import {
  annualPlanReferenceSchema,
  matchAnnualPlanContractName,
  matchAnnualPlanLine,
  normalizePlanText,
  type AnnualPlanForPurchaseRequest,
  type AnnualPlanRow,
} from './pr-reference'
import { indexAnnualPlanPdf, sha256Hex } from './pdf-index'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ANNUAL_PLAN_TYPES, type AnnualPlanType } from './schema'

const versionRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  plan_type: z.enum(ANNUAL_PLAN_TYPES),
  file_path: z.string().min(1),
  file_name: z.string().min(1),
  file_size_bytes: z.coerce.number().int().positive(),
  uploaded_at: z.string(),
  source_checksum: z.string().nullable(),
  index_status: z.enum(['pending', 'ready', 'failed']),
  index_error: z.string().nullable(),
})

const currentPlanRowSchema = z.object({
  current_version_id: z.string().uuid().nullable(),
})

const planRowSchema = z.object({
  id: z.string().uuid(),
  line_number: z.number().int().positive(),
  plan_sequence: z.string().min(1),
  item_name: z.string().min(1),
  ls_code: z.string().nullable(),
  raw_text: z.string().min(1),
  page_number: z.number().int().positive(),
  page_width: z.coerce.number().positive(),
  page_height: z.coerce.number().positive(),
  x: z.coerce.number().nonnegative(),
  y: z.coerce.number().nonnegative(),
  width: z.coerce.number().positive(),
  height: z.coerce.number().positive(),
})

function toPlanRow(row: z.infer<typeof planRowSchema>): AnnualPlanRow {
  return {
    id: row.id,
    lineNumber: row.line_number,
    planSequence: row.plan_sequence,
    itemName: row.item_name,
    lsCode: row.ls_code,
    rawText: row.raw_text,
    pageNumber: row.page_number,
    pageWidth: row.page_width,
    pageHeight: row.page_height,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
  }
}

async function readVersion(versionId: string) {
  const result = await supabaseAdmin
    .from('lab_stock_annual_plan_versions')
    .select('id, fiscal_year, plan_type, file_path, file_name, file_size_bytes, uploaded_at, source_checksum, index_status, index_error')
    .eq('id', versionId)
    .maybeSingle()
  if (result.error) throw new Error(`อ่านเวอร์ชัน${annualPlanLabel('procurement')}ไม่สำเร็จ: ${result.error.message}`)
  return result.data ? versionRowSchema.parse(result.data) : null
}

function annualPlanLabel(planType: AnnualPlanType) {
  return planType === 'hiring' ? 'แผนจัดจ้าง' : 'แผนจัดซื้อ'
}

async function readRows(versionId: string) {
  const result = await supabaseAdmin
    .from('lab_stock_annual_plan_rows')
    .select('id, line_number, plan_sequence, item_name, ls_code, raw_text, page_number, page_width, page_height, x, y, width, height')
    .eq('annual_plan_version_id', versionId)
    .order('line_number')
  if (result.error) throw new Error(`อ่านรายการในแผนประจำปีไม่สำเร็จ: ${result.error.message}`)
  return planRowSchema.array().parse(result.data ?? []).map(toPlanRow)
}

async function downloadVersionPdf(version: z.infer<typeof versionRowSchema>) {
  const result = await supabaseAdmin.storage.from(ANNUAL_PLAN_BUCKET).download(version.file_path)
  if (result.error || !result.data) {
    throw new Error(`ไม่สามารถอ่านไฟล์แผนประจำปี ${version.file_name} ได้: ${result.error?.message ?? 'ไม่พบไฟล์'}`)
  }
  return new Uint8Array(await result.data.arrayBuffer())
}

async function markIndexFailed(versionId: string, message: string) {
  await supabaseAdmin
    .from('lab_stock_annual_plan_versions')
    .update({ index_status: 'failed', index_error: message.slice(0, 1000) })
    .eq('id', versionId)
}

/**
 * Legacy versions are indexed lazily and several PR forms can open at once.
 * A stable row id lets concurrent indexers converge on the same rows instead
 * of generating a duplicate `(version, line)` record or changing a row id
 * after a browser has already selected it.
 */
function indexedRowId(versionId: string, lineNumber: number) {
  const hex = createHash('sha256').update(`${versionId}:${lineNumber}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${['8', '9', 'a', 'b'][Number.parseInt(hex[16], 16) % 4]}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Indexes a legacy/current version on first use, so old uploaded plans work
 * without asking an administrator to upload the same PDF again. */
async function ensureVersionIndexed(version: z.infer<typeof versionRowSchema>) {
  let rows = await readRows(version.id)
  if (version.index_status === 'ready' && rows.length > 0 && version.source_checksum) return rows
  if (version.index_status === 'failed') return rows

  try {
    const bytes = await downloadVersionPdf(version)
    rows = (await indexAnnualPlanPdf(bytes)).map((row) => ({
      ...row,
      id: indexedRowId(version.id, row.lineNumber),
    }))
    if (rows.length === 0) throw new Error('ไฟล์แผนไม่มีข้อความที่ค้นหาได้ จึงจับคู่รายการอัตโนมัติไม่ได้')

    const current = await supabaseAdmin
      .from('lab_stock_annual_plans')
      .select('current_version_id')
      .eq('fiscal_year', version.fiscal_year)
      .eq('plan_type', version.plan_type)
      .maybeSingle()
    if (current.error) throw new Error(current.error.message)
    const currentPointer = currentPlanRowSchema.parse(current.data)
    if (currentPointer.current_version_id !== version.id) {
      throw new Error('ไฟล์แผนถูกเปลี่ยนระหว่างจัดทำดัชนี กรุณาโหลดหน้าใหม่')
    }

    const insertResult = await supabaseAdmin
      .from('lab_stock_annual_plan_rows')
      .upsert(rows.map((row) => ({
        id: row.id,
        annual_plan_version_id: version.id,
        line_number: row.lineNumber,
        plan_sequence: row.planSequence,
        item_name: row.itemName,
        ls_code: row.lsCode,
        raw_text: row.rawText,
        page_number: row.pageNumber,
        page_width: row.pageWidth,
        page_height: row.pageHeight,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
      })), { onConflict: 'id' })
    if (insertResult.error) throw new Error(insertResult.error.message)

    const updated = await supabaseAdmin
      .from('lab_stock_annual_plan_versions')
      .update({
        source_checksum: sha256Hex(bytes),
        index_status: 'ready',
        index_error: null,
      })
      .eq('id', version.id)
    if (updated.error) throw new Error(updated.error.message)
    return rows
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await markIndexFailed(version.id, message)
    throw new Error(message)
  }
}

export async function getCurrentAnnualPlanForPurchaseRequest(
  planType: AnnualPlanType,
): Promise<AnnualPlanForPurchaseRequest> {
  const fiscalYear = currentFiscalYear()
  const planLabel = annualPlanLabel(planType)
  const currentResult = await supabaseAdmin
    .from('lab_stock_annual_plans')
    .select('current_version_id')
    .eq('fiscal_year', fiscalYear)
    .eq('plan_type', planType)
    .maybeSingle()
  if (currentResult.error) {
    return {
      planType,
      currentFiscalYear: fiscalYear,
      status: 'unavailable',
      planVersionId: null,
      fiscalYear,
      fileName: null,
      uploadedAt: null,
      rows: [],
      message: `ยังอ่าน${planLabel}ปีงบประมาณ ${fiscalYear} ไม่ได้: ${currentResult.error.message}`,
    }
  }
  if (!currentResult.data) {
    return {
      planType,
      currentFiscalYear: fiscalYear,
      status: 'missing',
      planVersionId: null,
      fiscalYear,
      fileName: null,
      uploadedAt: null,
      rows: [],
      message: `ยังไม่มีไฟล์${planLabel}ปีงบประมาณ ${fiscalYear} กรุณาแจ้งผู้ดูแลให้อัปโหลดก่อน`,
    }
  }

  const pointer = currentPlanRowSchema.parse(currentResult.data)
  if (!pointer.current_version_id) {
    return {
      planType,
      currentFiscalYear: fiscalYear,
      status: 'unavailable',
      planVersionId: null,
      fiscalYear,
      fileName: null,
      uploadedAt: null,
      rows: [],
      message: `ไฟล์${planLabel}ปัจจุบันยังไม่มีเวอร์ชันอ้างอิง กรุณาให้ผู้ดูแลอัปโหลดไฟล์ใหม่`,
    }
  }

  const version = await readVersion(pointer.current_version_id)
  if (!version || version.plan_type !== planType || version.fiscal_year !== fiscalYear) {
    return {
      planType,
      currentFiscalYear: fiscalYear,
      status: 'unavailable',
      planVersionId: null,
      fiscalYear,
      fileName: null,
      uploadedAt: null,
      rows: [],
      message: `ไม่พบเวอร์ชัน${planLabel}ปีงบประมาณปัจจุบันที่ใช้งานอยู่`,
    }
  }

  try {
    const rows = await ensureVersionIndexed(version)
    if (rows.length === 0) throw new Error(version.index_error ?? `ไม่พบรายการใน${planLabel}`)
    return {
      planType,
      currentFiscalYear: fiscalYear,
      status: 'ready',
      planVersionId: version.id,
      fiscalYear: version.fiscal_year,
      fileName: version.file_name,
      uploadedAt: version.uploaded_at,
      rows,
      message: null,
    }
  } catch (error) {
    return {
      planType,
      currentFiscalYear: fiscalYear,
      status: 'unavailable',
      planVersionId: version.id,
      fiscalYear: version.fiscal_year,
      fileName: version.file_name,
      uploadedAt: version.uploaded_at,
      rows: [],
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

export function getCurrentProcurementPlanForPurchaseRequest() {
  return getCurrentAnnualPlanForPurchaseRequest('procurement')
}

export function getCurrentHiringPlanForPurchaseRequest() {
  return getCurrentAnnualPlanForPurchaseRequest('hiring')
}

export function validateAnnualPlanReferenceForLines(
  referenceInput: unknown,
  items: readonly { name?: string | null; lsCode?: string | null }[],
  plan: AnnualPlanForPurchaseRequest,
) {
  const reference = annualPlanReferenceSchema.parse(referenceInput)
  if (reference.planType !== 'procurement' || plan.planType !== 'procurement') {
    throw new Error('ประเภทแผนไม่ตรงกับวิธีจัดซื้อของ PR')
  }
  if (plan.status !== 'ready' || !plan.planVersionId) {
    throw new Error(plan.message ?? `ไม่มีแผนจัดซื้อปีงบประมาณ ${plan.currentFiscalYear}`)
  }
  if (
    reference.planVersionId !== plan.planVersionId
    || reference.planFiscalYear !== plan.currentFiscalYear
  ) {
    throw new Error('ไฟล์แผนจัดซื้อถูกเปลี่ยนระหว่างกรอก PR กรุณาโหลดข้อมูลใหม่และจับคู่รายการอีกครั้ง')
  }
  if (reference.lines.length !== items.length) {
    throw new Error('จำนวนรายการใน PR ไม่ตรงกับรายการที่จับคู่ไว้ในแผนจัดซื้อ')
  }

  const rowsById = new Map(plan.rows.map((row) => [row.id, row]))
  const usedRows = new Set<string>()
  for (const [index, line] of reference.lines.entries()) {
    const row = rowsById.get(line.planRowId)
    if (!row || row.lineNumber !== line.lineNumber || usedRows.has(line.planRowId)) {
      throw new Error('รายการอ้างอิงแผนจัดซื้อไม่ตรงกับไฟล์แผนปัจจุบัน กรุณาจับคู่ใหม่')
    }
    usedRows.add(line.planRowId)

    const itemName = items[index]?.name?.trim() ?? ''
    const itemLsCode = items[index]?.lsCode?.trim() ?? ''
    if (!itemName || !itemLsCode) throw new Error('รายการ PR ต้องมีชื่อและรหัส LS ก่อนจับคู่แผน')
    if (line.matchMethod === 'name_exact') {
      const nameMatch = matchAnnualPlanLine(itemName, itemLsCode, [row])
      if (!nameMatch.selected || nameMatch.matchMethod !== 'name_exact') {
        throw new Error(`ชื่อรายการลำดับที่ ${index + 1} ไม่ตรงกับแผนจัดซื้อ กรุณาเลือกยืนยันแบบกำหนดเอง`)
      }
    }
    if (
      line.matchMethod === 'code_exact'
      && (!row.lsCode || normalizeLsCode(row.lsCode) !== normalizeLsCode(itemLsCode))
    ) {
      throw new Error(`รหัส LS ของรายการลำดับที่ ${index + 1} ไม่ตรงกับแผนจัดซื้อ`)
    }
    if (line.matchMethod === 'manual_confirmed') {
      const rowText = normalizePlanText(`${row.itemName} ${row.rawText}`)
      const nameText = normalizePlanText(itemName)
      const codeMatches = Boolean(row.lsCode && normalizeLsCode(row.lsCode) === normalizeLsCode(itemLsCode))
      if (!rowText.includes(nameText) && !nameText.includes(normalizePlanText(row.itemName)) && !codeMatches) {
        // Manual confirmation is allowed for OCR/layout differences, but not
        // for a completely unrelated row.
        if (!rowText.split(' ').some((token) => token.length > 2 && nameText.includes(token))) {
          throw new Error(`รายการลำดับที่ ${index + 1} ไม่สัมพันธ์กับแถวที่เลือกในแผนจัดซื้อ`)
        }
      }
    }
  }
  return { reference, selectedRows: reference.lines.map((line) => rowsById.get(line.planRowId)!) }
}

export function validateAnnualPlanReferenceForContract(
  referenceInput: unknown,
  contractNameInput: string,
  plan: AnnualPlanForPurchaseRequest,
) {
  const reference = annualPlanReferenceSchema.parse(referenceInput)
  if (reference.planType !== 'hiring' || plan.planType !== 'hiring') {
    throw new Error('ประเภทแผนไม่ตรงกับวิธีจัดซื้อของ PR')
  }
  if (plan.status !== 'ready' || !plan.planVersionId) {
    throw new Error(plan.message ?? `ไม่มีแผนจัดจ้างปีงบประมาณ ${plan.currentFiscalYear}`)
  }
  if (
    reference.planVersionId !== plan.planVersionId
    || reference.planFiscalYear !== plan.currentFiscalYear
  ) {
    throw new Error('ไฟล์แผนจัดจ้างถูกเปลี่ยนระหว่างกรอก PR กรุณาโหลดข้อมูลใหม่และจับคู่ชื่อสัญญาอีกครั้ง')
  }
  if (!reference.contract || reference.lines.length !== 0) {
    throw new Error('แผนจัดจ้างต้องอ้างอิงจากชื่อสัญญาเพียงรายการเดียว')
  }

  const contractName = contractNameInput.trim()
  if (!contractName || normalizePlanText(reference.contract.contractName) !== normalizePlanText(contractName)) {
    throw new Error('ชื่อสัญญาที่อ้างอิงแผนจัดจ้างไม่ตรงกับชื่อสัญญาใน PR')
  }

  const rowsById = new Map(plan.rows.map((row) => [row.id, row]))
  const row = rowsById.get(reference.contract.line.planRowId)
  if (!row || row.lineNumber !== reference.contract.line.lineNumber) {
    throw new Error('รายการอ้างอิงแผนจัดจ้างไม่ตรงกับไฟล์แผนปัจจุบัน กรุณาจับคู่ชื่อสัญญาใหม่')
  }
  if (reference.contract.line.matchMethod === 'code_exact') {
    throw new Error('แผนจัดจ้างต้องจับคู่ด้วยชื่อสัญญาเท่านั้น')
  }
  const nameMatch = matchAnnualPlanContractName(contractName, [row])
  if (!nameMatch.selected) {
    throw new Error('ชื่อสัญญาไม่สัมพันธ์กับแถวที่เลือกในแผนจัดจ้าง')
  }
  return { reference, selectedRows: [row] }
}

export async function persistIndexedAnnualPlanVersion(input: {
  fiscalYear: number
  planType: 'procurement' | 'hiring'
  actorId: string
  filePath: string
  fileName: string
  fileSizeBytes: number
  sourceChecksum: string
  rows: AnnualPlanRow[]
}) {
  const result = await supabaseAdmin.rpc('upsert_lab_stock_annual_plan_with_index', {
    p_fiscal_year: input.fiscalYear,
    p_plan_type: input.planType,
    p_actor_id: input.actorId,
    p_file_path: input.filePath,
    p_file_name: input.fileName,
    p_file_mime_type: 'application/pdf',
    p_file_size_bytes: input.fileSizeBytes,
    p_source_checksum: input.sourceChecksum,
    p_rows: input.rows,
  })
  if (result.error) throw new Error(result.error.message)
  return result.data
}

export async function readAndIndexAnnualPlanFile(
  file: File | Blob,
  options: { requireRows?: boolean } = {},
) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const rows = indexAnnualPlanPdf(bytes)
  const indexedRows = await rows
  if ((options.requireRows ?? true) && indexedRows.length === 0) {
    throw new Error('ไฟล์แผนไม่มีรายการข้อความที่ระบบค้นหาได้')
  }
  return { bytes, rows: indexedRows, sourceChecksum: sha256Hex(bytes) }
}

export async function readCurrentPlanVersionPdf(
  planVersionId: string,
  planType: AnnualPlanType = 'procurement',
) {
  const plan = await getCurrentAnnualPlanForPurchaseRequest(planType)
  if (plan.status !== 'ready' || plan.planVersionId !== planVersionId) {
    throw new Error(`ไฟล์${annualPlanLabel(planType)}ถูกเปลี่ยนระหว่างกรอก PR กรุณาโหลดข้อมูลใหม่และจับคู่รายการอีกครั้ง`)
  }
  const version = await readVersion(planVersionId)
  if (!version || version.plan_type !== planType) throw new Error(`ไม่พบเวอร์ชัน${annualPlanLabel(planType)}ที่อ้างอิง`)
  const rowsById = new Map(plan.rows.map((row) => [row.id, row]))
  const bytes = await downloadVersionPdf(version)
  if (bytes.byteLength !== version.file_size_bytes) {
    throw new Error(`ขนาดไฟล์${annualPlanLabel(planType)}ไม่ตรงกับ version ที่อ้างอิง กรุณาให้ผู้ดูแลตรวจสอบไฟล์แผน`)
  }
  if (version.source_checksum && sha256Hex(bytes) !== version.source_checksum) {
    throw new Error(`ไฟล์${annualPlanLabel(planType)}ถูกแก้ไขโดยไม่เปลี่ยน version กรุณาให้ผู้ดูแลตรวจสอบไฟล์แผน`)
  }
  return { plan, version, rowsById, bytes }
}
