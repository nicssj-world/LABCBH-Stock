# Auto logout หลังไม่มีการใช้งาน 30 นาที Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เพิ่ม idle timeout ให้ protected routes ออกจากระบบหลังไม่มีการใช้งาน 30 นาที พร้อม dialog เตือนล่วงหน้า 1 นาทีและปุ่มใช้งานต่อ

**Architecture:** แยก state machine ของ idle timeout ไว้ใน `lib/auth/idle-timeout.ts` เพื่อทดสอบ transition ด้วย fake scheduler ได้โดยไม่ต้องรอเวลาจริง ส่วน `IdleSessionGuard` จะเชื่อม browser activity, native modal, Supabase local sign-out และ router เข้าด้วยกัน แล้ว mount ครั้งเดียวใน `AppShell`

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase browser client, native `<dialog>`, Node `assert` + `tsx` contract/behavior tests

## Global Constraints

- Protected shell เท่านั้นที่เริ่ม idle timeout; หน้า `/login` และ public routes ไม่ติดตั้ง guard
- Idle timeout ต้องเท่ากับ 30 นาที (`30 * 60 * 1000`)
- Warning ต้องเริ่มก่อน timeout 1 นาที (`60 * 1000`)
- กิจกรรม `pointerdown`, `keydown`, `touchstart`, `wheel` และ `scroll` reset timer ขณะอยู่ใน active state
- ระหว่าง warning modal ต้องไม่ถูกปิดด้วย Escape หรือการกดนอก modal; ต้องกด `ใช้งานต่อ` เพื่อ reset
- เมื่อ timeout ต้องเรียก `supabase.auth.signOut({ scope: 'local' })` และนำทางไป `/login`
- หาก sign out ล้มเหลวต้องคง modal ไว้ แสดงข้อผิดพลาดภาษาไทย และให้ retry ได้
- ไม่เพิ่ม database table, migration, API, service-role credential หรือ server-side activity state
- ทำงานตรงบน branch `main` ตามคำสั่งผู้ใช้ และไม่สร้าง worktree แยก

---

## File Map

- Create: `lib/auth/idle-timeout.ts` — pure idle timeout controller, state transitions, injected scheduler
- Create: `components/ui/IdleSessionGuard.tsx` — browser event lifecycle, warning modal, Supabase sign-out and redirect
- Modify: `components/ui/AppShell.tsx` — mount one guard inside the protected shell
- Modify: `app/globals.css` — warning modal layout and responsive styles
- Create: `scripts/idle-timeout.test.ts` — behavior tests for the controller
- Create: `scripts/idle-session-guard-contract.test.ts` — source contract tests for auth/UI integration
- Modify: `package.json` — include both tests in `test:app-shell`

## Interfaces

`lib/auth/idle-timeout.ts` produces this interface for the UI layer:

```ts
export type IdleTimeoutState = 'active' | 'warning' | 'expired'

export interface IdleTimeoutSnapshot {
  state: IdleTimeoutState
  remainingMs: number
}

export interface IdleTimeoutScheduler {
  now: () => number
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface IdleTimeoutController {
  start: () => void
  stop: () => void
  recordActivity: () => void
  continueSession: () => void
  getSnapshot: () => IdleTimeoutSnapshot
  subscribe: (listener: (snapshot: IdleTimeoutSnapshot) => void) => () => void
}

export function createIdleTimeoutController(options?: {
  timeoutMs?: number
  warningLeadMs?: number
  scheduler?: IdleTimeoutScheduler
}): IdleTimeoutController
```

The controller emits `active`, `warning`, and `expired` snapshots. `recordActivity` only resets an active session; `continueSession` is the explicit reset allowed from warning state.

### Task 1: Define the failing idle-timeout behavior tests

**Files:**

- Create: `scripts/idle-timeout.test.ts`
- Test target to be created next: `lib/auth/idle-timeout.ts`

**Interfaces:**

