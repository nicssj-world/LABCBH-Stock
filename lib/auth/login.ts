interface SignInResult {
  error: { message: string } | null
}

interface LoginAttemptInput {
  identifier: string
  password: string
  signIn: (credentials: { email: string; password: string }) => Promise<SignInResult>
}

export type LoginAttemptResult = { ok: true } | { ok: false; message: string }

export async function runLoginAttempt({
  identifier,
  password,
  signIn,
}: LoginAttemptInput): Promise<LoginAttemptResult> {
  const normalizedIdentifier = identifier.trim()
  const email = normalizedIdentifier.includes('@')
    ? normalizedIdentifier
    : `${normalizedIdentifier}@cbh.go.th`

  try {
    const { error } = await signIn({ email, password })
    return error ? { ok: false, message: error.message } : { ok: true }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Unexpected sign-in failure',
    }
  }
}
