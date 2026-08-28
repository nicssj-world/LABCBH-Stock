'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertStockOperator } from '@/lib/inventory/authorization'
import { assertPurchaseRequester } from '@/lib/pr/authorization'
import {
  assertRequisitionManager,
  assertRequisitionReceiver,
  RequisitionAuthorizationError,
} from '@/lib/requisitions/authorization'
import {
  drawnSignatureInputSchema,
  fulfillRequisitionInputSchema,
  requisitionInputSchema,
} from '@/lib/requisitions/schema'
import { getRequisition } from '@/lib/requisitions/queries'
import {
  ensureSignatureBucket,
  loadPortalSignatureDataUri,
  normalizeDrawnSignature,
  PORTAL_PROFILE_PATH,
  profileSignaturePath,
  resolvePortalSignatureProfile,
  SIGNATURE_BUCKET,
} from '@/lib/requisitions/signature'
import type { DrawnSignatureInput, FulfillRequisitionInput, RequisitionInput } from '@/lib/requisitions/types'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getPortalSupabaseAdmin } from '@/lib/supabase/portal-admin'
import { omitNullishProperties } from '@/lib/validation/json'

const requisitionIdSchema = z.string().uuid()

function unwrapMutation(
  operation: string,
  result: { data: unknown; error: { message: string } | null },
) {
  if (result.error) throw new Error(`${operation}ไม่สำเร็จ: ${result.error.message}`)
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}

function revalidateRequisition(id?: string) {
  revalidatePath('/requisitions')
  if (id) revalidatePath(`/requisitions/${id}`)
  revalidatePath('/inventory')
  revalidatePath('/dashboard')
}

async function assertCreateItemCatalog(itemIds: string[]) {
  const uniqueItemIds = [...new Set(itemIds)]
  const { data, error } = await supabaseAdmin
    .from('inventory_items')
    .select('id, is_active')
    .in('id', uniqueItemIds)

  if (error) throw new Error('ตรวจสอบรายการน้ำยาไม่สำเร็จ: ' + error.message)

  const rows = data ?? []
  const allItemsEligible =
    rows.length === uniqueItemIds.length &&
    rows.every((item) => item.is_active)

  if (!allItemsEligible) {
    throw new RequisitionAuthorizationError(
      'รายการน้ำยาที่เลือกไม่มีอยู่ในคลังหรือถูกปิดใช้งาน',
    )
  }
}

export async function createRequisition(input: RequisitionInput) {
  const actor = await requireActor()
  assertPurchaseRequester(actor)
  const parsed = requisitionInputSchema.parse(input)
  const { items, ...requisition } = parsed
  // Type-ahead search intentionally exposes every active catalogue item with
  // requestable stock. Keep this identity check broad enough for that path;
  // the RPC performs the authoritative reservation-aware availability check
  // under row locks before creating the requisition.
  await assertCreateItemCatalog(items.map((item) => item.inventoryItemId))

  const result = await supabaseAdmin.rpc('create_requisition', {
    p_actor_id: actor.id,
    p_requisition: requisition,
    p_items: items.map(omitNullishProperties),
  })

  const created = unwrapMutation('สร้างใบเบิก', result)
  revalidateRequisition()
  return created
}

/**
 * A requisition can only be corrected while it is still waiting. Nothing has
 * left the store yet at that point, so there is no stock to put back — the RPC
 * locks the row and re-reads the status so an edit cannot land halfway through
 * a stock officer dispensing it.
 */
export async function updateRequisition(requisitionId: string, input: RequisitionInput) {
  const actor = await requireActor()
  const parsedId = requisitionIdSchema.parse(requisitionId)
  const parsed = requisitionInputSchema.parse(input)
  const existing = await getRequisition(parsedId)
  if (!existing) throw new Error('ไม่พบใบเบิกที่ต้องการแก้ไข')
  assertRequisitionManager(actor, existing.requesterId)
  const { items, ...requisition } = parsed

  const result = await supabaseAdmin.rpc('update_requisition', {
    p_requisition_id: parsedId,
    p_actor_id: actor.id,
    p_requisition: requisition,
    p_items: items.map(omitNullishProperties),
  })

  const updated = unwrapMutation('แก้ไขใบเบิก', result)
  revalidateRequisition(parsedId)
  return updated
}

/**
 * "ลบ" ในหน้าจอใบเบิกคือการยกเลิกแบบเก็บประวัติไว้ ไม่ลบแถวหรือรายการน้ำยาจริง
 * เพื่อให้เลขที่ใบเบิกและการตรวจสอบย้อนหลังยังเชื่อถือได้
 */
export async function cancelRequisition(requisitionId: string) {
  const actor = await requireActor()
  const parsedId = requisitionIdSchema.parse(requisitionId)
  const existing = await getRequisition(parsedId)
  if (!existing) throw new Error('ไม่พบใบเบิกที่ต้องการยกเลิก')
  assertRequisitionManager(actor, existing.requesterId)

  const result = await supabaseAdmin.rpc('cancel_requisition', {
    p_requisition_id: parsedId,
    p_actor_id: actor.id,
  })

  const cancelled = unwrapMutation('ยกเลิกใบเบิก', result)
  revalidateRequisition(parsedId)
  return cancelled
}

