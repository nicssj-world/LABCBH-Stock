'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { createClient } from '@/lib/supabase/client'

export function LogoutButton() {
  const router = useRouter()
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSignOut() {
    setError(null)
    setIsSigningOut(true)

    try {
      const { error: signOutError } = await createClient().auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      router.replace('/login')
      router.refresh()
    } catch {
      setError('ออกจากระบบไม่สำเร็จ กรุณาลองอีกครั้ง')
      setIsSigningOut(false)
    }
  }

  return (
    <div className="logout-control">
      <Button type="button" variant="secondary" onClick={handleSignOut} disabled={isSigningOut}>
        {isSigningOut ? 'กำลังออก…' : 'ออกจากระบบ'}
      </Button>
      {error ? <p className="logout-control__error" role="alert">{error}</p> : null}
    </div>
  )
}
