import 'server-only'

import { cache } from 'react'
import { redirect } from 'next/navigation'
import { decideProtectedRoute, deriveAppRoles } from '@/lib/auth/access'
import { resolveAuthenticatedUser, unwrapActorQuery } from '@/lib/auth/resolution'
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

interface ProfileRow {
  id: string
  ephis_id: string | null
  name: string | null
  avatar_url: string | null
  role: string | null
  status: string | null
  deleted_at: string | null
}

interface MembershipRow {
  role: LabStockRole
  active: boolean
}

export const getActor = cache(async (): Promise<Actor | null> => {
  const supabase = await createClient()
  const authResult = await supabase.auth.getUser()
  const user = resolveAuthenticatedUser(authResult)

  if (!user) return null

  const profileData = unwrapActorQuery(
    'profile',
    await supabase
      .from('profiles')
      .select('id,ephis_id,name,avatar_url,role,status,deleted_at')
      .eq('id', user.id)
      .maybeSingle(),
  )

  if (!profileData) {
    return {
      id: user.id,
      ephisId: null,
      name: null,
      avatarUrl: null,
      profileRole: null,
      appRoles: [],
    }
  }

  const profile = profileData as ProfileRow
  if (profile.status !== 'active' || profile.deleted_at !== null) {
    return {
      id: profile.id,
      ephisId: profile.ephis_id,
      name: profile.name,
      avatarUrl: profile.avatar_url,
      profileRole: profile.role,
      appRoles: [],
    }
  }

  const membershipData = unwrapActorQuery(
    'membership',
    await supabase
      .from('lab_stock_memberships')
      .select('role,active')
      .eq('profile_id', user.id),
  )

  return {
    id: profile.id,
    ephisId: profile.ephis_id,
    name: profile.name,
    avatarUrl: profile.avatar_url,
    profileRole: profile.role,
    appRoles: deriveAppRoles({
      ephisId: profile.ephis_id,
      profileRole: profile.role,
      profileStatus: profile.status,
      deletedAt: profile.deleted_at,
      memberships: (membershipData ?? []) as MembershipRow[],
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
