import assert from 'node:assert/strict'
import {
  ActorResolutionError,
  resolveAuthenticatedUser,
  unwrapActorQuery,
} from '../lib/auth/resolution'

assert.equal(
  resolveAuthenticatedUser({
    data: { user: null },
    error: { name: 'AuthSessionMissingError', message: 'Auth session missing' },
  }),
  null,
  'an absent auth session must be treated as unauthenticated',
)

assert.throws(
  () =>
    resolveAuthenticatedUser({
      data: { user: null },
      error: { name: 'AuthApiError', message: 'auth service unavailable', code: '503' },
    }),
  (error: unknown) => error instanceof ActorResolutionError && error.stage === 'auth',
  'an auth infrastructure failure must not become a login redirect',
)

assert.equal(
  unwrapActorQuery('profile', { data: null, error: null }),
  null,
  'a missing profile from maybeSingle is data absence, not an infrastructure error',
)

const profileFailure = { message: 'permission denied', code: '42501' }
assert.throws(
  () => unwrapActorQuery('profile', { data: null, error: profileFailure }),
  (error: unknown) => {
    assert.ok(error instanceof ActorResolutionError)
    assert.equal(error.stage, 'profile')
    assert.equal(error.code, '42501')
    assert.match(error.message, /permission denied/)
    return true
  },
)

assert.throws(
  () =>
    unwrapActorQuery('membership', {
      data: null,
      error: { message: 'membership RLS failure', code: 'PGRST301' },
    }),
  (error: unknown) =>
    error instanceof ActorResolutionError &&
    error.stage === 'membership' &&
    error.code === 'PGRST301',
  'membership query errors must never be discarded',
)

console.log('actor resolution behavior: ok')
