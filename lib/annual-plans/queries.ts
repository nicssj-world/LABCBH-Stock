import 'server-only'

import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { retainedFiscalYears } from './fiscal'
import { ANNUAL_PLAN_TYPES } from './schema'
import type { AnnualPlanRecord, AnnualPlanSlot, AnnualPlanStoredRecord, AnnualPlanYearGroup } from './types'

const planRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  plan_type: z.enum(ANNUAL_PLAN_TYPES),
  file_path: z.string().min(1),
  file_name: z.string().min(1),
  file_mime_type: z.string(),
  file_size_bytes: z.number().int().nonnegative(),
  uploaded_by: z.string().uuid(),
  uploaded_at: z.string(),
})

function toStoredRecord(row: z.infer<typeof planRowSchema>, uploaderName: string | null): AnnualPlanStoredRecord {
  return {
    id: row.id,
    fiscalYear: row.fiscal_year,
    planType: row.plan_type,
    fileName: row.file_name,
    filePath: row.file_path,
    fileSize: row.file_size_bytes,
    mimeType: row.file_mime_type,
    uploadedBy: row.uploaded_by,
    uploadedByName: uploaderName,
    uploadedAt: row.uploaded_at,
  }
}

function toPublicRecord(record: AnnualPlanStoredRecord): AnnualPlanRecord {
  return {
    id: record.id,
    fiscalYear: record.fiscalYear,
    planType: record.planType,
    fileName: record.fileName,
    fileSize: record.fileSize,
    mimeType: record.mimeType,
    uploadedBy: record.uploadedBy,
    uploadedByName: record.uploadedByName,
    uploadedAt: record.uploadedAt,
  }
}

export async function listAnnualPlanSlots(actor: Awaited<ReturnType<typeof requireActor>>, now = new Date()): Promise<AnnualPlanYearGroup[]> {
  const verifiedActor = await requireActor()
  if (verifiedActor.id !== actor.id) throw new Error('ผู้ดำเนินการอ่านแผนประจำปีไม่ตรงกับ session')

  const fiscalYears = retainedFiscalYears(now)
  const result = await supabaseAdmin
    .from('lab_stock_annual_plans')
    .select('id, fiscal_year, plan_type, file_path, file_name, file_mime_type, file_size_bytes, uploaded_by, uploaded_at')
    .in('fiscal_year', [...fiscalYears])
    .order('fiscal_year', { ascending: false })
    .order('plan_type', { ascending: true })

  if (result.error) throw new Error(`อ่านแผนประจำปีไม่สำเร็จ: ${result.error.message}`)

  const rows = planRowSchema.array().parse(result.data ?? [])
  const uploaderIds = [...new Set(rows.map((row) => row.uploaded_by))]
  const uploaderNames = new Map<string, string | null>()
  if (uploaderIds.length > 0) {
    const profiles = await supabaseAdmin.from('profiles').select('id, name').in('id', uploaderIds)
    if (profiles.error) throw new Error(`อ่านชื่อผู้อัปโหลดไม่สำเร็จ: ${profiles.error.message}`)
    for (const profile of profiles.data ?? []) uploaderNames.set(profile.id, profile.name)
  }

  const plans = rows.map((row) => toStoredRecord(row, uploaderNames.get(row.uploaded_by) ?? null))
  const bySlot = new Map<string, AnnualPlanRecord>()
  for (const plan of plans) bySlot.set(`${plan.fiscalYear}:${plan.planType}`, toPublicRecord(plan))

  return fiscalYears.map((fiscalYear) => {
    const slots = ANNUAL_PLAN_TYPES.map((planType): AnnualPlanSlot => ({
      fiscalYear,
      planType,
      plan: bySlot.get(`${fiscalYear}:${planType}`) ?? null,
    })) as [AnnualPlanSlot, AnnualPlanSlot]
    return { fiscalYear, slots }
  })
}
