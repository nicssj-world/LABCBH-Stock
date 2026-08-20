import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { decideProtectedRoute, deriveAppRoles } from '@/lib/auth/access'
import { readAuthClaims, resolveAuthenticatedSubject, unwrapActorQuery } from '@/lib/auth/resolution'
import { createClient } from '@/lib/supabase/server'

export type LabStockRole = 'admin' | 'head' | 'stock_officer' | 'viewer'

export interface Actor {
  id: string
  ephisId: string | null
  name: string | null
  avatarUrl?: string | null
  profileRole: string | null
  appRoles: LabStockRole[]
}

interface MembershipRow {
  role: LabStockRole
  active: boolean
}

interface ProfileRow {
  id: string
  ephis_id: string | null
  name: string | null
  avatar_url: string | null
  role: string | null
  status: string | null
  deleted_at: string | null
  lab_stock_memberships: MembershipRow[] | null
}

/**
 * The profile and its LAB Stock memberships in one read.
 *
 * `!profile_id` is required rather than decorative: lab_stock_memberships
 * reaches profiles through granted_by and updated_by as well, and PostgREST
 * refuses an embed it cannot attribute to a single foreign key (PGRST201).
 *
 * The membership rows come back under the caller's own RLS, which already
 * allows a profile to read its own memberships, so this grants nothing the
 * separate query did not.
 */
const ACTOR_PROFILE_SELECT =
  'id,ephis_id,name,avatar_url,role,status,deleted_at,lab_stock_memberships!profile_id(role,active)'

export const getActor = cache(async (): Promise<Actor | null> => {
  const supabase = await createClient()
  const subject = resolveAuthenticatedSubject(await readAuthClaims(supabase))

  if (!subject) return null

  const profileData = unwrapActorQuery(
    'profile',
    await supabase.from('profiles').select(ACTOR_PROFILE_SELECT).eq('id', subject).maybeSingle(),
  )

  if (!profileData) {
    return {
      id: subject,
      ephisId: null,
      name: null,
      avatarUrl: null,
      profileRole: null,
      appRoles: [],
    }
  }

  const profile = profileData as ProfileRow

  return {
    id: profile.id,
    ephisId: profile.ephis_id,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    profileRole: profile.role,
    // deriveAppRoles is what withholds every role from an inactive or
    // soft-deleted profile, so those accounts need no separate early return
    // here to keep landing on access-denied.
    appRoles: deriveAppRoles({
      ephisId: profile.ephis_id,
      profileRole: profile.role,
      profileStatus: profile.status,
      deletedAt: profile.deleted_at,
      memberships: profile.lab_stock_memberships ?? [],
    }),
  }
})

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  const decision = decideProtectedRoute(actor)

  if (!actor) redirect('/login')
  if (decision === 'access-denied') redirect('/access-denied')

  return actor
}
