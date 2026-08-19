export type ActorQueryStage = 'auth' | 'profile' | 'membership'

interface QueryErrorLike {
  message: string
  code?: string
  name?: string
}

interface QueryResult<T> {
  data: T
  error: QueryErrorLike | null
}

export class ActorResolutionError extends Error {
  readonly stage: ActorQueryStage
  readonly code: string | undefined

  constructor(stage: ActorQueryStage, cause: QueryErrorLike) {
    super(`Unable to resolve LAB Stock actor at ${stage}: ${cause.message}`)
    this.name = 'ActorResolutionError'
    this.stage = stage
    this.code = cause.code
  }
}

export function unwrapActorQuery<T>(stage: ActorQueryStage, result: QueryResult<T>): T {
  if (result.error) throw new ActorResolutionError(stage, result.error)
  return result.data
}

interface ClaimsResult {
  data: { claims?: { sub?: unknown } | null } | null
  error: QueryErrorLike | null
}

export interface ClaimsReader {
  auth: { getClaims: () => Promise<ClaimsResult> }
}

/**
 * A token that is absent or malformed means nobody is signed in, which the
 * caller turns into a login redirect. Every other failure — the auth service
 * being unreachable, an API error — has to surface as an error instead, or an
 * outage would present itself as "your session ended" and sign the whole
 * hospital out.
 */
const UNAUTHENTICATED_ERROR_NAMES = new Set(['AuthSessionMissingError', 'AuthInvalidJwtError'])

/** getClaims() rejects with a plain Error, not an AuthError, once exp has passed. */
const EXPIRED_TOKEN_MESSAGE = /jwt has expired|missing exp claim/i

export function resolveAuthenticatedSubject(result: ClaimsResult): string | null {
  if (result.error) {
    if (result.error.name && UNAUTHENTICATED_ERROR_NAMES.has(result.error.name)) return null
    throw new ActorResolutionError('auth', result.error)
  }

  const subject = result.data?.claims?.sub
  return typeof subject === 'string' && subject.length > 0 ? subject : null
}

/**
 * Reads the session's claims by verifying its JWT against the cached JWKS in
 * this process. getUser() asks the Auth service to do the same work over the
 * network, which measured 150-180ms on every single request against both
 * Supabase projects — paid before a page could even begin reading its data.
 *
 * The signature is still verified cryptographically, so this is not the
 * unchecked getSession() read: an unsigned or tampered token is rejected here
 * exactly as the Auth service would reject it. Projects without an asymmetric
 * signing key fall back to a getUser() call inside getClaims(), so this stays
 * correct if the key type ever changes.
 */
export async function readAuthClaims(supabase: ClaimsReader): Promise<ClaimsResult> {
  try {
    return await supabase.auth.getClaims()
  } catch (caught) {
    // An expired token is someone who needs to sign in again, not a server
    // fault; letting the raw throw escape would answer with a 500 on a page
    // that only needed a login prompt.
    if (caught instanceof Error && EXPIRED_TOKEN_MESSAGE.test(caught.message)) {
      return { data: null, error: null }
    }
    throw caught
  }
}
