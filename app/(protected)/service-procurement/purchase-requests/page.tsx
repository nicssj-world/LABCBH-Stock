import Link from 'next/link'
import { requireActor } from '@/lib/auth/actor'
import { DEPARTMENTS } from '@/lib/organization/departments'
import { bangkokIsoDate } from '@/lib/date/thai'
import {
  SERVICE_REQUEST_FILTER_STATUSES,
  fiscalYearFromDate,
  isServiceRequestDisplayStatus,
  isServiceRequestTerminalStatus,
  serviceRequestDisplayStatus,
} from '@/lib/service-procurement/domain'
import { listServicePurchaseRequests } from '@/lib/service-procurement/queries'
import { canCreateServicePurchaseRequest } from '@/lib/service-procurement/authorization'
import { serviceRequestDisplayStatusLabel } from '@/lib/service-procurement/presenter'
import { AutoFilterBench } from '@/components/ui/AutoFilterBench'
import { ServicePurchaseRequestTable } from '@/components/service-procurement/ServicePurchaseRequestTable'

interface Props { searchParams: Promise<Record<string, string | string[] | undefined>> }

const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

export default async function ServicePurchaseRequestsPage({ searchParams }: Props) {
  const actor = await requireActor()
  const params = await searchParams
  const currentFiscalYear = fiscalYearFromDate(bangkokIsoDate())
  const requested = Number(first(params.fiscalYear) ?? currentFiscalYear)
  const fiscalYear = Number.isInteger(requested) && requested >= 2500 && requested <= 3000 ? requested : currentFiscalYear
  const department = first(params.department)?.trim() ?? ''
  const search = first(params.search)?.trim() ?? ''
  const showTerminal = first(params.showTerminal) === '1'
  const requestedStatus = first(params.status)
  const status = isServiceRequestDisplayStatus(requestedStatus) ? requestedStatus : undefined
  const loadedRequests = await listServicePurchaseRequests({
    fiscalYear,
    department: department || undefined,
    status,
    search: search || undefined,
  })
  const terminalRequestCount = loadedRequests.filter((request) => isServiceRequestTerminalStatus(serviceRequestDisplayStatus(request))).length
  const requests = showTerminal || status
    ? loadedRequests
    : loadedRequests.filter((request) => !isServiceRequestTerminalStatus(serviceRequestDisplayStatus(request)))
  const showTerminalStatusOptions = showTerminal || (status !== undefined && isServiceRequestTerminalStatus(status))
  const statusOptions = SERVICE_REQUEST_FILTER_STATUSES
    .filter((value) => showTerminalStatusOptions || !isServiceRequestTerminalStatus(value))
    .map((value) => ({ value, label: serviceRequestDisplayStatusLabel(value) }))
  const showVisibilityToggle = !status && (showTerminal || terminalRequestCount > 0)
  const buildVisibilityHref = (nextShowTerminal: boolean) => {
    const nextParams = new URLSearchParams()
    nextParams.set('fiscalYear', String(fiscalYear))
    if (search) nextParams.set('search', search)
    if (department) nextParams.set('department', department)
    if (status) nextParams.set('status', status)
    if (nextShowTerminal) nextParams.set('showTerminal', '1')
    const query = nextParams.toString()
    return `/service-procurement/purchase-requests?${query}`
  }

  return (
    <div className="route-stack">
      <header className="page-heading page-heading--actions">
        <div>
          <p className="section-kicker">SERVICE PROCUREMENT · PR</p>
          <h1>ใบ PR (งานจ้าง)</h1>
          <p>ติดตามการขอจ้าง ตั้งแต่ส่ง PR จนถึงการใช้จริงและการปิด PO</p>
        </div>
        <div className="page-heading__actions">
          {canCreateServicePurchaseRequest(actor) && (
            <Link className="lab-link-button lab-link-button--primary" href="/service-procurement/purchase-requests/new">
              สร้างใบ PR งานจ้าง
            </Link>
          )}
        </div>
      </header>

      <section className="bench-panel service-register-toolbar">
        <AutoFilterBench
          ariaLabel="ตัวกรองใบ PR งานจ้าง"
          className="service-register-filters"
          showClear={false}
          fields={[
            {
              type: 'select',
              name: 'fiscalYear',
              label: 'ปีงบประมาณ',
              value: String(fiscalYear),
              options: [
                { value: String(currentFiscalYear), label: `${currentFiscalYear} (ปัจจุบัน)` },
                ...Array.from({ length: 6 }, (_, index) => currentFiscalYear - index - 1).map((year) => ({ value: String(year), label: String(year) })),
              ],
            },
            {
              type: 'search',
              name: 'search',
              label: 'ค้นหา',
              value: search,
              placeholder: 'เลข SPR / PO / PR จาก E-Phis / Invoice / รายการตรวจ / หน่วยงาน / ผู้ขอ',
            },
            {
              type: 'select',
              name: 'department',
              label: 'หน่วยงาน',
              value: department,
              options: [
                { value: '', label: 'ทุกหน่วยงาน' },
                ...DEPARTMENTS.map((value) => ({ value, label: value })),
              ],
            },
            {
              type: 'select',
              name: 'status',
              label: 'สถานะ',
              value: status ?? '',
              options: [{ value: '', label: 'ทุกสถานะ' }, ...statusOptions],
            },
          ]}
        />
        <p className="service-register-toolbar__note">
          แสดงปีงบประมาณ {fiscalYear}{fiscalYear !== currentFiscalYear ? ' · ประวัติย้อนหลัง' : ' · ปัจจุบัน'}
        </p>
      </section>

      <section className="bench-panel" aria-labelledby="service-purchase-request-list-title">
        <div className="bench-panel__header">
          <div>
            <p className="section-kicker">REQUEST REGISTER</p>
            <h2 id="service-purchase-request-list-title">รายการใบ PR</h2>
          </div>
          <div className="service-register-list__header-actions">
            {showVisibilityToggle && (
              <Link
                className="lab-link-button lab-link-button--secondary service-register-visibility-toggle"
                href={buildVisibilityHref(!showTerminal)}
                aria-pressed={showTerminal}
              >
                {showTerminal
                  ? 'ซ่อนรายการปิด PO แล้วและยกเลิก'
                  : `แสดงรายการปิด PO แล้วและยกเลิก (${terminalRequestCount})`}
              </Link>
            )}
          </div>
        </div>

        {requests.length === 0 ? (
          <p className="empty-state">
            {!showTerminal && terminalRequestCount > 0 ? 'ไม่พบใบ PR ที่ยังดำเนินการอยู่' : 'ยังไม่มีใบ PR งานจ้าง'}
          </p>
        ) : (
          <ServicePurchaseRequestTable requests={requests} />
        )}
      </section>
    </div>
  )
}
