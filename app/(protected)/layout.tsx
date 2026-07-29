import type { ReactNode } from 'react'
import { AppShell } from '@/components/ui/AppShell'
import { requireActor } from '@/lib/auth/actor'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor()
  return <AppShell actor={actor}>{children}</AppShell>
}