export async function fulfillRequisition(
  requisitionId: string,
  input: FulfillRequisitionInput,
) {
  const actor = await requireActor()
  assertStockOperator(actor)
  const parsedId = requisitionIdSchema.parse(requisitionId)
  const parsed = fulfillRequisitionInputSchema.parse(input)

  // The RPC locks the requisition and every chosen lot, refuses expired lots,
  // validates any audited short issue, and is the only place stock moves.
  const result = await supabaseAdmin.rpc('fulfill_requisition', {
    p_requisition_id: parsedId,
    p_actor_id: actor.id,
    p_allocations: parsed.allocations.map(omitNullishProperties),
  })

  const fulfilled = unwrapMutation('จ่ายของตามใบเบิก', result)
  revalidateRequisition(parsedId)
  return fulfilled
}

export async function saveDrawnSignature(
  requisitionId: string,
  input: DrawnSignatureInput,
) {
  const actor = await requireActor()
  const parsedId = requisitionIdSchema.parse(requisitionId)
  const parsed = drawnSignatureInputSchema.parse(input)
  const existing = await getRequisition(parsedId)
  if (!existing) throw new Error('ไม่พบใบเบิกที่ต้องการบันทึกลายเซ็นต์')
  if (existing.status !== 'fulfilled') {
    throw new Error('บันทึกลายเซ็นต์ได้เมื่อคลังจ่ายของแล้วเท่านั้น')
  }
  assertRequisitionReceiver(actor, existing.requesterId)

  const portalProfile = await resolvePortalSignatureProfile({
    id: actor.id,
    ephisId: actor.ephisId,
    name: actor.name,
  })
  if (!portalProfile) {
    throw new Error(`ไม่พบโปรไฟล์ผู้ตรวจรับใน Portal กรุณาเปิด ${PORTAL_PROFILE_PATH}`)
  }

  const normalized = await normalizeDrawnSignature(parsed.signature)
  const portalAdmin = getPortalSupabaseAdmin()
  await ensureSignatureBucket(portalAdmin)

  const { data: currentProfile, error: profileError } = await portalAdmin
    .from('profiles')
    .select('signature_url')
    .eq('id', portalProfile.id)
    .maybeSingle()
  if (profileError) throw new Error(`อ่านโปรไฟล์ลายเซ็นต์ไม่สำเร็จ: ${profileError.message}`)

  const signaturePath = profileSignaturePath(portalProfile.id)
  const { error: uploadError } = await portalAdmin.storage
    .from(SIGNATURE_BUCKET)
    .upload(signaturePath, normalized.buffer, {
      contentType: 'image/png',
      upsert: true,
    })
  if (uploadError) throw new Error(`บันทึกลายเซ็นต์ลง Portal ไม่สำเร็จ: ${uploadError.message}`)

  try {
    const result = await portalAdmin.rpc('save_profile_signature', {
      p_actor_id: portalProfile.id,
      p_signature_path: signaturePath,
    })

    const saved = unwrapMutation('บันทึกลายเซ็นต์ลง Portal', result)
    const previousPath = typeof saved.previous_signature_path === 'string'
      ? saved.previous_signature_path
      : currentProfile?.signature_url
    if (previousPath && previousPath !== signaturePath) {
      await portalAdmin.storage.from(SIGNATURE_BUCKET).remove([previousPath])
    }

    revalidateRequisition(parsedId)
    return { id: saved.id, signature: normalized.dataUri }
  } catch (caught) {
    // Do not remove an overwritten actor.id.png: the profile still points to
    // that path and the new image is safer than leaving a broken signature.
    if (currentProfile?.signature_url !== signaturePath) {
      await portalAdmin.storage.from(SIGNATURE_BUCKET).remove([signaturePath])
    }
    throw caught
  }
}

export async function receiveRequisition(requisitionId: string) {
  const actor = await requireActor()
  const parsedId = requisitionIdSchema.parse(requisitionId)
  const existing = await getRequisition(parsedId)
  if (!existing) throw new Error('ไม่พบใบเบิกที่ต้องการตรวจรับ')
  if (existing.status !== 'fulfilled') {
    throw new Error('ตรวจรับได้เมื่อคลังเปลี่ยนสถานะเป็นเบิกจ่ายสำเร็จแล้วเท่านั้น')
  }
  assertRequisitionReceiver(actor, existing.requesterId)

  const receivedByName = actor.name?.trim()
  if (!receivedByName) throw new Error('ไม่พบชื่อผู้ตรวจรับในโปรไฟล์ Portal')

  const signature = await loadPortalSignatureDataUri({
    id: actor.id,
    ephisId: actor.ephisId,
    name: actor.name,
  })
  if (!signature) {
    throw new Error(`ไม่พบลายเซ็นต์ใน Portal กรุณาวาดลายเซ็นต์ หรือเปิด ${PORTAL_PROFILE_PATH}`)
  }

  const result = await supabaseAdmin.rpc('receive_requisition', {
    p_requisition_id: parsedId,
    p_actor_id: actor.id,
    p_received_by_name: receivedByName,
    p_signature: signature,
  })

  const received = unwrapMutation('บันทึกการตรวจรับของ', result)
  revalidateRequisition(parsedId)
  return received
}
