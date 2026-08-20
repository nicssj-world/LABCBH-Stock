import type { ReactNode } from 'react'
import { AppShell } from '@/components/ui/AppShell'
import { requireActor } from '@/lib/auth/actor'
import { getNotificationSnapshot } from '@/lib/notifications/queries'

export const dynamic = 'force-dynamic'

export default async function ProtectedLayout({ children }: { children: ReactNode }) {
  const actor = await requireActor()
  const notificationSnapshot = await getNotificationSnapshot(actor)
  return <AppShell actor={actor} notificationSnapshot={notificationSnapshot}>{children}</AppShell>
}
