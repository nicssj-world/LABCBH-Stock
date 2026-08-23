'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import type { DashboardWatchItem, DashboardWatchlistPage } from '@/lib/dashboard/types'

const PREVIEW_COUNT = 5
const BATCH_SIZE = 10

function rowKey(item: DashboardWatchItem) {
  return `${item.contractId}-${item.lsCode}`
}

function responseError(payload: unknown) {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) {
    const message = (payload as { error?: unknown }).error
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'โหลดรายการเพิ่มเติมไม่สำเร็จ'
}

function WatchlistRow({ item }: { item: DashboardWatchItem }) {
  return (
    <li key={rowKey(item)} data-watchlist-item={rowKey(item)} tabIndex={-1}>
      <div className="watchlist__identity">
        <span className="identifier">{item.lsCode}</span>
        <div>
          <strong>{item.name}</strong>
          <small>{item.contractName} · ปีงบประมาณ {item.fiscalYear ?? 'ไม่ระบุ'}</small>
        </div>
      </div>
      <div className="watchlist__remaining">
        <strong>{item.remainingPercent.toLocaleString('th-TH', { maximumFractionDigits: 1 })}% คงเหลือ</strong>
        <span>{item.remainingQuantity.toLocaleString('th-TH')} / {item.contractedQuantity.toLocaleString('th-TH')} {item.unit}</span>
        <div className="remaining-track" aria-hidden="true">
          <span style={{ width: `${Math.max(item.remainingPercent, 2)}%` }} />
        </div>
      </div>
      <Link className="text-link" href={`/contracts/${item.contractId}`}>เปิดสัญญา</Link>
    </li>
  )
}

export interface DashboardWatchlistProps {
  initialItems: DashboardWatchItem[]
  totalCount: number
  nextOffset: number | null
}

export function DashboardWatchlist({
  initialItems,
  totalCount,
  nextOffset: initialNextOffset,
}: DashboardWatchlistProps) {
  const [items, setItems] = useState(() => initialItems.slice(0, PREVIEW_COUNT))
  const [nextOffset, setNextOffset] = useState(initialNextOffset)
  const [expanded, setExpanded] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const focusItemKey = useRef<string | null>(null)
  const rowsRef = useRef<HTMLOListElement>(null)
  const restoredFromUrl = useRef(false)
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()

  const replaceDisclosureState = useCallback((isExpanded: boolean) => {
    const params = new URLSearchParams(searchParams.toString())
    if (isExpanded) params.set('watchlist', 'expanded')
    else params.delete('watchlist')
    const query = params.toString()
    router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false })
  }, [pathname, router, searchParams])

  const loadMore = useCallback(async () => {
    if (isLoading || nextOffset === null) return

    const requestedOffset = nextOffset
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/dashboard/watchlist?offset=${requestedOffset}&limit=${BATCH_SIZE}`,
        { headers: { Accept: 'application/json' } },
      )
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(responseError(payload))

      const page = payload as DashboardWatchlistPage
      focusItemKey.current = page.items[0] ? rowKey(page.items[0]) : null
      setItems((current) => [...current, ...page.items])
      setNextOffset(page.nextOffset)
      setExpanded(true)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'โหลดรายการเพิ่มเติมไม่สำเร็จ')
    } finally {
      setIsLoading(false)
    }
  }, [isLoading, nextOffset])

  useEffect(() => {
    if (restoredFromUrl.current || searchParams.get('watchlist') !== 'expanded') return
    restoredFromUrl.current = true
    setExpanded(true)
    void loadMore()
  }, [loadMore, searchParams])

  useEffect(() => {
    const itemKey = focusItemKey.current
    if (!itemKey) return
    const row = Array.from(rowsRef.current?.children ?? []).find(
      (child) => child.getAttribute('data-watchlist-item') === itemKey,
    )
    if (row instanceof HTMLElement) row.focus()
    focusItemKey.current = null
  }, [items])

  const collapse = () => {
    setItems(initialItems.slice(0, PREVIEW_COUNT))
    setNextOffset(initialNextOffset)
    setExpanded(false)
    setError(null)
    replaceDisclosureState(false)
  }

  if (totalCount === 0) {
    return (
      <div className="empty-state">
        <strong>ยังไม่มีรายการต่ำกว่า 30%</strong>
        <p>ยอดคงเหลือของรายการสัญญาทั้งหมดยังอยู่เหนือเกณฑ์เฝ้าระวัง</p>
      </div>
    )
  }

  const canExpand = nextOffset !== null
  const showDisclosure = totalCount > PREVIEW_COUNT || isLoading || error !== null

  return (
    <>
      <ol
        id="dashboard-watchlist-rows"
        ref={rowsRef}
        className="watchlist"
        aria-busy={isLoading || undefined}
      >
        {items.map((item) => <WatchlistRow key={rowKey(item)} item={item} />)}
      </ol>
      {showDisclosure && (
        <div className="dashboard-watchlist__disclosure">
          <div>
            <p className="dashboard-watchlist__status" aria-live="polite">
              แสดง {items.length.toLocaleString('th-TH')} จาก {totalCount.toLocaleString('th-TH')} รายการ
            </p>
            {isLoading && <p className="dashboard-watchlist__status">กำลังโหลดรายการเพิ่มเติม…</p>}
            {error && (
              <div className="dashboard-watchlist__error" role="alert">
                <span>{error}</span>
                <button className="lab-button lab-button--secondary" type="button" onClick={() => void loadMore()}>
                  ลองใหม่
                </button>
              </div>
            )}
          </div>
          {canExpand && !isLoading && (
            <button
              className="lab-button lab-button--secondary dashboard-watchlist__button"
              type="button"
              aria-expanded={expanded}
              aria-controls="dashboard-watchlist-rows"
              onClick={() => {
                replaceDisclosureState(true)
                void loadMore()
              }}
            >
              แสดงเพิ่มเติม
            </button>
          )}
          {expanded && items.length > PREVIEW_COUNT && (
            <button
              className="lab-button lab-button--secondary dashboard-watchlist__button"
              type="button"
              aria-expanded="true"
              aria-controls="dashboard-watchlist-rows"
              onClick={collapse}
            >
              ยุบรายการ
            </button>
          )}
        </div>
      )}
    </>
  )
}
