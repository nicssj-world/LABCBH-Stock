import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const migrationPath = 'supabase/migrations/20260801200000_seed_portal_viewers.sql'
assert.ok(existsSync(migrationPath), 'eligible portal users need a viewer-default import migration')
const migration = readFileSync(migrationPath, 'utf8')

assert.match(migration, /profile\.role\s+in\s*\(\s*'Admin',\s*'Manager',\s*'Medical Technologist',\s*'Medical Science Technician'\s*\)/i)
assert.match(migration, /profile\.status\s*=\s*'active'/i)
assert.match(migration, /profile\.deleted_at\s+is\s+null/i)
assert.match(migration, /'viewer'/i)
assert.match(migration, /on conflict \(profile_id, role\) do nothing/i, 'the default import must preserve every existing membership decision')

console.log('portal viewer defaults: ok')
