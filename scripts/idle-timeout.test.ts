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
