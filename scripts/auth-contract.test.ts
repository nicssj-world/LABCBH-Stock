import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const actor = readFileSync('lib/auth/actor.ts', 'utf8')
const resolution = readFileSync('lib/auth/resolution.ts', 'utf8')
const admin = readFileSync('lib/supabase/admin.ts', 'utf8')
const accessDenied = readFileSync('app/(auth)/access-denied/page.tsx', 'utf8')
const login = readFileSync('app/(auth)/login/page.tsx', 'utf8')
// The session is authenticated by verifying its JWT signature against the
// cached JWKS, not by asking the Auth service over the network on every
// request. getUser() cost a measured 150-180ms before any page could start
// reading its own data, so a reintroduction of it here is a regression.
assert.match(resolution, /auth\.getClaims\(\)/)
assert.match(actor, /resolveAuthenticatedSubject\(await readAuthClaims\(supabase\)\)/)
assert.doesNotMatch(actor, /auth\.getUser\(\)/)
// Verification must stay cryptographic. getSession() returns whatever is in
// the cookie without checking its signature, and must never stand in for this.
assert.doesNotMatch(resolution, /auth\.getSession\(\)/)
assert.doesNotMatch(actor, /auth\.getSession\(\)/)
// Roles still come from lab_stock_memberships, now embedded in the profile
// read. The !profile_id disambiguator is load-bearing: the table also
// references profiles through granted_by and updated_by, and PostgREST
// rejects an embed it cannot attribute to one foreign key.
assert.match(actor, /lab_stock_memberships!profile_id\(role,active\)/)
assert.match(actor, /\.maybeSingle\(\)/)
assert.match(actor, /decideProtectedRoute\(actor\)/)
assert.match(actor, /redirect\('\/access-denied'\)/)
assert.match(readFileSync('proxy.ts', 'utf8'), /access-denied/)
assert.match(accessDenied, /LogoutButton/)
assert.doesNotMatch(accessDenied, /href="\/login"/)
assert.doesNotMatch(actor, /user_metadata/)
assert.doesNotMatch(admin, /NEXT_PUBLIC_.*SERVICE/)

const stockConfirm = readFileSync('app/auth/confirm/route.ts', 'utf8')
assert.match(stockConfirm, /type !== 'magiclink'/, 'only a portal magic-link handoff may create a stock session')
assert.match(stockConfirm, /auth\.verifyOtp\(\{ type: 'magiclink', token_hash \}\)/, 'the one-time token hash must be consumed server-side')
assert.match(stockConfirm, /NextResponse\.redirect\(new URL\('\/dashboard'/, 'a successful handoff must land on the stock dashboard')
assert.match(stockConfirm, /Cache-Control.*no-store/, 'one-time credentials must not be cached')
assert.match(stockConfirm, /Referrer-Policy.*no-referrer/, 'one-time credentials must not be forwarded as a referrer')

const proxy = readFileSync('proxy.ts', 'utf8')
assert.match(proxy, /\/auth\/confirm/, 'the one-time confirmation route must be reachable before a stock session exists')
assert.doesNotMatch(proxy, /path === '\/login'/, 'a stale session must not bounce the login page back to the dashboard')

assert.match(login, /type=\{showPassword \? 'text' : 'password'\}/)
assert.match(login, /type="button"/)
assert.match(login, /aria-pressed=\{showPassword\}/)
assert.match(login, /showPassword \? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'/)
assert.match(login, /ระบบคลังน้ำยาและ<br \/><span className="login-bench-panel__title-line">วัสดุวิทยาศาสตร์<\/span>/, 'the login title must keep วัสดุวิทยาศาสตร์ together')
assert.match(login, /รับเข้า · ควบคุม · เบิกจ่าย/, 'the login panel must use the concise stock workflow')
assert.match(login, /รับเข้าและตรวจรับวัสดุ/, 'the login panel must lead with receiving work')
assert.match(login, /ควบคุมคงคลังและ PR/, 'the login panel must include inventory and PR work')
assert.doesNotMatch(login, /สัญญา/, 'the login panel must not describe the retired contract workflow')