- Consumes: the public controller interface above, with short test durations injected
- Produces: executable red tests that define warning, reset, continue, expiry, and stop behavior

- [ ] **Step 1: Write the failing test**

Create a deterministic scheduler and assert the required transitions:

```ts
import assert from 'node:assert/strict'
import {
  createIdleTimeoutController,
  type IdleTimeoutScheduler,
} from '../lib/auth/idle-timeout'

function createFakeScheduler() {
  let now = 0
  let nextId = 0
  const timers = new Map<number, { callback: () => void; dueAt: number; order: number }>()

  const scheduler: IdleTimeoutScheduler = {
    now: () => now,
    setTimeout: (callback, delayMs) => {
      const id = ++nextId
      timers.set(id, { callback, dueAt: now + delayMs, order: id })
      return id
    },
    clearTimeout: (handle) => {
      timers.delete(handle as number)
    },
  }

  function advanceBy(deltaMs: number) {
    const target = now + deltaMs

    while (true) {
      const next = [...timers.entries()]
        .filter(([, timer]) => timer.dueAt <= target)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[1].order - right[1].order)[0]

      if (!next) break
      now = next[1].dueAt
      timers.delete(next[0])
      next[1].callback()
    }

    now = target
  }

  return { scheduler, advanceBy }
}

function createTestController() {
  const fake = createFakeScheduler()
  const controller = createIdleTimeoutController({
    timeoutMs: 30_000,
    warningLeadMs: 10_000,
    scheduler: fake.scheduler,
  })
  return { ...fake, controller }
}

{
  const { controller, advanceBy } = createTestController()
  controller.start()
  assert.deepEqual(controller.getSnapshot(), { state: 'active', remainingMs: 30_000 })

  advanceBy(19_999)
  assert.equal(controller.getSnapshot().state, 'active')

  advanceBy(1)
  assert.deepEqual(controller.getSnapshot(), { state: 'warning', remainingMs: 10_000 })
}

{
  const { controller, advanceBy } = createTestController()
  controller.start()
  advanceBy(15_000)
  controller.recordActivity()
  assert.deepEqual(controller.getSnapshot(), { state: 'active', remainingMs: 30_000 })

  advanceBy(19_999)
  assert.equal(controller.getSnapshot().state, 'active')
  advanceBy(1)
  assert.equal(controller.getSnapshot().state, 'warning')
}

{
  const { controller, advanceBy } = createTestController()
  controller.start()
  advanceBy(20_000)
  assert.equal(controller.getSnapshot().state, 'warning')

  controller.continueSession()
  assert.deepEqual(controller.getSnapshot(), { state: 'active', remainingMs: 30_000 })

  advanceBy(30_000)
  assert.deepEqual(controller.getSnapshot(), { state: 'expired', remainingMs: 0 })
}

{
  const { controller, advanceBy } = createTestController()
  const snapshots: string[] = []
  controller.subscribe((snapshot) => snapshots.push(snapshot.state))
  controller.start()
  advanceBy(30_000)

  assert.equal(snapshots.includes('warning'), true)
  assert.equal(snapshots.at(-1), 'expired')

  advanceBy(10_000)
  assert.equal(snapshots.at(-1), 'expired')
}

{
  const { controller, advanceBy } = createTestController()
  controller.start()
  controller.stop()
  advanceBy(30_000)
  assert.deepEqual(controller.getSnapshot(), { state: 'active', remainingMs: 30_000 })
}

console.log('idle timeout behavior: ok')
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

`npx tsx scripts/idle-timeout.test.ts`

Expected: FAIL before implementation because `../lib/auth/idle-timeout` does not exist. The failure must be a missing module/import failure, not a syntax error in the test.

- [ ] **Step 3: Commit the red test**

`git add scripts/idle-timeout.test.ts; git commit -m "test: define idle timeout behavior"`

### Task 2: Implement the minimal deterministic idle-timeout controller

**Files:**

- Create: `lib/auth/idle-timeout.ts`
- Test: `scripts/idle-timeout.test.ts`

**Interfaces:**

- Consumes: `IdleTimeoutScheduler` and options from the File Map
- Produces: `createIdleTimeoutController` used by `IdleSessionGuard`

- [ ] **Step 1: Write the minimal implementation**

Create the controller with wall-clock based remaining time, one scheduled check in active state, one-second checks during warning, and no repeated expiry timer:

```ts
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000
export const IDLE_WARNING_LEAD_MS = 60 * 1000

