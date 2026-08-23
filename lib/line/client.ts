export interface LineFlexMessage {
  type: 'flex'
  altText: string
  contents: Record<string, unknown>
}

export type LineErrorOutcome = 'failed' | 'unknown'

export class LineApiError extends Error {
  readonly outcome: LineErrorOutcome
  readonly httpStatus: number | null
  readonly lineMessageId: string | null

  constructor(
    message: string,
    outcome: LineErrorOutcome,
    httpStatus: number | null = null,
    lineMessageId: string | null = null,
  ) {
    super(message)
    this.name = 'LineApiError'
    this.outcome = outcome
    this.httpStatus = httpStatus
    this.lineMessageId = lineMessageId
  }
}

export interface LinePushResult {
  httpStatus: number
  lineMessageId: string | null
  attempts: number
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type Sleep = (milliseconds: number) => Promise<void>

const PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push'
const REQUEST_TIMEOUT_MS = 10_000
const RETRY_DELAY_MS = 500

function defaultSleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function providerMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message.slice(0, 240) : null
  } catch {
    return null
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal })
  } catch (caught) {
    if (controller.signal.aborted) {
      throw new LineApiError('LINE ไม่ตอบกลับภายในเวลาที่กำหนด', 'unknown')
    }
    throw caught
  } finally {
    clearTimeout(timeout)
  }
}

export async function pushLineFlexMessage({
  accessToken,
  to,
  retryKey,
  message,
  fetchImpl = fetch,
  sleep = defaultSleep,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: {
  accessToken: string
  to: string
  retryKey: string
  message: LineFlexMessage
  fetchImpl?: FetchLike
  sleep?: Sleep
  timeoutMs?: number
}): Promise<LinePushResult> {
  let lastTransientError: LineApiError | null = null

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetchWithTimeout(fetchImpl, PUSH_ENDPOINT, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'X-Line-Retry-Key': retryKey,
        },
        body: JSON.stringify({ to, messages: [message] }),
      }, timeoutMs)

      const body = await response.text()
      if (response.ok || response.status === 409) {
        let lineMessageId: string | null = null
        if (body) {
          try {
            const parsed = JSON.parse(body) as { sentMessages?: Array<{ id?: unknown }> }
            const id = parsed.sentMessages?.[0]?.id
            lineMessageId = typeof id === 'string' ? id : null
          } catch {
            // A 409 has no body in some LINE responses; success does not need it.
          }
        }
        return { httpStatus: response.status, lineMessageId, attempts: attempt }
      }

      const detail = providerMessage(body)
      if (response.status >= 500) {
        lastTransientError = new LineApiError(
          detail ? `LINE ไม่พร้อมใช้งาน: ${detail}` : 'LINE ไม่พร้อมใช้งานชั่วคราว',
          'unknown',
          response.status,
        )
        if (attempt === 1) {
          await sleep(RETRY_DELAY_MS)
          continue
        }
        throw lastTransientError
      }

      throw new LineApiError(
        detail ? `LINE ปฏิเสธการส่ง: ${detail}` : 'LINE ปฏิเสธการส่งข้อความ',
        'failed',
        response.status,
      )
    } catch (caught) {
      if (caught instanceof LineApiError && caught.outcome === 'failed') throw caught

      lastTransientError = caught instanceof LineApiError
        ? caught
        : new LineApiError('เชื่อมต่อ LINE ไม่สำเร็จและยังยืนยันผลไม่ได้', 'unknown')

      if (attempt === 1) {
        await sleep(RETRY_DELAY_MS)
        continue
      }
      throw lastTransientError
    }
  }

  throw lastTransientError ?? new LineApiError('แจ้ง LINE ไม่สำเร็จ', 'unknown')
}
