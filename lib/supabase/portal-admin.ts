import 'server-only'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'

let portalAdmin: SupabaseClient | null = null

/**
 * The production Portal and Stock staging may be different Supabase projects.
 * Keep the Portal service-role client server-only and fall back to the Stock
 * admin client only when no separate Portal target is configured (the shared
 * production-project setup).
 */
export function getPortalSupabaseAdmin(): SupabaseClient {
  const portalUrl = process.env.LAB_MANAGEMENT_PORTAL_SUPABASE_URL?.trim()
  const portalServiceRoleKey = process.env.LAB_MANAGEMENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!portalUrl && !portalServiceRoleKey) return supabaseAdmin
  if (!portalUrl || !portalServiceRoleKey) {
    throw new Error(
      'การเชื่อมต่อ Lab Management Portal ยังตั้งค่าไม่ครบ: ต้องมี LAB_MANAGEMENT_PORTAL_SUPABASE_URL และ LAB_MANAGEMENT_PORTAL_SUPABASE_SERVICE_ROLE_KEY',
    )
  }

  portalAdmin ??= createClient(portalUrl, portalServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return portalAdmin
}
