'use server'

import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { fiscalYearOfIsoDate } from './fiscal'
import { canUploadPurchaseRequestChecklist } from '@/lib/pr/authorization'
import { annualPlanTypeForPurchaseMethod, PR_MAX_ATTACHMENT_SIZE_BYTES } from '@/lib/pr/checklist'
import { buildPurchaseRequestChecklistUploadKey } from '@/lib/pr/checklist-storage'
import { getR2BucketName, getR2Client } from '@/lib/r2/client'
import { isoDateSchema } from '@/lib/validation/date'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { assertAnnualPlanUploader } from './authorization'
import {
  ANNUAL_PLAN_BUCKET,
  ANNUAL_PLAN_MIME_TYPE,
  MAX_ANNUAL_PLAN_FILE_SIZE_BYTES,
  annualPlanFilePath,
  isAnnualPlanFilePathAllowed,
  validateAnnualPlanFile,
} from './files'
import { ANNUAL_PLAN_TYPES, annualPlanInputSchema, type AnnualPlanType } from './schema'
import {
  annualPlanReferenceSchema,
  type AnnualPlanEvidenceActionResult,
} from './pr-reference'
import { createHighlightedAnnualPlanPdf } from './pdf-index'
import {
  getCurrentAnnualPlanForPurchaseRequest,
  persistIndexedAnnualPlanVersion,
  readAndIndexAnnualPlanFile,
  readCurrentPlanVersionPdf,
  validateAnnualPlanReferenceForContract,
  validateAnnualPlanReferenceForLines,
} from './pr'

import { PURCHASE_METHODS } from '@/lib/pr/schema'

const annualPlanRpcResultSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  plan_type: z.enum(ANNUAL_PLAN_TYPES),
  file_path: z.string().min(1),
  file_name: z.string().min(1),
  file_mime_type: z.literal(ANNUAL_PLAN_MIME_TYPE),
  file_size_bytes: z.number().int().positive(),
  version_id: z.string().uuid().optional(),
  source_checksum: z.string().nullable().optional(),
  previous_file_path: z.string().nullable(),
})

const annualPlanUploadPreparationSchema = annualPlanInputSchema.extend({
  fileName: z.string().trim().min(1).max(255),
  fileSizeBytes: z.number().int().positive().max(MAX_ANNUAL_PLAN_FILE_SIZE_BYTES),
})

const annualPlanFinalizeInputSchema = annualPlanInputSchema.extend({
  filePath: z.string().trim().min(1),
  fileName: z.string().trim().min(1).max(255),
  fileSizeBytes: z.number().int().positive().max(MAX_ANNUAL_PLAN_FILE_SIZE_BYTES),
})

const annualPlanEvidenceInputSchema = z
  .object({
    uploadSessionId: z.string().uuid(),
    requestedDate: isoDateSchema,
    method: z.enum(PURCHASE_METHODS),
    contractName: z.string().trim().min(1).max(240).optional(),
    reference: annualPlanReferenceSchema,
    items: z.array(z.object({
      name: z.string().trim().min(1).max(240),
      lsCode: z.string().trim().min(1).max(100),
    }).strict()),
  })
  .strict()

async function removeOrQueue(path: string) {
  const removed = await supabaseAdmin.storage.from(ANNUAL_PLAN_BUCKET).remove([path])
  if (removed.error) {
    await enqueueStorageCleanupJobBestEffort({
      storageBackend: 'supabase_storage',
      bucketName: ANNUAL_PLAN_BUCKET,
      storageKey: path,
      jobKind: 'storage_upload_rollback',
    })
    return false
  }
  return true
}

function assertAnnualPlanPdfName(fileName: string) {
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    throw new Error('รองรับเฉพาะไฟล์ PDF เท่านั้น')
  }
}

function assertAnnualPlanPathMatchesInput(
  filePath: string,
  fiscalYear: number,
  planType: AnnualPlanType,
) {
  const expectedPrefix = `annual-plans/${fiscalYear}/${planType}/`
  if (!isAnnualPlanFilePathAllowed(filePath) || !filePath.startsWith(expectedPrefix)) {
    throw new Error('เส้นทางไฟล์แผนประจำปีไม่ถูกต้อง')
  }
}

