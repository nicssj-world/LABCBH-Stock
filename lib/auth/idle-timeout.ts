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
