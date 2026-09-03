'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import {
  createIdleTimeoutController,
  IDLE_TIMEOUT_MS,
  type IdleTimeoutController,
  type IdleTimeoutSnapshot,
} from '@/lib/auth/idle-timeout'
import { createClient } from '@/lib/supabase/client'

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const
const INITIAL_SNAPSHOT: IdleTimeoutSnapshot = {
  state: 'active',
  remainingMs: IDLE_TIMEOUT_MS,
}

function formatCountdown(remainingMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1_000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return minutes + ':' + seconds
}

export function IdleSessionGuard() {
  const router = useRouter()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const controllerRef = useRef<IdleTimeoutController | null>(null)
  const [snapshot, setSnapshot] = useState(INITIAL_SNAPSHOT)
  const [isSigningOut, setIsSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const signOutAfterTimeout = useCallback(async () => {
    setError(null)
    setIsSigningOut(true)

    try {
      const { error: signOutError } = await createClient().auth.signOut({ scope: 'local' })
      if (signOutError) throw signOutError
      router.replace('/login')
      router.refresh()
    } catch {
      setError('ออกจากระบบอัตโนมัติไม่สำเร็จ กรุณาลองอีกครั้ง')
      setIsSigningOut(false)
    }
  }, [router])

  useEffect(() => {
    const controller = createIdleTimeoutController()
    controllerRef.current = controller

    const unsubscribe = controller.subscribe(setSnapshot)
    const recordActivity = () => {
      // Once the warning is visible, only the explicit Continue button may
      // extend the session; Escape and incidental key/pointer events cannot
      // bypass the warning.
      if (controller.getSnapshot().state === 'active') controller.recordActivity()
    }

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, recordActivity, { passive: true })
    })
    document.addEventListener('scroll', recordActivity, { capture: true, passive: true })

    const supabase = createClient()
    const { data: authState } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        controller.stop()
        setSnapshot({ state: 'active', remainingMs: IDLE_TIMEOUT_MS })
      }
    })

    controller.start()

    return () => {
      authState.subscription.unsubscribe()
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, recordActivity)
      })
      document.removeEventListener('scroll', recordActivity, true)
      unsubscribe()
      controller.stop()
      controllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (snapshot.state !== 'expired') return

    const signOutTask = window.setTimeout(() => {
      void signOutAfterTimeout()
    }, 0)

    return () => window.clearTimeout(signOutTask)
  }, [signOutAfterTimeout, snapshot.state])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (snapshot.state === 'active') {
      if (dialog.open) dialog.close()
      return
    }

    if (!dialog.open) dialog.showModal()
    if (snapshot.state === 'warning') {
      window.requestAnimationFrame(() => {
        dialog.querySelector<HTMLButtonElement>('[data-idle-continue]')?.focus()
      })
    }
  }, [snapshot.state])

  const isWarning = snapshot.state === 'warning'

  return (
    <dialog
      ref={dialogRef}
      className="app-dialog idle-session-dialog"
      role="dialog"
      aria-labelledby="idle-session-dialog-title"
      aria-modal="true"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="app-dialog__header">
        <div>
          <h2 id="idle-session-dialog-title">
            {isWarning ? 'กำลังจะออกจากระบบ' : 'กำลังออกจากระบบ'}
          </h2>
          <p>ระบบจะออกจากระบบอัตโนมัติเนื่องจากไม่มีการใช้งาน</p>
        </div>
      </div>
      <div className="app-dialog__body idle-session-dialog__body">
        {isWarning ? (
          <>
            <p className="idle-session-dialog__message">
              ไม่มีการใช้งาน ระบบจะออกจากระบบอัตโนมัติในอีก 1 นาที
            </p>
            <div className="idle-session-dialog__countdown" aria-live="polite">
              <span>เวลาที่เหลือ</span>
              <strong>{formatCountdown(snapshot.remainingMs)}</strong>
            </div>
          </>
        ) : (
          <p className="idle-session-dialog__message">
            ระบบกำลังพยายามออกจากระบบให้เสร็จสิ้น
          </p>
        )}
        {error ? <p className="idle-session-dialog__error" role="alert">{error}</p> : null}
        <div className="idle-session-dialog__actions">
          {isWarning ? (
            <Button
              data-idle-continue
              type="button"
              onClick={() => {
                setError(null)
                controllerRef.current?.continueSession()
              }}
            >
              ใช้งานต่อ
            </Button>
          ) : (
            <Button type="button" onClick={() => void signOutAfterTimeout()} disabled={isSigningOut}>
              {isSigningOut ? 'กำลังออก…' : 'ลองออกจากระบบอีกครั้ง'}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  )
}
