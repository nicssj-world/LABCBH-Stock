import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const page = read('app/(protected)/settings/access/page.tsx')
assert.match(page, /searchParams:\s*Promise</, 'Next 16 searchParams must be awaited')
assert.match(page, /listMemberships\(actor,\s*\{ search, role \}\)/, 'the page must pass its verified actor into the privileged profile list')
assert.match(page, /AccessMatrix/)
assert.match(page, /canAdministerMemberships|assertMembershipAdministrator/)
assert.doesNotMatch(page, /^['"]use client['"]/m)

const matrix = read('components/settings/AccessMatrix.tsx')
assert.match(matrix, /^['"]use client['"]/m)
assert.match(matrix, /setMembership/)
assert.match(matrix, /ค้นหา/, 'the admin must be able to find a profile')
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
assert.match(actions, /assertMembershipAdministrator/)

const queries = read('lib/access/queries.ts')
assert.match(queries, /server-only/)
assert.match(queries, /assertMembershipAdministrator\(actor\)/, 'the privileged directory query must defend itself')
assert.match(queries, /supabaseAdmin/, 'the admin-only directory query must bypass the portal self-profile RLS policy')
assert.match(queries, /lab_stock_memberships!lab_stock_memberships_profile_id_fkey\s*\(role, active\)/, 'profile membership embeds must select the profile_id relationship explicitly')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /\/settings\/access/, 'admins need a way in from the shell')

console.log('access UI: ok')
