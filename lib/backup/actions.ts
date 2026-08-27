'use server'

import { revalidatePath } from 'next/cache'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { assertBackupManager } from './authorization'
import { getSupabaseProjectRef } from './config'
import { backupRunSchema, type BackupRun } from './types'

export async function requestDatabaseBackup(): Promise<BackupRun> {
  const actor = await requireActor()
  assertBackupManager(actor)

  const { data, error } = await supabaseAdmin.rpc('request_lab_stock_backup', {
    p_actor_id: actor.id,
    p_project_ref: getSupabaseProjectRef(),
  })

  if (error) throw new Error(`ส่งคำขอสำรองฐานข้อมูลไม่สำเร็จ: ${error.message}`)

  const run = backupRunSchema.parse(data)
  revalidatePath('/settings/backup')
  return run
}
