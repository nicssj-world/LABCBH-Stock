import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const actor = readFileSync('lib/auth/actor.ts', 'utf8')
const admin = readFileSync('lib/supabase/admin.ts', 'utf8')
const accessDenied = readFileSync('app/(auth)/access-denied/page.tsx', 'utf8')
const login = readFileSync('app/(auth)/login/page.tsx', 'utf8')
assert.match(actor, /auth\.getUser\(\)/)
assert.match(actor, /lab_stock_memberships/)
assert.match(actor, /\.maybeSingle\(\)/)
assert.match(actor, /decideProtectedRoute\(actor\)/)
assert.match(actor, /redirect\('\/access-denied'\)/)
assert.match(readFileSync('proxy.ts', 'utf8'), /access-denied/)
assert.match(accessDenied, /LogoutButton/)
assert.doesNotMatch(accessDenied, /href="\/login"/)
assert.doesNotMatch(actor, /user_metadata/)
assert.doesNotMatch(admin, /NEXT_PUBLIC_.*SERVICE/)

assert.match(login, /type=\{showPassword \? 'text' : 'password'\}/)
assert.match(login, /type="button"/)
assert.match(login, /aria-pressed=\{showPassword\}/)
assert.match(login, /showPassword \? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'/)
