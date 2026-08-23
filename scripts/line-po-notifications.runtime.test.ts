import assert from 'node:assert/strict'
import { buildPurchaseRequestLineFlexMessage } from '@/lib/pr/line-notification'
import { LineApiError, pushLineFlexMessage } from '@/lib/line/client'

const snapshot = {
  attemptId: '11111111-1111-4111-8111-111111111111',
  retryKey: '22222222-2222-4222-8222-222222222222',
  targetGroupId: 'Cb2f42795b0f16e9f7db81da21eb2106e',
  documentUrl: 'https://stock.example.test/purchase-requests/33333333-3333-4333-8333-333333333333',
  documentNumber: 'PR-2569-0001',
  department: 'ห้องปฏิบัติการกลาง',
  requesterName: 'ผู้ขอซื้อ',
  poNumber: 'PO-2569-0001',
  poFileName: 'po.pdf',
  poFileChecksum: 'abc123',
  itemCount: 3,
  total: 12345.5,
}

const message = buildPurchaseRequestLineFlexMessage(snapshot)
const serializedMessage = JSON.stringify(message)
assert.equal(message.type, 'flex')
assert.match(message.altText, /PO-2569-0001/)
assert.match(serializedMessage, /PR-2569-0001/)
assert.match(serializedMessage, /เปิดเอกสาร PO/)
assert.match(serializedMessage, /https:\/\/stock\.example\.test\/purchase-requests\/33333333-3333-4333-8333-333333333333/)
assert.match(serializedMessage, /ห้องปฏิบัติการกลาง/)
assert.match(serializedMessage, /ผู้ขอซื้อ/)
assert.match(serializedMessage, /3 รายการ/)

function response(status: number, body: unknown = { sentMessages: [{ id: 'line-message-1' }] }): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function initHeaders(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers)
}

async function testSuccessAndHeaders() {
  const requests: Array<{ to: string; retryKey: string; authorization: string | null; body: string }> = []
  const result = await pushLineFlexMessage({
    accessToken: 'token-is-never-logged',
    to: snapshot.targetGroupId,
    retryKey: snapshot.retryKey,
    message,
    fetchImpl: async (_input, init) => {
      const headers = initHeaders(init)
      requests.push({
        to: JSON.parse(String(init?.body)).to,
        retryKey: headers.get('X-Line-Retry-Key') ?? '',
        authorization: headers.get('Authorization'),
        body: String(init?.body),
      })
      return response(200)
    },
    sleep: async () => undefined,
  })

  assert.equal(result.httpStatus, 200)
  assert.equal(result.lineMessageId, 'line-message-1')
  assert.equal(result.attempts, 1)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].to, snapshot.targetGroupId)
  assert.equal(requests[0].retryKey, snapshot.retryKey)
  assert.equal(requests[0].authorization, 'Bearer token-is-never-logged')
  assert.match(requests[0].body, /"messages":\[/)
  assert.doesNotMatch(requests[0].body, /token-is-never-logged/)
}

async function testNetworkRetryUsesSameKey() {
  let calls = 0
  const retryKeys: string[] = []
  const sleeps: number[] = []
  const result = await pushLineFlexMessage({
    accessToken: 'token',
    to: snapshot.targetGroupId,
    retryKey: snapshot.retryKey,
    message,
    fetchImpl: async (_input, init) => {
      retryKeys.push(initHeaders(init).get('X-Line-Retry-Key') ?? '')
      calls += 1
      if (calls === 1) throw new Error('socket closed')
      return response(200)
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds) },
  })

  assert.equal(result.attempts, 2)
  assert.deepEqual(retryKeys, [snapshot.retryKey, snapshot.retryKey])
  assert.deepEqual(sleeps, [500])
}

async function testServerRetryAnd409() {
  let calls = 0
  const sleeps: number[] = []
  const result = await pushLineFlexMessage({
    accessToken: 'token',
    to: snapshot.targetGroupId,
    retryKey: snapshot.retryKey,
    message,
    fetchImpl: async () => {
      calls += 1
      return calls === 1 ? response(503, { message: 'temporary outage' }) : response(409)
    },
    sleep: async (milliseconds) => { sleeps.push(milliseconds) },
  })

  assert.equal(result.httpStatus, 409)
  assert.equal(result.attempts, 2)
  assert.deepEqual(sleeps, [500])
}

async function testClientErrorDoesNotRetry() {
  let calls = 0
  await assert.rejects(
    pushLineFlexMessage({
      accessToken: 'token',
      to: snapshot.targetGroupId,
      retryKey: snapshot.retryKey,
      message,
      fetchImpl: async () => {
        calls += 1
        return response(400, { message: 'bad request contains no secret' })
      },
      sleep: async () => undefined,
    }),
    (caught: unknown) => {
      assert.ok(caught instanceof LineApiError)
      assert.equal(caught.outcome, 'failed')
      assert.equal(caught.httpStatus, 400)
      assert.match(caught.message, /bad request/)
      return true
    },
  )
  assert.equal(calls, 1)
}

async function testUnknownAfterRepeatedServerError() {
  let calls = 0
  await assert.rejects(
    pushLineFlexMessage({
      accessToken: 'token',
      to: snapshot.targetGroupId,
      retryKey: snapshot.retryKey,
      message,
      fetchImpl: async () => {
        calls += 1
        return response(500)
      },
      sleep: async () => undefined,
    }),
    (caught: unknown) => {
      assert.ok(caught instanceof LineApiError)
      assert.equal(caught.outcome, 'unknown')
      assert.equal(caught.httpStatus, 500)
      return true
    },
  )
  assert.equal(calls, 2)
}

async function testTimeoutBecomesUnknown() {
  let calls = 0
  await assert.rejects(
    pushLineFlexMessage({
      accessToken: 'token',
      to: snapshot.targetGroupId,
      retryKey: snapshot.retryKey,
      message,
      timeoutMs: 1,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        calls += 1
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), { once: true })
      }),
      sleep: async () => undefined,
    }),
    (caught: unknown) => {
      assert.ok(caught instanceof LineApiError)
      assert.equal(caught.outcome, 'unknown')
      assert.match(caught.message, /เวลา|ยืนยันผลไม่ได้/)
      return true
    },
  )
  assert.equal(calls, 2)
}

async function main() {
  await testSuccessAndHeaders()
  await testNetworkRetryUsesSameKey()
  await testServerRetryAnd409()
  await testClientErrorDoesNotRetry()
  await testUnknownAfterRepeatedServerError()
  await testTimeoutBecomesUnknown()
  console.log('LINE PO notification runtime contract: ok')
}

void main()
