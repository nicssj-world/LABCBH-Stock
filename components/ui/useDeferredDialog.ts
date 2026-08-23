'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A <dialog> that only enters the DOM once someone asks to see it.
 *
 * The register and the catalogue render one dialog per row, and render every
 * row twice so the table and the card layout can each have their own. On the
 * inventory list that measured 393 dialogs carrying 2.5MB of the page's 3.5MB
 * of HTML — a complete edit form per item, for the one form a user might
 * actually open. Deferring the body leaves the trigger button, which is all a
 * closed dialog ever showed.
 *
 * The dialog stays mounted after its first open, so anything typed into it
 * survives closing and reopening exactly as it did when it was always mounted.
 * Consumers that need to release the native top layer immediately (for
 * example, a row summary that is duplicated in two responsive layouts) can
 * use `unmount`, which closes and removes the element in the same render.
 */
export function useDeferredDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [isRendered, setIsRendered] = useState(false)

  const open = useCallback(() => {
    // Already mounted, so reopening never has to wait for a commit.
    if (dialogRef.current) {
      dialogRef.current.showModal()
      return
    }
    setIsRendered(true)
  }, [])

  const close = useCallback(() => dialogRef.current?.close(), [])

  const unmount = useCallback(() => {
    dialogRef.current?.close()
    setIsRendered(false)
  }, [])

  useEffect(() => {
    // First open only: the element does not exist yet when the click handler
    // runs, so showModal() has to wait until React has committed it.
    if (isRendered && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal()
    }
  }, [isRendered])

  return { dialogRef, isRendered, open, close, unmount }
}
