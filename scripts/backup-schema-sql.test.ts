import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20260827090000_lab_stock_database_backups.sql', 'utf8')
const desktopSql = readFileSync('supabase/migrations/20260827100000_lab_stock_database_backups_desktop_request.sql', 'utf8')
const portalSql = readFileSync('supabase/migrations/20260827110001_lab_stock_database_backups_portal_project.sql', 'utf8')

assert.match(sql, /create table if not exists public\.lab_stock_backup_runs/i)
assert.match(sql, /create table if not exists public\.lab_stock_backup_runners/i)
assert.match(sql, /status text not null default 'requested'/i)
assert.match(sql, /'requested'[\s\S]*'running'[\s\S]*'succeeded'[\s\S]*'failed'[\s\S]*'pruned'/i)
assert.match(sql, /trigger_source text not null check \(trigger_source in \('manual', 'scheduled'\)\)/i)
assert.match(sql, /sha256 text check \(sha256 is null or sha256 ~ '\^\[0-9a-f\]\{64\}\$'/i)
assert.match(sql, /on public\.lab_stock_backup_runs \(lower\(project_ref\)\)[\s\S]*where status in \('requested', 'running'\)/i)
assert.match(sql, /alter table public\.lab_stock_backup_runs enable row level security/i)
assert.match(sql, /revoke all on table public\.lab_stock_backup_runs from anon, authenticated/i)
assert.match(sql, /alter table public\.lab_stock_backup_runners enable row level security/i)

for (const functionName of [
  'request_lab_stock_backup',
  'enqueue_lab_stock_backup',
  'heartbeat_lab_stock_backup_runner',
  'claim_lab_stock_backup',
  'complete_lab_stock_backup',
  'fail_lab_stock_backup',
  'mark_lab_stock_backup_pruned',
]) {
  assert.match(sql, new RegExp(`create or replace function public\\.${functionName}\\(`, 'i'))
  assert.match(sql, new RegExp(`grant execute on function public\\.${functionName}\\([^;]+to service_role`, 'i'))
  assert.doesNotMatch(sql, new RegExp(`grant execute on function public\\.${functionName}\\([^;]+to authenticated`, 'i'))
}

assert.match(sql, /perform public\.assert_stock_officer_actor\(p_actor_id\)/i)
assert.match(sql, /for update skip locked/i)
assert.match(sql, /lease_expires_at = now\(\) \+ interval '6 hours'/i)
assert.match(sql, /status = 'succeeded'/i)
assert.match(sql, /status = 'failed'/i)
assert.match(sql, /status = 'pruned'/i)
assert.match(desktopSql, /create or replace function public\.request_lab_stock_backup_from_runner\([\s\S]*p_project_ref text/i)
assert.match(desktopSql, /trigger_source\s*\)[\s\S]*'manual'/i)
assert.match(desktopSql, /grant execute on function public\.request_lab_stock_backup_from_runner\(text\) to service_role/i)
assert.doesNotMatch(desktopSql, /grant execute on function public\.request_lab_stock_backup_from_runner\(text\) to authenticated/i)
assert.match(portalSql, /create table if not exists public\.lab_stock_backup_runs/i)
assert.match(portalSql, /create table if not exists public\.lab_stock_backup_runners/i)
assert.match(portalSql, /create or replace function public\.request_lab_stock_backup_from_runner\([\s\S]*p_project_ref text/i)
assert.match(portalSql, /revoke all on table public\.lab_stock_backup_runs from anon, authenticated/i)
assert.match(portalSql, /grant execute on function public\.request_lab_stock_backup_from_runner\(text\) to service_role/i)
assert.doesNotMatch(portalSql, /grant execute on function public\.request_lab_stock_backup_from_runner\(text\) to authenticated/i)

console.log('database backup SQL contract: ok')
