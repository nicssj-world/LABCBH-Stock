import 'server-only'

import type { Actor } from '@/lib/auth/actor'
import {
  assertPurchaseRequestChecklistStockAccess,
  getPurchaseRequestChecklist,
  PurchaseRequestChecklistAccessError,
} from '@/lib/pr/checklist-queries'
import { getPurchaseRequest } from '@/lib/pr/queries'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function resolvePurchaseRequestCommitteePdfInput(purchaseRequestId: string, actor: Actor) {
  await assertPurchaseRequestChecklistStockAccess(purchaseRequestId, actor)
  const [request, checklist] = await Promise.all([
    getPurchaseRequest(purchaseRequestId),
    getPurchaseRequestChecklist(purchaseRequestId, actor),
  ])
  if (!request) throw new PurchaseRequestChecklistAccessError('ไม่พบใบ PR')
  if (!checklist.canDownloadCommitteePdf) {
    throw new Error('ยังดาวน์โหลด PDF ไม่ได้ กรุณาเติมตำแหน่งบุคลากรของกรรมการให้ครบแล้วโหลดหน้าใหม่')
  }

  let subjectName: string | null = null
  const contractDraft = request.methodDetails.contractDraft
  if (contractDraft && typeof contractDraft === 'object') {
    const displayName = (contractDraft as Record<string, unknown>).displayName
    subjectName = typeof displayName === 'string' ? displayName.trim() || null : null
  }
  if (!subjectName) {
    const contractId = Number(request.methodDetails.contractId)
    if (Number.isSafeInteger(contractId) && contractId > 0) {
      const result = await supabaseAdmin.from('contracts').select('display_name').eq('id', contractId).maybeSingle()
      if (result.error) throw new Error(`อ่านชื่อสัญญาไม่สำเร็จ: ${result.error.message}`)
      subjectName = result.data?.display_name?.trim() || null
    }
  }

  return {
    documentNumber: request.documentNumber,
    input: {
      subjectName,
      total: request.purchaseMethod === 'equipment_lease' ? null : request.total,
      members: checklist.committees.map((member) => ({
        kind: member.kind,
        seat: member.seat,
        name: member.name,
        namePrefix: member.namePrefix,
        positionTitle: member.positionTitle,
      })),
    },
  }
}
