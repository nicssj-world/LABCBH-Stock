'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { LineApiError, pushLineFlexMessage } from '@/lib/line/client'
import { requireLineNotificationConfig } from '@/lib/line/config'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { buildPurchaseRequestLineFlexMessage } from './line-notification'
import type {
  PurchaseRequestLineNotificationStatus,
  PurchaseRequestLineNotificationSummary,
} from './types'

const requestIdSchema = z.string().uuid()
const confirmedAttemptIdSchema = z.string().uuid().nullable()
const numericSchema = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)

const attemptSchema = z.object({
  attemptId: z.string().uuid(),
  retryKey: z.string().uuid(),
  targetGroupId: z.string().min(1),
  documentUrl: z.string().url().refine((value) => value.startsWith('https://')),
  documentNumber: z.string().min(1),
  department: z.string().min(1),
  requesterName: z.string().nullable(),
  poNumber: z.string().min(1),
  poFileName: z.string().nullable(),
  poFileChecksum: z.string().nullable(),
  itemCount: z.number().int().nonnegative(),
  total: numericSchema,
})

const completionSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['pending', 'succeeded', 'failed', 'unknown']),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  po_number: z.string(),
  error_message: z.string().nullable(),
})

function revalidateLineNotificationViews(requestId: string) {
  revalidatePath('/purchase-requests')
  revalidatePath(`/purchase-requests/${requestId}`)
  revalidatePath('/dashboard')
}

function actionError(operation: string, message: string): Error {
  return new Error(`${operation}ไม่สำเร็จ: ${message}`)
}

async function completeAttempt({
  attemptId,
  actorId,
  status,
  httpStatus,
  lineMessageId,
  errorMessage,
}: {
  attemptId: string
  actorId: string
  status: Exclude<PurchaseRequestLineNotificationStatus, 'pending'>
  httpStatus: number | null
  lineMessageId: string | null
  errorMessage: string | null
}) {
  const result = await supabaseAdmin.rpc('complete_purchase_request_line_notification', {
    p_attempt_id: attemptId,
    p_actor_id: actorId,
    p_status: status,
    p_http_status: httpStatus,
    p_line_message_id: lineMessageId,
    p_error_message: errorMessage,
  })

  if (result.error) throw new Error(result.error.message)
  return completionSchema.parse(result.data)
}

export async function notifyPurchaseRequestInLine(
  purchaseRequestId: string,
  confirmedAttemptId: string | null = null,
): Promise<PurchaseRequestLineNotificationSummary> {
  const actor = await requireActor()
  assertStockOperator(actor)

  const parsedRequestId = requestIdSchema.parse(purchaseRequestId)
  const parsedConfirmedAttemptId = confirmedAttemptIdSchema.parse(confirmedAttemptId)
  const config = requireLineNotificationConfig()
  const documentUrl = `${config.appBaseUrl}/purchase-requests/${parsedRequestId}`

  const beginResult = await supabaseAdmin.rpc('begin_purchase_request_line_notification', {
    p_pr_id: parsedRequestId,
    p_actor_id: actor.id,
    p_confirmed_attempt_id: parsedConfirmedAttemptId,
    p_target_group_id: config.groupId,
    p_document_url: documentUrl,
  })

  if (beginResult.error) {
    throw actionError('เริ่มแจ้งเอกสาร PO ใน LINE', beginResult.error.message)
  }

  const attempt = attemptSchema.parse(beginResult.data)
  const message = buildPurchaseRequestLineFlexMessage(attempt)

  try {
    const sent = await pushLineFlexMessage({
      accessToken: config.accessToken,
      to: attempt.targetGroupId,
      retryKey: attempt.retryKey,
      message,
    })
    const completion = await completeAttempt({
      attemptId: attempt.attemptId,
      actorId: actor.id,
      status: 'succeeded',
      httpStatus: sent.httpStatus,
      lineMessageId: sent.lineMessageId,
      errorMessage: null,
    })
    revalidateLineNotificationViews(parsedRequestId)
    return {
      id: completion.id,
      status: 'succeeded',
      sentByName: actor.name ?? null,
      createdAt: completion.created_at,
      completedAt: completion.completed_at,
      poNumber: completion.po_number,
      errorMessage: completion.error_message,
    }
  } catch (caught) {
    const error = caught instanceof LineApiError
      ? caught
      : new LineApiError('เกิดข้อผิดพลาดระหว่างส่งข้อความ LINE', 'unknown')

    let completionError: string | null = null
    try {
      await completeAttempt({
        attemptId: attempt.attemptId,
        actorId: actor.id,
        status: error.outcome,
        httpStatus: error.httpStatus,
        lineMessageId: error.lineMessageId,
        errorMessage: error.message,
      })
    } catch (recordError) {
      completionError = recordError instanceof Error ? recordError.message : 'บันทึกสถานะไม่สำเร็จ'
    }

    revalidateLineNotificationViews(parsedRequestId)
    if (completionError) {
      throw actionError('แจ้งเอกสาร PO ใน LINE', `${error.message} และบันทึกประวัติไม่สำเร็จ: ${completionError}`)
    }
    if (error.outcome === 'unknown') {
      throw actionError('แจ้งเอกสาร PO ใน LINE', `${error.message} กรุณาตรวจสอบกลุ่มก่อนส่งซ้ำ`)
    }
    throw actionError('แจ้งเอกสาร PO ใน LINE', error.message)
  }
}