/**
 * Creates only a short-lived upload ticket. The PDF itself must go directly
 * from the browser to Supabase Storage so it never crosses a Vercel Function
 * request-body limit.
 */
export async function prepareAnnualPlanUpload(input: unknown) {
  const actor = await requireActor()
  assertAnnualPlanUploader(actor)
  const parsed = annualPlanUploadPreparationSchema.parse(input)
  assertAnnualPlanPdfName(parsed.fileName)

  const path = annualPlanFilePath({
    fiscalYear: parsed.fiscalYear,
    planType: parsed.planType,
    // Keep the path compatible with the database's lowercase .pdf check.
    fileName: parsed.fileName.replace(/\.pdf$/i, '.pdf'),
    id: crypto.randomUUID(),
  })
  assertAnnualPlanPathMatchesInput(path, parsed.fiscalYear, parsed.planType)

  const signed = await supabaseAdmin
    .storage
    .from(ANNUAL_PLAN_BUCKET)
    .createSignedUploadUrl(path, { upsert: false })
  if (signed.error) throw new Error(`เตรียมอัปโหลดแผนประจำปีไม่สำเร็จ: ${signed.error.message}`)

  return { path: signed.data.path, token: signed.data.token }
}

async function assertUploadedAnnualPlanObject(filePath: string, fileSizeBytes: number) {
  const info = await supabaseAdmin.storage.from(ANNUAL_PLAN_BUCKET).info(filePath)
  if (info.error || !info.data) {
    throw new Error('ไม่พบไฟล์ที่อัปโหลด กรุณาลองใหม่')
  }

  const contentType = info.data.contentType ?? info.data.metadata?.mimetype
  const size = info.data.size ?? info.data.metadata?.size
  if (String(contentType ?? '').toLowerCase() !== ANNUAL_PLAN_MIME_TYPE) {
    throw new Error('ไฟล์ที่อัปโหลดไม่ใช่ PDF ที่ถูกต้อง')
  }
  if (Number(size) !== fileSizeBytes) {
    throw new Error('ขนาดไฟล์ที่อัปโหลดไม่ตรงกับข้อมูล กรุณาลองใหม่')
  }
}

async function readUploadedAnnualPlanIndex(
  filePath: string,
  fileSizeBytes: number,
  requireRows: boolean,
) {
  const downloaded = await supabaseAdmin.storage.from(ANNUAL_PLAN_BUCKET).download(filePath)
  if (downloaded.error || !downloaded.data) {
    throw new Error(`ไม่สามารถอ่านไฟล์แผนจัดซื้อเพื่อสร้างดัชนีได้: ${downloaded.error?.message ?? 'ไม่พบไฟล์'}`)
  }
  if (Number(downloaded.data.size) !== fileSizeBytes) {
    throw new Error('ขนาดไฟล์แผนจัดซื้อเปลี่ยนไประหว่างตรวจสอบ กรุณาอัปโหลดใหม่')
  }
  return readAndIndexAnnualPlanFile(downloaded.data, { requireRows })
}

async function persistUploadedAnnualPlan(input: {
  fiscalYear: number
  planType: AnnualPlanType
  actorId: string
  filePath: string
  fileName: string
  fileSizeBytes: number
}) {
  // The version-aware RPC supersedes upsert_lab_stock_annual_plan while the
  // original RPC remains available for already deployed integrations.
  const indexed = await readUploadedAnnualPlanIndex(
    input.filePath,
    input.fileSizeBytes,
    true,
  )
  const rawRecord = await persistIndexedAnnualPlanVersion({
    fiscalYear: input.fiscalYear,
    planType: input.planType,
    actorId: input.actorId,
    filePath: input.filePath,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    sourceChecksum: indexed.sourceChecksum,
    rows: indexed.rows,
  })
  return annualPlanRpcResultSchema.parse(rawRecord)
}