export type IdleTimeoutState = 'active' | 'warning' | 'expired'

export interface IdleTimeoutSnapshot {
  state: IdleTimeoutState
  remainingMs: number
}

export interface IdleTimeoutScheduler {
  now: () => number
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export interface IdleTimeoutController {
  start: () => void
  stop: () => void
  recordActivity: () => void
  continueSession: () => void
  getSnapshot: () => IdleTimeoutSnapshot
  subscribe: (listener: (snapshot: IdleTimeoutSnapshot) => void) => () => void
}

interface IdleTimeoutOptions {
  timeoutMs?: number
  warningLeadMs?: number
  scheduler?: IdleTimeoutScheduler
}

const defaultScheduler: IdleTimeoutScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createIdleTimeoutController(options: IdleTimeoutOptions = {}): IdleTimeoutController {
  const timeoutMs = options.timeoutMs ?? IDLE_TIMEOUT_MS
  const warningLeadMs = options.warningLeadMs ?? IDLE_WARNING_LEAD_MS
  const scheduler = options.scheduler ?? defaultScheduler

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('idle timeout must be greater than zero')
  }
  if (!Number.isFinite(warningLeadMs) || warningLeadMs <= 0 || warningLeadMs >= timeoutMs) {
    throw new Error('idle warning lead time must be between zero and the timeout')
  }

  let started = false
  let lastActivityAt = 0
  let timer: unknown = null
  let snapshot: IdleTimeoutSnapshot = { state: 'active', remainingMs: timeoutMs }
  const listeners = new Set<(nextSnapshot: IdleTimeoutSnapshot) => void>()

  function emit() {
    const nextSnapshot = { ...snapshot }
    listeners.forEach((listener) => listener(nextSnapshot))
  }

  function clearScheduledCheck() {
    if (timer === null) return
    scheduler.clearTimeout(timer)
    timer = null
  }

  function scheduleCheck() {
    clearScheduledCheck()
    if (!started || snapshot.state === 'expired') return

    const elapsedMs = Math.max(0, scheduler.now() - lastActivityAt)
    const remainingMs = Math.max(0, timeoutMs - elapsedMs)

    if (remainingMs === 0) {
      snapshot = { state: 'expired', remainingMs: 0 }
      emit()
      return
    }

    snapshot = {
      state: remainingMs <= warningLeadMs ? 'warning' : 'active',
      remainingMs,
    }
    emit()

    const delayMs = snapshot.state === 'warning'
      ? Math.min(remainingMs, 1_000)
      : Math.max(1, remainingMs - warningLeadMs)
    timer = scheduler.setTimeout(scheduleCheck, delayMs)
  }

  function resetToActive() {
    if (!started || snapshot.state === 'expired') return
    lastActivityAt = scheduler.now()
    snapshot = { state: 'active', remainingMs: timeoutMs }
    emit()
    scheduleCheck()
  }

