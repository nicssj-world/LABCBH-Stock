import Link from 'next/link'

export function ListPagination({
  currentPage,
  pageCount,
  totalCount,
  startIndex,
  pageSize,
  itemLabel = 'รายการ',
  buildHref,
}: {
  currentPage: number
  pageCount: number
  totalCount: number
  startIndex: number
  pageSize: number
  itemLabel?: string
  buildHref: (page: number) => string
}) {
  if (totalCount === 0) return null

  const firstItem = startIndex + 1
  const lastItem = Math.min(startIndex + pageSize, totalCount)

  return (
    <nav className="list-pagination" aria-label={`การแบ่งหน้า${itemLabel}`}>
      <p>แสดง {firstItem}–{lastItem} จาก {totalCount} {itemLabel}</p>
      {pageCount > 1 && (
        <div className="list-pagination__controls">
          {currentPage > 1 ? (
            <Link className="lab-link-button lab-link-button--secondary" href={buildHref(currentPage - 1)}>
              ก่อนหน้า
            </Link>
          ) : (
            <span className="lab-link-button lab-link-button--secondary" aria-disabled="true">ก่อนหน้า</span>
          )}
          <span className="list-pagination__current" aria-current="page">หน้า {currentPage} / {pageCount}</span>
          {currentPage < pageCount ? (
            <Link className="lab-link-button lab-link-button--secondary" href={buildHref(currentPage + 1)}>
              ถัดไป
            </Link>
          ) : (
            <span className="lab-link-button lab-link-button--secondary" aria-disabled="true">ถัดไป</span>
          )}
        </div>
      )}
    </nav>
  )
}
