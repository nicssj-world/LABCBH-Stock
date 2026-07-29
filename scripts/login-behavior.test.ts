import assert from 'node:assert/strict'
import { runLoginAttempt } from '../lib/auth/login'

async function main() {
  let observedEmail = ''
  const successfulAttempt = await runLoginAttempt({
  identifier: ' 9495 ',
  password: 'secret',
  signIn: async ({ email }) => {
    observedEmail = email
    return { error: null }
  },
  })
  assert.equal(observedEmail, '9495@cbh.go.th')
  assert.deepEqual(successfulAttempt, { ok: true })

  const rejectedAttempt = await runLoginAttempt({
  identifier: '9495',
  password: 'secret',
  signIn: async () => {
    throw new Error('network unavailable')
  },
  })
  assert.deepEqual(rejectedAttempt, { ok: false, message: 'network unavailable' })

  const ordinaryFailure = await runLoginAttempt({
  identifier: '9495',
  password: 'wrong',
  signIn: async () => ({ error: { message: 'Invalid login credentials' } }),
  })
  assert.deepEqual(ordinaryFailure, { ok: false, message: 'Invalid login credentials' })

  console.log('login behavior: ok')
}

void main()
