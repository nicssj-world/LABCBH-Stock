/**
 * Shown the instant a protected route is requested, until its data arrives.
 *
 * Every route below this layout is server-rendered on demand, so a navigation
 * spends the whole read on the server. Without this boundary the browser keeps
 * the previous page on screen and paints nothing, which staff read as the
 * application having frozen rather than as work in progress.
 *
 * Deliberately generic: it stands in for the register, the detail views and
 * the forms alike, so a page-shaped guess never contradicts what actually
 * renders a moment later.
 */
export default function ProtectedRouteLoading() {
  return (
    <div className="route-skeleton" role="status" aria-live="polite">
      <span className="visually-hidden">กำลังโหลดข้อมูล</span>
      <div className="route-skeleton__panel" aria-hidden="true">
        <span className="route-skeleton__line route-skeleton__line--kicker" />
        <span className="route-skeleton__line route-skeleton__line--title" />
        <span className="route-skeleton__line route-skeleton__line--short" />
      </div>
      <div className="route-skeleton__panel" aria-hidden="true">
        <div className="route-skeleton__row">
          <span className="route-skeleton__line" />
          <span className="route-skeleton__line" />
          <span className="route-skeleton__line" />
          <span className="route-skeleton__line" />
        </div>
        <span className="route-skeleton__line" />
        <span className="route-skeleton__line route-skeleton__line--short" />
        <span className="route-skeleton__line route-skeleton__line--tail" />
      </div>
    </div>
  )
}
