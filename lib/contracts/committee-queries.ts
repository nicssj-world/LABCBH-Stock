import 'server-only'

import type { PurchaseRequestCommitteeCandidate } from '@/lib/pr/form-options'
import type { PurchaseRequestCommitteeKind } from '@/lib/pr/checklist'
import { supabaseAdmin } from '@/lib/supabase/admin'

export interface ContractCommitteeMember {
  id: string
  kind: PurchaseRequestCommitteeKind
  seat: number
  profileId: string
  name: string
  namePrefix?: string | null
  positionTitle: string | null
  sourcePurchaseRequestId: string | null
}

export async function getContractCommitteeRoster(contractId: number): Promise<ContractCommitteeMember[]> {
  const result = await supabaseAdmin
    .from('contract_committees')
    .select('id, committee_kind, seat, profile_id, name_snapshot, position_snapshot, source_purchase_request_id, profile:profiles!contract_committees_profile_id_fkey(name, name_prefix, position_title)')
    .eq('contract_id', contractId)
    .order('committee_kind')
    .order('seat')
  if (result.error) throw new Error(`อ่าน roster กรรมการสัญญาไม่สำเร็จ: ${result.error.message}`)
  return (result.data ?? []).map((row) => {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile
    return {
      id: row.id,
      kind: row.committee_kind as PurchaseRequestCommitteeKind,
      seat: Number(row.seat),
      profileId: row.profile_id,
      name: profile?.name?.trim() || row.name_snapshot,
      namePrefix: profile?.name_prefix?.trim() || null,
      positionTitle: profile?.position_title?.trim() || null,
      sourcePurchaseRequestId: row.source_purchase_request_id ?? null,
    }
  })
}

export async function listContractCommitteeCandidates(): Promise<PurchaseRequestCommitteeCandidate[]> {
  const result = await supabaseAdmin
    .from('profiles')
    .select('id, name, name_prefix, ephis_id, position_title')
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('name', 'is', null)
    .order('name')
  if (result.error) throw new Error(`อ่านรายชื่อบุคลากรไม่สำเร็จ: ${result.error.message}`)
  return (result.data ?? []).map((profile) => ({
    id: profile.id,
    name: profile.name?.trim() || profile.ephis_id || profile.id,
    namePrefix: profile.name?.trim() ? profile.name_prefix?.trim() || null : null,
    ephisId: profile.ephis_id ?? null,
    positionTitle: profile.position_title?.trim() || null,
  }))
}
