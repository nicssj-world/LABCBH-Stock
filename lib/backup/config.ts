import 'server-only'

export const BACKUP_RUNNER_VERSION = '1.0.0'
export const BACKUP_RUNNER_LIVE_WINDOW_MS = 3 * 60 * 1000
export const BACKUP_PRODUCTION_PROJECT_REF = 'fslagsuorkcckvvtrmyi'

export function getSupabaseProjectRef(): string {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const match = value ? /^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/i.exec(value) : null
  if (!match) throw new Error('ไม่พบ Supabase project URL ที่ถูกต้องสำหรับระบบสำรองข้อมูล')
  const projectRef = match[1].toLowerCase()
  if (projectRef !== BACKUP_PRODUCTION_PROJECT_REF) {
    throw new Error(`ระบบสำรองข้อมูลรองรับเฉพาะ Production project ${BACKUP_PRODUCTION_PROJECT_REF}`)
  }
  return projectRef
}
