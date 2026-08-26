export interface StockCheckStatus {
  lastCheckedAt: string | null
  isCheckedThisWeek: boolean
}

/**
 * Weekly stock checks reset on Monday in the application's Bangkok business
 * calendar. The date is parsed as UTC deliberately: it is already a Bangkok
 * calendar date, so the calculation must not depend on the server locale.
 */
export function getStockCheckWeekStart(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const daysSinceMonday = (date.getUTCDay() + 6) % 7
  date.setUTCDate(date.getUTCDate() - daysSinceMonday)

  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

export const EMPTY_STOCK_CHECK_STATUS: StockCheckStatus = {
  lastCheckedAt: null,
  isCheckedThisWeek: false,
}
