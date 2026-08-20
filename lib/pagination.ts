export const LIST_PAGE_SIZE = 25

export function parsePage(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1
}

export function paginate<T>(items: T[], requestedPage: number, pageSize = LIST_PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(Math.max(requestedPage, 1), pageCount)
  const startIndex = (currentPage - 1) * pageSize

  return {
    items: items.slice(startIndex, startIndex + pageSize),
    currentPage,
    pageCount,
    totalCount: items.length,
    startIndex,
  }
}
