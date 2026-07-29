'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { assertMembershipAdministrator } from '@/lib/access/authorization'
import { membershipInputSchema } from '@/lib/access/schema'
import type { MembershipInput } from '@/lib/access/schema'
import { requireActor } from '@/lib/auth/actor'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function setMembership(input: MembershipInput) {
  const actor = await requireActor()
  assertMembershipAdministrator(actor)
  const parsed = membershipInputSchema.parse(input)

  // The RPC re-checks admin rights against the database, so this Server Action
  // is a convenience gate rather than the security boundary.
  const result = await supabaseAdmin.rpc('set_lab_stock_membership', {
    p_profile_id: parsed.profileId,
    p_actor_id: actor.id,
    p_role: parsed.role,
    p_active: parsed.active,
    p_note: parsed.note ?? null,
  })

  if (result.error) throw new Error(`บันทึกสิทธิ์ไม่สำเร็จ: ${result.error.message}`)

  revalidatePath('/settings/access')
  return z.object({ id: z.string().uuid() }).passthrough().parse(result.data)
}
