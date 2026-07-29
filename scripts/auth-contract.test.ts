import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const actor = readFileSync('lib/auth/actor.ts', 'utf8')
const admin = readFileSync('lib/supabase/admin.ts', 'utf8')
assert.match(actor, /auth\.getUser\(\)/)
assert.match(actor, /lab_stock_memberships/)
assert.match(actor, /\.maybeSingle\(\)/)
assert.match(actor, /decideProtectedRoute\(actor\)/)
assert.match(actor, /redirect\('\/access-denied'\)/)
assert.match(readFileSync('proxy.ts', 'utf8'), /access-denied/)
assert.doesNotMatch(actor, /user_metadata/)
assert.doesNotMatch(admin, /NEXT_PUBLIC_.*SERVICE/)
