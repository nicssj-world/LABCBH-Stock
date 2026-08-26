import 'server-only'

import { z } from 'zod'
import { enqueueStorageCleanupJobBestEffort } from '@/lib/storage/cleanup-jobs'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { fiscalYearOfDate } from './fiscal'
import { ANNUAL_PLAN_BUCKET, isAnnualPlanFilePathAllowed } from './files'

const expiredPlanSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  plan_type: z.string(),
  file_path: z.string().min(1),
})

function isMissingStorageObject(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { statusCode?: number | string; message?: string }
  return (
    String(candidate.statusCode ?? '') === '404'
    || /not found|does not exist|object not found|no such object/i.test(candidate.message ?? '')
  )
}

async function removeAnnualPlanObject(path: string) {
  const result = await supabaseAdmin.storage.from(ANNUAL_PLAN_BUCKET).remove([path])
  if (result.error && !isMissingStorageObject(result.error)) throw new Error(result.error.message)
}

async function queueRetentionRetry(planId: string, expectedPath: string) {
  await enqueueStorageCleanupJobBestEffort({
    storageBackend: 'supabase_storage',
    bucketName: null,
    storageKey: null,
    jobKind: 'annual_plan_retention_retry',
    resourceId: planId,
    metadata: { expectedFilePath: expectedPath },
  })
}

export async function cleanupExpiredAnnualPlans(systemActorId: string): Promise<{ deleted: number; queued: number }> {
  const currentFiscalYear = fiscalYearOfDate(new Date())
  const result = await supabaseAdmin.rpc('list_expired_lab_stock_annual_plans', {
    p_current_fiscal_year: currentFiscalYear,
  })
  if (result.error) throw new Error(`อ่านแผนประจำปีที่หมดอายุไม่สำเร็จ: ${result.error.message}`)

  let deleted = 0
  let queued = 0
  for (const rawPlan of Array.isArray(result.data) ? result.data : []) {
    const plan = expiredPlanSchema.parse(rawPlan)
    if (!isAnnualPlanFilePathAllowed(plan.file_path)) {
      await queueRetentionRetry(plan.id, plan.file_path)
      queued += 1
      continue
    }

    try {
      // Delete the exact object observed by the expired-row query first. The
      // hard-delete RPC checks the same path, so a replacement cannot remove
      // the new row after a race.
      await removeAnnualPlanObject(plan.file_path)
      const finalized = await supabaseAdmin.rpc('hard_delete_lab_stock_annual_plan', {
        p_plan_id: plan.id,
        p_actor_id: systemActorId,
        p_expected_file_path: plan.file_path,
      })
      if (finalized.error) throw new Error(finalized.error.message)
      const outcome = z.object({ deleted: z.boolean() }).parse(finalized.data)
      if (outcome.deleted) deleted += 1
    } catch (error) {
      await queueRetentionRetry(plan.id, plan.file_path)
      queued += 1
      console.error('ล้างแผนประจำปีที่หมดอายุไม่สำเร็จ', {
        planId: plan.id,
        filePath: plan.file_path,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { deleted, queued }
}

export async function retryAnnualPlanHardDelete(
  planId: string,
  expectedPath: string,
  systemActorId: string,
): Promise<void> {
  const parsedPlanId = z.string().uuid().parse(planId)
  if (!isAnnualPlanFilePathAllowed(expectedPath)) throw new Error('เส้นทางไฟล์แผนประจำปีสำหรับ retry ไม่ถูกต้อง')

  const current = await supabaseAdmin
    .from('lab_stock_annual_plans')
    .select('file_path')
    .eq('id', parsedPlanId)
    .maybeSingle()
  if (current.error) throw new Error(current.error.message)
  if (!current.data || current.data.file_path !== expectedPath) return

  await removeAnnualPlanObject(expectedPath)
  const finalized = await supabaseAdmin.rpc('hard_delete_lab_stock_annual_plan', {
    p_plan_id: parsedPlanId,
    p_actor_id: systemActorId,
    p_expected_file_path: expectedPath,
  })
  if (finalized.error) throw new Error(finalized.error.message)
}
