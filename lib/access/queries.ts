import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { LAB_STOCK_ROLES } from './schema'

export type LabStockRoleName = (typeof LAB_STOCK_ROLES)[number]

export interface MembershipProfile {
  profileId: string
  ephisId: string | null
  name: string | null
  portalRole: string | null
  status: string | null
  /** Active app roles granted by an explicit membership row. */
  roles: LabStockRoleName[]
  /** Roles this profile has regardless of membership rows. */
  intrinsicRoles: LabStockRoleName[]
}

const profileRowSchema = z.object({
  id: z.string().uuid(),
  ephis_id: z.string().nullable(),
  name: z.string().nullable(),
  role: z.string().nullable(),
  status: z.string().nullable(),
  lab_stock_memberships: z
    .array(z.object({ role: z.enum(LAB_STOCK_ROLES), active: z.boolean() }))
    .nullable()
    .default([]),
})

export interface MembershipFilters {
  search?: string
  role?: LabStockRoleName
}

export async function listMemberships(
  filters: MembershipFilters = {},
): Promise<MembershipProfile[]> {
  const supabase = await createClient()
  let query = supabase
    .from('profiles')
    .select('id, ephis_id, name, role, status, lab_stock_memberships!lab_stock_memberships_profile_id_fkey (role, active)')
    .is('deleted_at', null)
    .order('name')

  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) {
    query = query.or(`name.ilike.%${search}%,ephis_id.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(`อ่านรายชื่อผู้ใช้งานไม่สำเร็จ: ${error.message}`)

  const profiles = profileRowSchema
    .array()
    .parse(data ?? [])
    .map((row) => {
      // Mirrors deriveAppRoles: 9495 is always admin and a portal Manager is
      // always head, so the matrix shows why a toggle looks like a no-op.
      const intrinsicRoles: LabStockRoleName[] = []
      if (row.ephis_id === '9495') intrinsicRoles.push('admin')
      if (row.role === 'Manager') intrinsicRoles.push('head')

      return {
        profileId: row.id,
        ephisId: row.ephis_id,
        name: row.name,
        portalRole: row.role,
        status: row.status,
        roles: (row.lab_stock_memberships ?? [])
          .filter((membership) => membership.active)
          .map((membership) => membership.role),
        intrinsicRoles,
      }
    })

  if (!filters.role) return profiles
  return profiles.filter(
    (profile) =>
      profile.roles.includes(filters.role!) || profile.intrinsicRoles.includes(filters.role!),
  )
}
