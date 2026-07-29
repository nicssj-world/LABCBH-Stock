import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type LabStockRole = 'admin' | 'head' | 'stock_officer' | 'viewer' | 'reporter'

export interface Actor {
  id: string
  ephisId: string | null
  name: string | null
  profileRole: string | null
  appRoles: LabStockRole[]
}

interface ProfileRow {
  id: string
  ephis_id: string | null
  name: string | null
  role: string | null
}

interface MembershipRow {
  role: LabStockRole
  active: boolean
}

export async function getActor(): Promise<Actor | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: profileData, error: profileError } = await supabase
    .from('profiles')
    .select('id,ephis_id,name,role')
    .eq('id', user.id)
    .single()

  if (profileError || !profileData) return null

  const profile = profileData as ProfileRow
  const { data: membershipData } = await supabase
    .from('lab_stock_memberships')
    .select('role,active')
    .eq('profile_id', user.id)

  const roles = new Set(
    ((membershipData ?? []) as MembershipRow[])
      .filter((membership) => membership.active)
      .map((membership) => membership.role),
  )

  if (profile.ephis_id === '9495') roles.add('admin')
  if (profile.role === 'Manager') roles.add('head')

  return {
    id: profile.id,
    ephisId: profile.ephis_id,
    name: profile.name,
    profileRole: profile.role,
    appRoles: [...roles],
  }
}

export async function requireActor(): Promise<Actor> {
  const actor = await getActor()
  if (!actor) redirect('/login')
  return actor
}
