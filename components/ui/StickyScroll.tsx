'use client'

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'

export interface FloatingScrollbarState {
  visible: boolean
  left: number
  width: number
  contentWidth: number | string
}

interface FloatingScrollbarMetrics {
  scrollWidth: number
  clientWidth: number
  rectTop: number
  rectBottom: number
  rectLeft?: number
  rectRight?: number
  viewportHeight: number
  viewportLeft?: number
  viewportRight?: number
}

/**
 * Keep the visibility rule pure so the viewport edge case is regression-tested
 * without needing to mount a full Next.js page.
 */
export function getFloatingScrollbarState({
  scrollWidth,
  clientWidth,
  rectTop,
  rectBottom,
  rectLeft,
  rectRight,
  viewportHeight,
  viewportLeft = 0,
  viewportRight = Number.POSITIVE_INFINITY,
}: FloatingScrollbarMetrics): FloatingScrollbarState {
  const left = Math.max(viewportLeft + 8, rectLeft ?? viewportLeft + 8)
  const right = Math.min(viewportRight - 8, rectRight ?? viewportRight - 8)
  const width = Math.max(0, right - left)

  return {
    visible:
      scrollWidth > clientWidth
      && width > 48
      && rectTop < viewportHeight - 16
      && rectBottom > viewportHeight,
    left,
    width,
    contentWidth: scrollWidth,
  }
}

interface StickyScrollProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  contentWidth?: number | string
  bottom?: number | string
  ariaLabel?: string
}

const DEFAULT_ARIA_LABEL = 'ตาราง เลื่อนในแนวนอนเพื่อดูคอลัมน์เพิ่มเติม'

export function StickyScroll({
  children,
  className,
  style,
  contentWidth,
  bottom = 'max(0px, env(safe-area-inset-bottom))',
  ariaLabel = DEFAULT_ARIA_LABEL,
}: StickyScrollProps) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const floatingRef = useRef<HTMLDivElement>(null)
  const scrollAreaId = `sticky-scroll-${useId().replaceAll(':', '')}`
  const [floatingScrollbar, setFloatingScrollbar] = useState<FloatingScrollbarState>({
    visible: false,
    left: 0,
    width: 0,
    contentWidth: 0,
  })
  const [hasVerticalOverflow, setHasVerticalOverflow] = useState(false)

  const measure = useCallback(() => {
    const wrapper = wrapperRef.current
    const body = bodyRef.current
    if (!wrapper || !body) return

    const rect = wrapper.getBoundingClientRect()
    const viewportRight = document.documentElement.clientWidth
    const nextHasVerticalOverflow = body.scrollHeight > body.clientHeight + 1
    setHasVerticalOverflow((current) => (
      current === nextHasVerticalOverflow ? current : nextHasVerticalOverflow
    ))
    const measured = getFloatingScrollbarState({
      scrollWidth: body.scrollWidth,
      clientWidth: body.clientWidth,
      rectTop: rect.top,
      rectBottom: rect.bottom,
      rectLeft: rect.left,
      rectRight: rect.right,
      viewportHeight: window.innerHeight,
      viewportRight,
    })
    const nextState = {
      ...measured,
      contentWidth: contentWidth ?? measured.contentWidth,
    }

    setFloatingScrollbar((current) => (
      current.visible === nextState.visible
      && current.left === nextState.left
      && current.width === nextState.width
      && current.contentWidth === nextState.contentWidth
        ? current
        : nextState
    ))
  }, [contentWidth])

  useEffect(() => {
    let animationFrame = 0
    const scheduleMeasure = () => {
      cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(measure)
    }

    scheduleMeasure()
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleMeasure)
    if (bodyRef.current) resizeObserver?.observe(bodyRef.current)
    if (bodyRef.current?.firstElementChild) resizeObserver?.observe(bodyRef.current.firstElementChild)
    window.addEventListener('scroll', scheduleMeasure, { passive: true })
    window.addEventListener('resize', scheduleMeasure, { passive: true })

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', scheduleMeasure)
      window.removeEventListener('resize', scheduleMeasure)
    }
  }, [measure])

  useEffect(() => {
    measure()
  }, [children, measure])

  useEffect(() => {
    const body = bodyRef.current
    const floating = floatingRef.current
    if (!body || !floating) return
    floating.scrollLeft = body.scrollLeft
  }, [floatingScrollbar.visible, floatingScrollbar.contentWidth])

  function syncFromBody() {
    const body = bodyRef.current
    const floating = floatingRef.current
    if (body && floating && floating.scrollLeft !== body.scrollLeft) {
      floating.scrollLeft = body.scrollLeft
    }
  }

  function syncFromFloating() {
    const body = bodyRef.current
    const floating = floatingRef.current
    if (body && floating && body.scrollLeft !== floating.scrollLeft) {
      body.scrollLeft = floating.scrollLeft
    }
  }

  const hideNativeScrollbar = floatingScrollbar.visible && !hasVerticalOverflow
  const bodyClassName = [
    'sticky-scroll-body',
    className,
    hideNativeScrollbar ? 'sticky-scroll-body--with-sticky-bar' : undefined,
  ].filter(Boolean).join(' ')

  return (
    <>
      <div ref={wrapperRef} className="sticky-scroll-wrapper">
        <div
          ref={bodyRef}
          id={scrollAreaId}
          className={bodyClassName}
          style={{ ...style, overflowX: 'auto' }}
          onScroll={syncFromBody}
          tabIndex={0}
          aria-label={ariaLabel}
        >
          {children}
        </div>
      </div>

      {floatingScrollbar.visible && (
        <div
          ref={floatingRef}
          className="sticky-scroll-floating"
          style={{ left: floatingScrollbar.left, width: floatingScrollbar.width, bottom }}
          onScroll={syncFromFloating}
          tabIndex={0}
          aria-controls={scrollAreaId}
          aria-label={`แถบเลื่อนแนวนอนสำหรับ${ariaLabel.replace(/^ตาราง\s*/, '')}`}
        >
          <div style={{ width: floatingScrollbar.contentWidth, height: 1 }} />
        </div>
      )}
    </>
  )
}
