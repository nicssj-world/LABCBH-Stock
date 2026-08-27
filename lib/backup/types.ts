import { z } from 'zod'

export const BACKUP_STATUSES = [
  'requested',
  'running',
  'succeeded',
  'failed',
  'pruned',
] as const

export type BackupStatus = (typeof BACKUP_STATUSES)[number]

export const BACKUP_TRIGGER_SOURCES = ['manual', 'scheduled'] as const
export type BackupTriggerSource = (typeof BACKUP_TRIGGER_SOURCES)[number]

export const backupRunSchema = z.object({
  id: z.string().uuid(),
  project_ref: z.string(),
  status: z.enum(BACKUP_STATUSES),
  trigger_source: z.enum(BACKUP_TRIGGER_SOURCES),
  requested_by: z.string().uuid().nullable(),
  runner_id: z.string().nullable(),
  requested_at: z.string(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  lease_expires_at: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  file_name: z.string().nullable(),
  relative_path: z.string().nullable(),
  bytes: z.union([z.number(), z.string()]).transform(Number).nullable(),
  sha256: z.string().nullable(),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  metadata: z.record(z.unknown()),
  created_at: z.string(),
})

export type BackupRun = z.infer<typeof backupRunSchema>

export const backupRunnerSchema = z.object({
  runner_id: z.string(),
  project_ref: z.string(),
  version: z.string().nullable(),
  last_seen_at: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type BackupRunner = z.infer<typeof backupRunnerSchema>

export const BACKUP_RUNNER_STATES = ['ready', 'waiting', 'running', 'offline', 'unknown'] as const
export type BackupRunnerState = (typeof BACKUP_RUNNER_STATES)[number]

export interface BackupDashboard {
  projectRef: string
  runs: BackupRun[]
  runners: BackupRunner[]
  latestRun: BackupRun | null
  lastSuccessfulRun: BackupRun | null
  activeRun: BackupRun | null
  runnerState: BackupRunnerState
  primaryRunner: BackupRunner | null
}