/**
 * Records metadata after the browser has completed the direct Storage upload.
 * The request body contains no file bytes and remains small.
 */
export async function finalizeAnnualPlanUpload(input: unknown) {
  const actor = await requireActor()
  assertAnnualPlanUploader(actor)
  const parsed = annualPlanFinalizeInputSchema.parse(input)
  assertAnnualPlanPdfName(parsed.fileName)
  assertAnnualPlanPathMatchesInput(parsed.filePath, parsed.fiscalYear, parsed.planType)
  try {
    await assertUploadedAnnualPlanObject(parsed.filePath, parsed.fileSizeBytes)
  } catch (error) {
    await removeOrQueue(parsed.filePath)
    throw error
  }

  let record: z.infer<typeof annualPlanRpcResultSchema>
  try {
    record = await persistUploadedAnnualPlan({
      fiscalYear: parsed.fiscalYear,
      planType: parsed.planType,
      actorId: actor.id,
      filePath: parsed.filePath,
      fileName: parsed.fileName,
      fileSizeBytes: parsed.fileSizeBytes,
    })
    if (
      record.fiscal_year !== parsed.fiscalYear
      || record.plan_type !== parsed.planType
      || record.file_path !== parsed.filePath
      || !isAnnualPlanFilePathAllowed(record.file_path)
    ) {
      throw new Error('ข้อมูลแผนประจำปีที่บันทึกไม่ตรงกับไฟล์')
    }
  } catch (error) {
    await removeOrQueue(parsed.filePath)
    throw new Error(`บันทึกแผนประจำปีไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`)
  }

  revalidatePath('/annual-plans')
  return { planId: record.id, previousFilePath: record.previous_file_path }
}

