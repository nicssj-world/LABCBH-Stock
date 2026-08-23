'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireActor } from '@/lib/auth/actor'
import { assertContractEditor } from '@/lib/contracts/authorization'
import { assertPurchaseRequestManager } from '@/lib/pr/authorization'
import { purchaseMethodPurpose } from '@/lib/pr/schema'
import { cleanupPurchaseRequestChecklistObjects } from '@/lib/pr/checklist-cleanup'
import { getPurchaseRequest } from '@/lib/pr/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function retryPurchaseRequestChecklistCleanup(purchaseRequestId: string) {
  const actor = await requireActor()
  const id = z.string().uuid().parse(purchaseRequestId)
  const request = await getPurchaseRequest(id)
  if (!request) throw new Error('ไม่พบใบ PR')

  let reason: 'received' | 'closed_short' | 'winner_announced' | 'edit_removed' = 'edit_removed'
  if (purchaseMethodPurpose(request.purchaseMethod) === 'purchase_order') {
    if (request.status === 'received') reason = 'received'
    else if (request.status === 'closed_short') reason = 'closed_short'
  } else if (request.createdContractId) {
    const result = await supabaseAdmin
      .from('contracts')
      .select('procurement_stage')
      .eq('id', request.createdContractId)
      .maybeSingle()
    if (result.error) throw new Error(`อ่านสถานะสัญญาไม่สำเร็จ: ${result.error.message}`)
    if (['winner_announced', 'contract_started'].includes(result.data?.procurement_stage ?? '')) {
      reason = 'winner_announced'
    }
  }

  if (reason === 'winner_announced') assertContractEditor(actor)
  else assertPurchaseRequestManager(actor, request.requesterId)

  const cleaned = await cleanupPurchaseRequestChecklistObjects(id, actor.id, reason)
  revalidatePath(`/purchase-requests/${id}`)
  return cleaned
}
