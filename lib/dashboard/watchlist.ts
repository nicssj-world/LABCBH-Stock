import type { DashboardWatchItem, DashboardWatchlistPage } from '@/lib/dashboard/types'

export const DEFAULT_WATCHLIST_LIMIT = 5
export const WATCHLIST_BATCH_LIMIT = 10

export function compareDashboardWatchItems(left: DashboardWatchItem, right: DashboardWatchItem): number {
  return left.remainingPercent - right.remainingPercent
    || left.contractId - right.contractId
    || left.lsCode.localeCompare(right.lsCode, 'en')
}

export function paginateDashboardWatchlist(
  items: DashboardWatchItem[],
  offset: number,
  limit: number,
): DashboardWatchlistPage {
  const safeOffset = Math.max(0, Math.trunc(offset))
  const safeLimit = Math.max(1, Math.trunc(limit))
  const sorted = [...items].sort(compareDashboardWatchItems)
  const pageItems = sorted.slice(safeOffset, safeOffset + safeLimit)
  const nextOffset = safeOffset + pageItems.length < sorted.length
    ? safeOffset + pageItems.length
    : null

  return {
    items: pageItems,
    totalCount: sorted.length,
    offset: safeOffset,
    limit: safeLimit,
    nextOffset,
  }
}
