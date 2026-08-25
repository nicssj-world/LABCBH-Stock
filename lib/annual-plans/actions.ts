'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { assertAnnualPlanUploader } from './authorization'
import {
  ANNUAL_PLAN_BUCKET,
  ANNUAL_PLAN_MIME_TYPE,
  annualPlanFilePath,
  isAnnualPlanFilePathAllowed,
  validateAnnualPlanFile,
} from './files'
import { ANNUAL_PLAN_TYPES, annualPlanInputSchema, type AnnualPlanType } from './schema'

const annualPlanRpcResultSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  plan_type: z.enum(ANNUAL_PLAN_TYPES),
  file_path: z.string().min(1),
  file_name: z.string().min(1),
  file_mime_type: z.literal(ANNUAL_PLAN_MIME_TYPE),
  file_size_bytes: z.number().int().positive(),
  previous_file_path: z.string().nullable(),
})

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
    const result = await supabaseAdmin.rpc('upsert_lab_stock_annual_plan', {
      p_fiscal_year: parsedInput.fiscalYear,
      p_plan_type: parsedInput.planType,
      p_actor_id: actor.id,
      p_file_path: path,
      p_file_name: file.name,
      p_file_mime_type: ANNUAL_PLAN_MIME_TYPE,
      p_file_size_bytes: file.size,
    })
    if (result.error) throw new Error(result.error.message)
    record = annualPlanRpcResultSchema.parse(result.data)
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

  if (record.previous_file_path) {
    if (!isAnnualPlanFilePathAllowed(record.previous_file_path)) {
      await removeOrQueue(path)
      throw new Error('เส้นทางไฟล์แผนประจำปีเดิมไม่ถูกต้อง')
    }
    await removeOrQueue(record.previous_file_path)
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