  return {
    start() {
      if (started) return
      started = true
      lastActivityAt = scheduler.now()
      snapshot = { state: 'active', remainingMs: timeoutMs }
      scheduleCheck()
    },
    stop() {
      started = false
      clearScheduledCheck()
    },
    recordActivity() {
      if (snapshot.state !== 'active') return
      resetToActive()
    },
    continueSession() {
      if (snapshot.state !== 'warning') return
      resetToActive()
    },
    getSnapshot() {
      return { ...snapshot }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
```

- [ ] **Step 2: Run the focused test to verify it passes**

Run:

`npx tsx scripts/idle-timeout.test.ts`

Expected: PASS with `idle timeout behavior: ok`. If it fails, adjust the controller only; do not weaken the assertions.

- [ ] **Step 3: Commit the controller**

`git add lib/auth/idle-timeout.ts scripts/idle-timeout.test.ts; git commit -m "feat: add idle timeout controller"`

### Task 3: Add the warning guard and protected-shell integration

**Files:**

- Create: `scripts/idle-session-guard-contract.test.ts`
- Create: `components/ui/IdleSessionGuard.tsx`
- Modify: `components/ui/AppShell.tsx`
- Modify: `app/globals.css`

**Interfaces:**

- Consumes: `createIdleTimeoutController`, `IDLE_TIMEOUT_MS`, `IdleTimeoutSnapshot`, existing `Button`, `createClient`, and `useRouter`
- Produces: one `IdleSessionGuard` mounted for every protected route

- [ ] **Step 1: Write the failing UI/auth contract test**

Create a source-level contract test because this repository has no React DOM test runner. It must fail with a missing-file error before the component exists:

```ts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')
const guard = read('components/ui/IdleSessionGuard.tsx')
const shell = read('components/ui/AppShell.tsx')
const styles = read('app/globals.css')

assert.match(guard, /createIdleTimeoutController/)
assert.match(guard, /IDLE_TIMEOUT_MS/)
assert.match(guard, /'pointerdown'/)
assert.match(guard, /'keydown'/)
assert.match(guard, /'touchstart'/)
assert.match(guard, /'wheel'/)
assert.match(guard, /'scroll'/)
assert.match(guard, /auth\.onAuthStateChange/)
assert.match(guard, /signOut\(\{ scope: 'local' \}\)/)
assert.match(guard, /router\.replace\('\/login'\)/)
assert.match(guard, /router\.refresh\(\)/)
assert.match(guard, /role="dialog"/)
assert.match(guard, /aria-modal="true"/)
assert.match(guard, /event\.preventDefault\(\)/)
assert.match(guard, /ใช้งานต่อ/)
assert.match(guard, /role="alert"/)
assert.match(guard, /ลองออกจากระบบอีกครั้ง/)
assert.match(shell, /<IdleSessionGuard \/>/)
assert.match(styles, /\.idle-session-dialog\s*\{/)
assert.match(styles, /\.idle-session-dialog__countdown\s*\{/)

console.log('idle session guard contract: ok')
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run:

`npx tsx scripts/idle-session-guard-contract.test.ts`

Expected: FAIL with `ENOENT` for `components/ui/IdleSessionGuard.tsx`. This proves the contract is not passing accidentally.

- [ ] **Step 3: Implement the guard and mount it once**

Create `components/ui/IdleSessionGuard.tsx` with these behaviors:

```tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  createIdleTimeoutController,
  IDLE_TIMEOUT_MS,
  type IdleTimeoutController,
  type IdleTimeoutSnapshot,
} from '@/lib/auth/idle-timeout'
import { createClient } from '@/lib/supabase/client'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
const INITIAL_SNAPSHOT: IdleTimeoutSnapshot = {
  state: 'active',
  remainingMs: IDLE_TIMEOUT_MS,
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return minutes + ':' + seconds
}

export function IdleSessionGuard() {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const controllerRef = useRef<IdleTimeoutController | null>(null)
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOutAfterTimeout = useCallback(async () => {
    setError(null)
    setIsSigningOut(true)

    try {
      const { error: signOutError } = await createClient().auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      router.replace('/login')
      router.refresh()
    } catch {
      setError('ออกจากระบบอัตโนมัติไม่สำเร็จ กรุณาลองอีกครั้ง')
      setIsSigningOut(false)
    }
  }, [router])

  useEffect(() => {
    const controller = createIdleTimeoutController()
    controllerRef.current = controller
    setSnapshot(controller.getSnapshot())

    const unsubscribe = controller.subscribe(setSnapshot)
    const recordActivity = () => {
      // Once the warning is visible, only the explicit Continue button may
      // extend the session; Escape and incidental key/pointer events cannot
      // bypass the warning.
      if (controller.getSnapshot().state === 'active') controller.recordActivity()
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true })
    })
    document.addEventListener('scroll', recordActivity, { capture: true, passive: true })

    const supabase = createClient()
    const { data: authState } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        controller.stop()
        setSnapshot({ state: 'active', remainingMs: IDLE_TIMEOUT_MS })
      }
    })

    controller.start()

    return () => {
      authState.subscription.unsubscribe()
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity)
      })
      document.removeEventListener('scroll', recordActivity, true)
      unsubscribe()
      controller.stop()
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (snapshot.state !== 'expired') return
    void signOutAfterTimeout()
  }, [signOutAfterTimeout, snapshot.state])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (snapshot.state === 'active') {
      if (dialog.open) dialog.close()
      return
    }

    if (!dialog.open) dialog.showModal()
    if (snapshot.state === 'warning') {
      window.requestAnimationFrame(() => {
        dialog.querySelector<HTMLButtonElement>('[data-idle-continue]')?.focus()
      })
    }
  }, [snapshot.state])

  const isWarning = snapshot.state === 'warning'

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog idle-session-dialog"
      aria-labelledby="idle-session-dialog-title"
      aria-modal="true"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="app-dialog__header">
        <div>
          <h2 id="idle-session-dialog-title">
            {isWarning ? 'กำลังจะออกจากระบบ' : 'กำลังออกจากระบบ'}
          </h2>
          <p>ระบบจะออกจากระบบอัตโนมัติเนื่องจากไม่มีการใช้งาน</p>
        </div>
      </div>
      <div className="app-dialog__body idle-session-dialog__body">
        {isWarning ? (
          <>
            <p className="idle-session-dialog__message">
              ไม่มีการใช้งาน ระบบจะออกจากระบบอัตโนมัติในอีก 1 นาที
            </p>
            <div className="idle-session-dialog__countdown" aria-live="polite">
              <span>เวลาที่เหลือ</span>
              <strong>{formatCountdown(snapshot.remainingMs)}</strong>
            </div>
          </>
        ) : (
          <p className="idle-session-dialog__message">
            ระบบกำลังพยายามออกจากระบบให้เสร็จสิ้น
          </p>
        )}
        {error ? <p className="idle-session-dialog__error" role="alert">{error}</p> : null}
        <div className="idle-session-dialog__actions">
          {isWarning ? (
            <Button
              data-idle-continue
              type="button"
              onClick={() => {
                setError(null)
                controllerRef.current?.continueSession()
              }}
            >
              ใช้งานต่อ
            </Button>
          ) : (
            <Button type="button" onClick={() => void signOutAfterTimeout()} disabled={isSigningOut}>
              {isSigningOut ? 'กำลังออก…' : 'ลองออกจากระบบอีกครั้ง'}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  )
}
```

Mount the guard once in `components/ui/AppShell.tsx`:

```tsx
import { IdleSessionGuard } from '@/components/ui/IdleSessionGuard'
```

```tsx
return (
  <RouteProgress>
    <IdleSessionGuard />
    <div className="app-shell">
      ...
    </div>
  </RouteProgress>
)
```

Add the modal styles to `app/globals.css` near the shared `.app-dialog` rules:

```css
.idle-session-dialog {
  width: min(520px, calc(100vw - 32px));
}

.idle-session-dialog__body {
  display: grid;
  gap: 16px;
}

.idle-session-dialog__message {
  margin: 0;
  color: var(--lab-ink);
  font-size: 13px;
  line-height: 1.65;
}

.idle-session-dialog__countdown {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  color: var(--lab-ink);
  background: color-mix(in srgb, var(--lab-amber-soft) 54%, var(--lab-surface));
  border: 1px solid color-mix(in srgb, var(--lab-amber) 30%, var(--lab-border-strong));
  border-radius: 12px;
}

.idle-session-dialog__countdown span {
  color: var(--lab-muted);
  font-size: 12px;
  font-weight: 700;
}

.idle-session-dialog__countdown strong {
  color: var(--lab-navy-strong);
  font: 600 20px/1.2 var(--font-mono);
}

.idle-session-dialog__error {
  margin: 0;
  padding: 10px 12px;
  color: var(--lab-red);
  background: var(--lab-red-soft);
  border: 1px solid color-mix(in srgb, var(--lab-red) 28%, var(--lab-border));
  border-radius: var(--radius-control);
  font-size: 12px;
  line-height: 1.5;
}

.idle-session-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--lab-border);
}

.idle-session-dialog__actions .lab-button {
  min-width: 148px;
}

@media (max-width: 600px) {
  .idle-session-dialog__actions {
    display: grid;
    grid-template-columns: 1fr;
  }

  .idle-session-dialog__actions .lab-button {
    width: 100%;
  }
}
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run:

`npx tsx scripts/idle-timeout.test.ts`

Expected: PASS with `idle timeout behavior: ok`.

Run:

`npx tsx scripts/idle-session-guard-contract.test.ts`

Expected: PASS with `idle session guard contract: ok`.

- [ ] **Step 5: Commit the protected-shell feature**

`git add components/ui/IdleSessionGuard.tsx components/ui/AppShell.tsx app/globals.css scripts/idle-session-guard-contract.test.ts; git commit -m "feat: add 30-minute idle logout warning"`

### Task 4: Register tests and complete repository verification

**Files:**

- Modify: `package.json`
- Test: `scripts/idle-timeout.test.ts`
- Test: `scripts/idle-session-guard-contract.test.ts`
- Test: existing `scripts/app-shell-contract.test.ts`, `scripts/auth-contract.test.ts`, and `scripts/auth-access-behavior.test.ts`

**Interfaces:**

- Consumes: the controller and guard from Tasks 2–3
- Produces: repeatable app-shell verification through the existing npm script

- [ ] **Step 1: Add both new tests to `test:app-shell`**

Update only the existing script entry in `package.json`:

```json
"test:app-shell": "tsx scripts/app-shell-contract.test.ts && tsx scripts/design-refresh.test.ts && tsx scripts/auth-contract.test.ts && tsx scripts/auth-access-behavior.test.ts && tsx scripts/actor-resolution.test.ts && tsx scripts/login-behavior.test.ts && tsx scripts/idle-timeout.test.ts && tsx scripts/idle-session-guard-contract.test.ts",
```

- [ ] **Step 2: Run the complete targeted verification**

Run:

`npm run test:app-shell`

Expected: all existing app-shell/auth tests and both new tests pass.

Run:

`npm run lint`

Expected: exit code 0 with no new lint errors.

Run:

`npm run typecheck`

Expected: exit code 0 with no TypeScript errors.

Run:

`npm run build`

Expected: production build completes successfully.

- [ ] **Step 3: Inspect the final diff and working tree**

Run:

`git diff HEAD~2 --check; git status --short; git log -3 --oneline`

Expected: no whitespace errors, only the planned files are changed, and the feature commits are visible on `main`.

- [ ] **Step 4: Commit the verification wiring**

`git add package.json; git commit -m "test: include idle logout checks in app shell suite"`

## Completion Checklist

- [ ] Controller tests were observed failing before production controller code existed
- [ ] Controller transitions active → warning → expired and reset behavior pass
- [ ] Warning appears at 29 minutes with a live countdown
- [ ] `ใช้งานต่อ` resets to a full 30-minute window
- [ ] Escape/outside interaction cannot bypass the warning
- [ ] Timeout calls local Supabase sign-out and redirects to `/login`
- [ ] Sign-out failure leaves a retryable modal and does not re-enable protected UI
- [ ] External sign-out stops the controller and all timers/listeners are cleaned up
- [ ] `npm run test:app-shell`, `npm run lint`, `npm run typecheck`, and `npm run build` pass
