import assert from 'node:assert/strict'
import {
  ActorResolutionError,
  readAuthClaims,
  resolveAuthenticatedSubject,
  unwrapActorQuery,
} from '../lib/auth/resolution'

assert.equal(
  resolveAuthenticatedSubject({ data: null, error: null }),
  null,
  'an absent auth session must be treated as unauthenticated',
)

assert.equal(
  resolveAuthenticatedSubject({
    data: null,
    error: { name: 'AuthSessionMissingError', message: 'Auth session missing' },
  }),
  null,
  'a missing session reported as an error is still simply unauthenticated',
)

assert.equal(
  resolveAuthenticatedSubject({
    data: null,
    error: { name: 'AuthInvalidJwtError', message: 'Invalid JWT signature' },
  }),
  null,
  'a token that fails signature verification must never resolve to an actor',
)

assert.equal(
  resolveAuthenticatedSubject({ data: { claims: { sub: 'profile-1' } }, error: null }),
  'profile-1',
  'a verified token resolves to its subject',
)

for (const claims of [{}, { sub: '' }, { sub: 42 }]) {
  assert.equal(
    resolveAuthenticatedSubject({ data: { claims }, error: null }),
    null,
    'a token without a usable subject cannot identify anyone',
  )
}

assert.throws(
  () =>
    resolveAuthenticatedSubject({
      data: null,
      error: { name: 'AuthApiError', message: 'auth service unavailable', code: '503' },
    }),
  (error: unknown) => error instanceof ActorResolutionError && error.stage === 'auth',
  'an auth infrastructure failure must not become a login redirect',
)

assert.throws(
  () =>
    resolveAuthenticatedSubject({
      data: null,
      error: { name: 'AuthRetryableFetchError', message: 'network failure' },
    }),
  (error: unknown) => error instanceof ActorResolutionError && error.stage === 'auth',
  'a network failure reaching the JWKS endpoint is infrastructure, not a signed-out user',
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

async function expiredAndFaultyClaims() {
  // getClaims() rejects with a plain Error rather than an AuthError once the
  // token's exp has passed. Left alone that answers a page with a 500 when all
  // the user needed was to sign in again.
  assert.equal(
    resolveAuthenticatedSubject(
      await readAuthClaims({
        auth: { getClaims: () => Promise.reject(new Error('JWT has expired')) },
      }),
    ),
    null,
    'an expired token must present as unauthenticated, not as a server fault',
  )

  await assert.rejects(
    () =>
      readAuthClaims({
        auth: { getClaims: () => Promise.reject(new Error('something else broke')) },
      }),
    /something else broke/,
    'only expiry is normalised; any other throw must keep propagating',
  )
}

expiredAndFaultyClaims().then(() => {
  console.log('actor resolution behavior: ok')
})
