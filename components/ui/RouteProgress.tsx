'use client'

import { usePathname, useSearchParams } from 'next/navigation'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

/**
 * A navigation that resolves faster than this only produces a flash, which
 * reads as a rendering glitch rather than as progress.
 */
const SHOW_AFTER_MS = 120

/**
 * A click can navigate nowhere — a cancelled route, a download, a link the
 * router declines. Without this the bar would sit on screen forever.
 */
const GIVE_UP_AFTER_MS = 15_000

const StartNavigationContext = createContext<() => void>(() => {})

/**
 * For controls that change the route without an anchor click. The filter bench
 * calls router.replace() from a transition, which no click listener can see.
 */
export function useNavigationProgress() {
  return useContext(StartNavigationContext)
}

function isRouterNavigation(event: MouseEvent): boolean {
  // Anything the browser handles itself — a new tab, a download, a different
  // origin — never produces a client-side transition to wait for.
  if (event.defaultPrevented || event.button !== 0) return false
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false

  const target = event.target
  const anchor = target instanceof Element ? target.closest('a') : null
  if (!(anchor instanceof HTMLAnchorElement)) return false
  if (anchor.hasAttribute('download')) return false
  if (anchor.target && anchor.target !== '_self') return false

  const href = anchor.getAttribute('href')
  if (!href || href.startsWith('#')) return false
  if (anchor.origin !== window.location.origin) return false

  // Re-opening the page you are already on has nothing to wait for.
  return anchor.pathname !== window.location.pathname || anchor.search !== window.location.search
}

/**
 * A slim bar across the top of the workbench for the whole time a navigation
 * is in flight.
 *
 * The route skeleton cannot cover this on its own. React deliberately withholds
 * a Suspense fallback when a transition looks like it will resolve quickly, so
 * opening a record — measured at 500-800ms — showed the previous page with no
 * sign at all that the click had registered, while slower moves between the
 * main sections did get the skeleton. This fills exactly that band, and it sits
 * above the content rather than replacing it, so nothing is taken away from the
 * screen the user is still reading.
 */
export function RouteProgress({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const search = useSearchParams().toString()
  const currentUrl = `${pathname}?${search}`
  const [phase, setPhase] = useState<'idle' | 'pending' | 'visible'>('idle')
  const [settledUrl, setSettledUrl] = useState(currentUrl)

  // Landing on a new URL is the only signal that a navigation finished.
  // Reconciling it here rather than in an effect means the bar is already gone
  // in the same commit that paints the new page, with no frame in between.
  if (settledUrl !== currentUrl) {
    setSettledUrl(currentUrl)
    setPhase('idle')
  }

  const start = useCallback(() => setPhase('pending'), [])
  const visible = phase === 'visible'

  useEffect(() => {
    if (phase === 'idle') return

    if (phase === 'pending') {
      const reveal = window.setTimeout(() => setPhase('visible'), SHOW_AFTER_MS)
      return () => window.clearTimeout(reveal)
    }

    const giveUp = window.setTimeout(() => setPhase('idle'), GIVE_UP_AFTER_MS)
    return () => window.clearTimeout(giveUp)
  }, [phase])

  useEffect(() => {
    const onDocumentClick = (event: MouseEvent) => {
      if (isRouterNavigation(event)) start()
    }

    // Capture phase, so a handler that stops propagation on the way up — the
    // summary dialogs close themselves on the same click — cannot hide the
    // navigation from this.
    document.addEventListener('click', onDocumentClick, true)
    return () => document.removeEventListener('click', onDocumentClick, true)
  }, [start])

  return (
    <StartNavigationContext.Provider value={start}>
      {visible && (
        <div className="route-progress" aria-hidden="true">
          <span className="route-progress__bar" />
        </div>
      )}
      <span className="visually-hidden" role="status">
        {visible ? 'กำลังเปลี่ยนหน้า' : ''}
      </span>
      {children}
    </StartNavigationContext.Provider>
  )
}