export async function storeAnnualPlan(
  fiscalYear: number,
  planType: AnnualPlanType,
  file: File,
): Promise<{ planId: string; previousFilePath: string | null }> {
  const actor = await requireActor()
  assertAnnualPlanUploader(actor)
  const parsedInput = annualPlanInputSchema.parse({ fiscalYear, planType })
  await validateAnnualPlanFile(file)

  const path = annualPlanFilePath({
    fiscalYear: parsedInput.fiscalYear,
    planType: parsedInput.planType,
    fileName: file.name,
    id: crypto.randomUUID(),
  })
  if (!isAnnualPlanFilePathAllowed(path)) throw new Error('เส้นทางไฟล์แผนประจำปีไม่ถูกต้อง')

  const uploaded = await supabaseAdmin.storage
    .from(ANNUAL_PLAN_BUCKET)
    .upload(path, file, { upsert: false, contentType: ANNUAL_PLAN_MIME_TYPE })
  if (uploaded.error) throw new Error(`อัปโหลดแผนประจำปีไม่สำเร็จ: ${uploaded.error.message}`)

  let record: z.infer<typeof annualPlanRpcResultSchema>
  try {
    record = await persistUploadedAnnualPlan({
      fiscalYear: parsedInput.fiscalYear,
      planType: parsedInput.planType,
      actorId: actor.id,
      filePath: path,
      fileName: file.name,
      fileSizeBytes: file.size,
    })
    if (
      record.fiscal_year !== parsedInput.fiscalYear
      || record.plan_type !== parsedInput.planType
      || record.file_path !== path
      || !isAnnualPlanFilePathAllowed(record.file_path)
    ) {
      throw new Error('ข้อมูลแผนประจำปีที่บันทึกไม่ตรงกับไฟล์')
    }
  } catch (error) {
    await removeOrQueue(path)
    throw new Error(`บันทึกแผนประจำปีไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { planId: record.id, previousFilePath: record.previous_file_path }
}

export async function uploadAnnualPlan(formData: FormData): Promise<{ planId: string }> {
  const file = formData.get('file')
  if (!(file instanceof File)) throw new Error('กรุณาเลือกไฟล์แผนประจำปี')

  const parsedInput = annualPlanInputSchema.parse({
    fiscalYear: Number(formData.get('fiscalYear')),
    planType: formData.get('planType'),
  })
  const result = await storeAnnualPlan(parsedInput.fiscalYear, parsedInput.planType, file)
  revalidatePath('/annual-plans')
  return { planId: result.planId }
}

export async function annualPlanFileUrl(planId: string, mode: 'inline' | 'download'): Promise<string> {
  await requireActor()
  const parsedId = z.string().uuid().parse(planId)
  const result = await supabaseAdmin
    .from('lab_stock_annual_plans')
    .select('file_path, file_name')
    .eq('id', parsedId)
    .maybeSingle()
  if (result.error) throw new Error(`อ่านไฟล์แผนประจำปีไม่สำเร็จ: ${result.error.message}`)
  if (!result.data) throw new Error('ไม่พบไฟล์แผนประจำปี')
  if (!isAnnualPlanFilePathAllowed(result.data.file_path)) throw new Error('เส้นทางไฟล์แผนประจำปีไม่ถูกต้อง')

  const signed = await supabaseAdmin.storage
    .from(ANNUAL_PLAN_BUCKET)
    .createSignedUrl(result.data.file_path, 300, {
      download: mode === 'download' ? result.data.file_name : false,
    })
  if (signed.error) throw new Error(`สร้างลิงก์แผนประจำปีไม่สำเร็จ: ${signed.error.message}`)
  return signed.data.signedUrl
}

export async function annualPlanVersionFileUrl(versionId: string, mode: 'inline' | 'download'): Promise<string> {
  await requireActor()
  const parsedId = z.string().uuid().parse(versionId)
  const versionResult = await supabaseAdmin
    .from('lab_stock_annual_plan_versions')
    .select('annual_plan_id, file_path, file_name')
    .eq('id', parsedId)
    .maybeSingle()
  if (versionResult.error) throw new Error(`Unable to read annual plan version: ${versionResult.error.message}`)
  if (!versionResult.data) throw new Error('Annual plan version was not found')

  const currentResult = await supabaseAdmin
    .from('lab_stock_annual_plans')
    .select('current_version_id')
    .eq('id', versionResult.data.annual_plan_id)
    .maybeSingle()
  if (currentResult.error) throw new Error(`Unable to read current annual plan: ${currentResult.error.message}`)
  if (!currentResult.data || currentResult.data.current_version_id !== parsedId) {
    throw new Error('The requested annual plan is no longer the current version')
  }
  if (!isAnnualPlanFilePathAllowed(versionResult.data.file_path)) throw new Error('Annual plan file path is invalid')

  const signed = await supabaseAdmin.storage
    .from(ANNUAL_PLAN_BUCKET)
    .createSignedUrl(versionResult.data.file_path, 300, {
      download: mode === 'download' ? versionResult.data.file_name : false,
    })
  if (signed.error) throw new Error(`Unable to create annual plan version link: ${signed.error.message}`)
  return signed.data.signedUrl
}

async function removeGeneratedEvidenceOrQueue(storageKey: string) {
  try {
    await getR2Client().send(new DeleteObjectCommand({
      Bucket: getR2BucketName(),
      Key: storageKey,
    }))
  } catch (error) {
    console.error('ลบไฟล์แผนไฮไลท์ที่สร้างค้างไม่สำเร็จ', {
      storageKey,
      error: error instanceof Error ? error.message : String(error),
    })
    await enqueueStorageCleanupJobBestEffort({
      storageBackend: 'r2',
      bucketName: '__r2__',
      storageKey,
      jobKind: 'storage_upload_rollback',
    })
  }
}

/**
 * Builds the plan_page checklist artifact on the server. The browser submits
 * only the selected row ids; it never uploads a second copy of the annual
 * plan or controls which fiscal-year source is opened.
 */
async function generateAnnualPlanEvidenceInternal(input: unknown) {
  const actor = await requireActor()
  if (!canUploadPurchaseRequestChecklist(actor)) {
    throw new Error('ไม่มีสิทธิ์สร้างเอกสารแผนประกอบใบ PR')
  }
  const parsed = annualPlanEvidenceInputSchema.parse(input)
  const planType = annualPlanTypeForPurchaseMethod(parsed.method)
  if (!planType) throw new Error('วิธีจัดซื้อของ PR ไม่รองรับการสร้างไฟล์แผนจากระบบ')
  const currentPlan = await getCurrentAnnualPlanForPurchaseRequest(planType)
  const currentFiscalYear = currentPlan.currentFiscalYear
  if (fiscalYearOfIsoDate(parsed.requestedDate) !== currentFiscalYear) {
    throw new Error(`วันที่ขอซื้อของ PR ที่อ้างอิงแผน${planType === 'hiring' ? 'จัดจ้าง' : 'จัดซื้อ'}ต้องอยู่ในปีงบประมาณ ${currentFiscalYear}`)
  }

  const source = await readCurrentPlanVersionPdf(parsed.reference.planVersionId, planType)
  const validated = planType === 'hiring'
    ? validateAnnualPlanReferenceForContract(parsed.reference, parsed.contractName ?? '', source.plan)
    : validateAnnualPlanReferenceForLines(parsed.reference, parsed.items, source.plan)
  const highlighted = await createHighlightedAnnualPlanPdf(source.bytes, validated.selectedRows)
  if (highlighted.byteLength > PR_MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error(`ไฟล์แผน${planType === 'hiring' ? 'จัดจ้าง' : 'จัดซื้อ'}ที่ไฮไลท์มีขนาดเกิน 20 MB กรุณาให้ผู้ดูแลตรวจสอบไฟล์แผน`)
  }

  const fileName = `annual-plan-highlight-${parsed.reference.planFiscalYear}-${parsed.uploadSessionId}.pdf`
  const storageKey = buildPurchaseRequestChecklistUploadKey({
    actorId: actor.id,
    sessionId: parsed.uploadSessionId,
    fileName,
  })
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()

  try {
    await getR2Client().send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: storageKey,
      Body: highlighted,
      ContentType: 'application/pdf',
      IfNoneMatch: '*',
    }))
    const ticketResult = await supabaseAdmin.rpc('register_purchase_request_annual_plan_upload', {
      p_actor_id: actor.id,
      p_upload_session_id: parsed.uploadSessionId,
      p_storage_key: storageKey,
      p_file_name: fileName,
      p_size_bytes: highlighted.byteLength,
      p_expires_at: expiresAt,
      p_plan_version_id: parsed.reference.planVersionId,
    })
    if (ticketResult.error) throw new Error(ticketResult.error.message)
    const ticket = z.object({ id: z.string().uuid() }).parse(
      Array.isArray(ticketResult.data) ? ticketResult.data[0] : ticketResult.data,
    )
    return {
      ok: true as const,
      uploadId: ticket.id,
      fileName,
      planVersionId: parsed.reference.planVersionId,
      planFiscalYear: parsed.reference.planFiscalYear,
    }
  } catch (error) {
    await removeGeneratedEvidenceOrQueue(storageKey)
    throw new Error(`สร้างไฟล์แผนที่ไฮไลท์ไม่สำเร็จ: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * A plan reference is user-controlled input. Return expected validation and
 * storage failures to the form so a rejected reference cannot become a
 * production Server Components error page.
 */
export async function generateAnnualPlanEvidence(input: unknown): Promise<AnnualPlanEvidenceActionResult> {
  const actionRequestId = crypto.randomUUID()
  try {
    return await generateAnnualPlanEvidenceInternal(input)
  } catch (error) {
    console.error('Annual plan evidence generation failed', {
      actionRequestId,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : error,
    })
    return {
      ok: false,
      message: error instanceof z.ZodError
        ? 'สร้างไฟล์แผนที่ไฮไลท์ไม่สำเร็จ กรุณาตรวจสอบข้อมูลแล้วลองใหม่'
        : error instanceof Error && error.message.trim()
          ? error.message
          : 'สร้างไฟล์แผนที่ไฮไลท์ไม่สำเร็จ กรุณาลองใหม่',
    }
  }
}
