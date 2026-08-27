import 'server-only'

import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { assertBackupManager } from './authorization'
import { BACKUP_RUNNER_LIVE_WINDOW_MS, getSupabaseProjectRef } from './config'
import {
  backupRunnerSchema,
  backupRunSchema,
  type BackupDashboard,
  type BackupRunner,
  type BackupRun,
  type BackupRunnerState,
} from './types'
import type { Actor } from '@/lib/auth/actor'

const BACKUP_RUN_SELECT = [
  'id',
  'project_ref',
  'status',
  'trigger_source',
  'requested_by',
  'runner_id',
  'requested_at',
  'started_at',
  'completed_at',
  'lease_expires_at',
  'attempts',
  'file_name',
  'relative_path',
  'bytes',
  'sha256',
  'error_code',
  'error_message',
  'metadata',
  'created_at',
].join(',')

const BACKUP_RUNNER_SELECT = [
  'runner_id',
  'project_ref',
  'version',
  'last_seen_at',
  'created_at',
  'updated_at',
].join(',')

function queryError(operation: string, error: { message: string } | null): never | void {
  if (error) throw new Error(`${operation}ไม่สำเร็จ: ${error.message}`)
}

export async function listBackupRuns(projectRef: string, limit = 40): Promise<BackupRun[]> {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
  const { data, error } = await supabaseAdmin
    .from('lab_stock_backup_runs')
    .select(BACKUP_RUN_SELECT)
    .eq('project_ref', projectRef)
    .order('requested_at', { ascending: false })
    .limit(boundedLimit)

  queryError('อ่านประวัติการสำรองฐานข้อมูล', error)
  return backupRunSchema.array().parse(data ?? [])
}

export async function listBackupRunners(projectRef: string): Promise<BackupRunner[]> {
  const { data, error } = await supabaseAdmin
    .from('lab_stock_backup_runners')
    .select(BACKUP_RUNNER_SELECT)
    .eq('project_ref', projectRef)
    .order('last_seen_at', { ascending: false })
    .limit(20)

  queryError('อ่านสถานะ backup runner', error)
  return backupRunnerSchema.array().parse(data ?? [])
}

function isLiveRunner(runner: BackupRunner, now: number): boolean {
  return now - new Date(runner.last_seen_at).getTime() <= BACKUP_RUNNER_LIVE_WINDOW_MS
}

function deriveRunnerState(
  activeRun: BackupRun | null,
  runners: BackupRunner[],
): { state: BackupRunnerState; primaryRunner: BackupRunner | null } {
  const now = Date.now()
  const primaryRunner = runners[0] ?? null
  const liveRunner = runners.find((runner) => isLiveRunner(runner, now)) ?? null

  if (activeRun?.status === 'running') return { state: 'running', primaryRunner: activeRun.runner_id ? runners.find((runner) => runner.runner_id === activeRun.runner_id) ?? primaryRunner : primaryRunner }
  if (activeRun?.status === 'requested') return { state: liveRunner ? 'waiting' : 'offline', primaryRunner: liveRunner ?? primaryRunner }
  if (liveRunner) return { state: 'ready', primaryRunner: liveRunner }
  if (primaryRunner) return { state: 'offline', primaryRunner }
  return { state: 'unknown', primaryRunner: null }
}

export async function getBackupDashboard(actor: Actor): Promise<BackupDashboard> {
  assertBackupManager(actor)
  const projectRef = getSupabaseProjectRef()
  const [runs, runners] = await Promise.all([
    listBackupRuns(projectRef),
    listBackupRunners(projectRef),
  ])
  const latestRun = runs[0] ?? null
  const activeRun = runs.find((run) => run.status === 'requested' || run.status === 'running') ?? null
  const lastSuccessfulRun = runs.find((run) => run.status === 'succeeded' || run.status === 'pruned') ?? null
  const { state, primaryRunner } = deriveRunnerState(activeRun, runners)

  return {
    projectRef,
    runs,
    runners,
    latestRun,
    lastSuccessfulRun,
    activeRun,
    runnerState: state,
    primaryRunner,
  }
}

export const backupDashboardInputSchema = z.object({
  projectRef: z.string().min(1),
})
