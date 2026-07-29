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

interface AuthUserResult<T> {
  data: { user: T | null }
  error: QueryErrorLike | null
}

export function resolveAuthenticatedUser<T>(result: AuthUserResult<T>): T | null {
  if (result.error?.name === 'AuthSessionMissingError' && !result.data.user) return null
  if (result.error) throw new ActorResolutionError('auth', result.error)
  return result.data.user
}
