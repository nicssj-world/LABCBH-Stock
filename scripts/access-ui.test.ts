import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const page = read('app/(protected)/settings/access/page.tsx')
assert.match(page, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(page, /listMemberships\(actor,\s*\{ search, role \}\)/, 'the page must pass its verified actor into the privileged profile list')
assert.match(page, /AccessMatrix/)
assert.match(page, /canManageMemberships/)
assert.doesNotMatch(page, /^['"]use client['"]/m)

const matrix = read('components/settings/AccessMatrix.tsx')
assert.match(matrix, /^['"]use client['"]/m)
assert.match(matrix, /head:\s*'หัวหน้างาน'/, 'the head role must use its current label')
assert.doesNotMatch(matrix, /ผู้ออกรายงาน/, 'the retired reporter role must not be offered in the access matrix')
assert.match(matrix, /setMembership/)
assert.match(matrix, /canManageAdminRole/)
assert.match(matrix, /เฉพาะผู้ดูแลระบบ/, 'stock officers must see why admin role is read-only')
assert.match(matrix, /ค้นหา/, 'the admin must be able to find a profile')
assert.doesNotMatch(matrix, /แสดงผล/, 'access search must not require an apply button')
assert.match(matrix, /setTimeout/, 'access search must debounce URL updates automatically')
assert.match(matrix, /สิทธิ์ในระบบพอร์ทัล/, 'the portal role is shown for context')
assert.match(matrix, /บันทึกแล้ว|บันทึกสำเร็จ/, 'saving must confirm explicitly')

// Role filters are buttons with aria-pressed, not a tablist.
assert.match(matrix, /aria-pressed/)
assert.doesNotMatch(matrix, /role="tablist"/)
assert.doesNotMatch(matrix, /role="tab"/)

// Intrinsic access is surfaced so an admin is not confused when a toggle looks
// like it did nothing.
assert.match(matrix, /สิทธิ์ติดตัว|ได้สิทธิ์จากพอร์ทัล/)

assert.doesNotMatch(matrix, /createBrowserClient|supabase\.from/)

const actions = read('lib/access/actions.ts')
assert.match(actions, /^['"]use server['"]/m)
assert.match(actions, /supabaseAdmin\.rpc\('set_lab_stock_membership'/)
assert.match(actions, /assertMembershipManager/)
assert.match(actions, /canChangeMembershipRole/)

const queries = read('lib/access/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /assertMembershipManager\(actor\)/, 'the privileged directory query must defend itself')
assert.match(queries, /supabaseAdmin/, 'the admin-only directory query must bypass the portal self-profile RLS policy')
assert.match(queries, /lab_stock_memberships!lab_stock_memberships_profile_id_fkey\s*\(role, active\)/, 'profile membership embeds must select the profile_id relationship explicitly')

const schema = read('lib/access/schema.ts')
assert.doesNotMatch(schema, /reporter/, 'new memberships must not accept the retired reporter role')

const actor = read('lib/auth/actor.ts')
assert.doesNotMatch(actor, /'reporter'/, 'the application role type must not include the retired reporter role')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/settings\/access/, 'admins need a way in from the shell')

console.log('access UI: ok')
