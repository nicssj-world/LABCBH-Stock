import 'server-only'

import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { SERVICE_PLAN_STATUSES, SERVICE_PLAN_TYPES, SERVICE_PURCHASE_METHODS } from './schema'
import type {
  ServicePlanDocumentRecord,
  ServicePlanLedgerRecord,
  ServicePlanRecord,
  ServicePlanTestItemRecord,
  ServicePurchaseRequestRecord,
  ServiceUsageEventRecord,
} from './types'
import { planBalance } from './domain'

const numeric = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite)
const planRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  name: z.string(),
  department: z.string(),
  plan_type: z.enum(SERVICE_PLAN_TYPES),
  budget: z.union([z.number(), z.string()]),
  is_red_cross: z.boolean().default(false),
  requires_contract: z.boolean().default(false),
  lifecycle_status: z.enum(SERVICE_PLAN_STATUSES).default('active'),
  status: z.enum(SERVICE_PLAN_STATUSES).optional(),
  closed_at: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
})

const requestRowSchema = z.object({
  id: z.string().uuid(),
  fiscal_year: z.number().int(),
  sequence_number: z.number().int(),
  document_number: z.string(),
  requester_id: z.string().uuid().nullable(),
  requester_name: z.string(),
  department: z.string(),
  requested_date: z.string(),
  note: z.string().nullable(),
  plan_id: z.string().uuid(),
  purchase_method: z.enum(SERVICE_PURCHASE_METHODS),
  requested_amount: z.union([z.number(), z.string()]),
  requested_po_month: z.string().nullable().default(null),
  usage_start_date: z.string(),
  usage_end_date: z.string(),
  status: z.enum(['pending', 'confirmed', 'closed', 'cancelled']),
  po_status: z.enum(['not_issued', 'open', 'closed', 'cancelled']),
  ephis_pr_number: z.string().nullable(),
  po_number: z.string().nullable(),
  po_file_name: z.string().nullable(),
  po_file_path: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

function parseRows<T>(schema: z.ZodType<T>, data: unknown, operation: string): T[] {
  const result = schema.array().safeParse(data ?? [])
  if (!result.success) throw new Error(`${operation}มีรูปแบบข้อมูลไม่ถูกต้อง`)
  return result.data
}

function parseOne<T>(schema: z.ZodType<T>, data: unknown, operation: string): T {
  const result = schema.safeParse(data)
  if (!result.success) throw new Error(`${operation}มีรูปแบบข้อมูลไม่ถูกต้อง`)
  return result.data
}

function toNumber(value: unknown): number {
  const parsed = numeric.safeParse(value)
  return parsed.success ? parsed.data : 0
}

type ReadClient = Awaited<ReturnType<typeof createClient>>

async function readPlanSupport(supabase: ReadClient, planIds: string[]) {
  if (!planIds.length) return { responsibles: [], ledger: [], items: [], documents: [] }
  const [responsiblesResult, ledgerResult, itemsResult, documentsResult] = await Promise.all([
    supabase.from('service_plan_responsibles').select('plan_id,profile_id,assigned_at,profiles:profiles!service_plan_responsibles_profile_id_fkey(name,dept)').in('plan_id', planIds),
    supabase.from('service_plan_ledger').select('id,plan_id,entry_kind,amount,event_date,purchase_request_id,usage_event_id,reference_ledger_id,reason,source_reference,created_at,profiles:actor_id(name)').in('plan_id', planIds).order('created_at', { ascending: false }),
    supabase.from('service_plan_test_items').select('id,plan_id,line_number,name,unit,unit_price').in('plan_id', planIds).order('line_number'),
    supabase.from('service_plan_documents').select('id,plan_id,document_kind,file_name,mime_type,size_bytes,storage_key,checksum,uploaded_at').in('plan_id', planIds),
  ])
  for (const result of [responsiblesResult, ledgerResult, itemsResult, documentsResult]) {
    if (result.error) throw new Error(`อ่านข้อมูลสนับสนุนแผนงานจ้างไม่สำเร็จ: ${result.error.message}`)
  }
  return {
    responsibles: responsiblesResult.data ?? [],
    ledger: ledgerResult.data ?? [],
    items: itemsResult.data ?? [],
    documents: documentsResult.data ?? [],
  }
}

function mapLedger(row: Record<string, unknown>, planId: string): ServicePlanLedgerRecord {
  const actor = row.profiles as { name?: string | null } | null
  return {
    id: String(row.id), planId, entryKind: row.entry_kind as ServicePlanLedgerRecord['entryKind'],
    amount: toNumber(row.amount), eventDate: String(row.event_date), purchaseRequestId: (row.purchase_request_id as string | null) ?? null,
    usageEventId: (row.usage_event_id as string | null) ?? null, referenceLedgerId: (row.reference_ledger_id as string | null) ?? null,
    reason: (row.reason as string | null) ?? null, sourceReference: (row.source_reference as string | null) ?? null,
    actorName: actor?.name ?? null, createdAt: String(row.created_at),
  }
}

function mapPlanItem(row: Record<string, unknown>): ServicePlanTestItemRecord {
  return {
    id: String(row.id), lineNumber: Number(row.line_number), name: String(row.name), unit: String(row.unit),
    unitPrice: row.unit_price === null || row.unit_price === undefined ? null : toNumber(row.unit_price),
  }
}

function mapPlanDocument(row: Record<string, unknown>): ServicePlanDocumentRecord {
  return {
    id: String(row.id), kind: row.document_kind as ServicePlanDocumentRecord['kind'], fileName: String(row.file_name),
    mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes), storageKey: String(row.storage_key),
    checksum: (row.checksum as string | null) ?? null, uploadedAt: String(row.uploaded_at),
  }
}

export interface ServicePlanFilters {
  fiscalYear?: number
  department?: string
  type?: (typeof SERVICE_PLAN_TYPES)[number]
  search?: string
}

export async function listServicePlans(filters: ServicePlanFilters = {}): Promise<ServicePlanRecord[]> {
  const supabase = await createClient()
  let query = supabase.from('service_procurement_plans').select('*').order('fiscal_year', { ascending: false }).order('name')
  if (filters.fiscalYear) query = query.eq('fiscal_year', filters.fiscalYear)
  if (filters.department) query = query.eq('department', filters.department)
  if (filters.type) query = query.eq('plan_type', filters.type)
  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) query = query.ilike('name', `%${search}%`)
  const result = await query
  if (result.error) throw new Error(`อ่านแผนงานจ้างไม่สำเร็จ: ${result.error.message}`)
  const rows = parseRows(planRowSchema, result.data, 'แผนงานจ้าง')
  const support = await readPlanSupport(supabase, rows.map((row) => row.id))
  return rows.map((row) => {
    const ledger = support.ledger.filter((entry) => entry.plan_id === row.id)
    const spent = ledger.filter((entry) => ['expense', 'historical_expense', 'expense_adjustment', 'expense_reversal'].includes(entry.entry_kind as string)).reduce((sum, entry) => sum + toNumber(entry.amount), 0)
    const reserved = ledger.filter((entry) => entry.entry_kind === 'reservation' || entry.entry_kind === 'reservation_release').reduce((sum, entry) => sum + toNumber(entry.amount), 0)
    const people = support.responsibles.filter((entry) => entry.plan_id === row.id).map((entry) => {
      const profile = entry.profiles as { name?: string | null; dept?: string | null } | null
      return { profileId: String(entry.profile_id), name: profile?.name ?? 'ไม่ระบุชื่อ', department: profile?.dept ?? null, assignedAt: String(entry.assigned_at) }
    })
    return {
      id: row.id, fiscalYear: row.fiscal_year, name: row.name, department: row.department, type: row.plan_type,
      budget: toNumber(row.budget), balance: planBalance({ budget: toNumber(row.budget), spent, reserved }),
      status: ((row as unknown as { status?: ServicePlanRecord['status'] }).status ?? row.lifecycle_status ?? 'active') as ServicePlanRecord['status'], closedAt: row.closed_at ?? null, isRedCross: row.is_red_cross ?? false, requiresContract: row.requires_contract ?? false,
      testItems: support.items.filter((entry) => entry.plan_id === row.id).map((entry) => mapPlanItem(entry as Record<string, unknown>)),
      documents: support.documents.filter((entry) => entry.plan_id === row.id).map((entry) => mapPlanDocument(entry as Record<string, unknown>)),
      responsibles: people, createdAt: row.created_at, updatedAt: row.updated_at,
    }
  })
}

export async function getServicePlan(planId: string): Promise<{ plan: ServicePlanRecord; ledger: ServicePlanLedgerRecord[]; requests: ServicePurchaseRequestRecord[] } | null> {
  const plans = await listServicePlans()
  const plan = plans.find((row) => row.id === planId)
  if (!plan) return null
  const supabase = await createClient()
  const result = await supabase.from('service_plan_ledger').select('id,plan_id,entry_kind,amount,event_date,purchase_request_id,usage_event_id,reference_ledger_id,reason,source_reference,created_at,profiles:actor_id(name)').eq('plan_id', planId).order('event_date', { ascending: false }).order('created_at', { ascending: false })
  if (result.error) throw new Error(`อ่านประวัติแผนงานจ้างไม่สำเร็จ: ${result.error.message}`)
  const requests = await listServicePurchaseRequests({ planId })
  return { plan, ledger: (result.data ?? []).map((row) => mapLedger(row as Record<string, unknown>, planId)), requests }
}

async function readRequestSupport(supabase: ReadClient, requestIds: string[], planIds: string[]) {
  if (!requestIds.length) return { items: [], events: [], attachments: [], committees: [], poEvents: [], documents: [] }
  const [items, events, expenses, attachments, committees, poEvents, documents] = await Promise.all([
    supabase.from('service_purchase_request_items').select('*').in('purchase_request_id', requestIds).order('line_number'),
    supabase.from('service_purchase_request_usage_events').select('id,purchase_request_id,event_kind,expense_date,amount,note,created_at,profiles:actor_id(name)').in('purchase_request_id', requestIds).order('expense_date', { ascending: false }),
    supabase.from('service_purchase_request_expenses').select('id,purchase_request_id,expense_date,amount,invoice_number,note,status,created_at,profiles:created_by(name)').in('purchase_request_id', requestIds).order('expense_date', { ascending: false }),
    supabase.from('service_purchase_request_attachments').select('id,purchase_request_id,attachment_kind,slot,file_name,mime_type,size_bytes,storage_key,uploaded_at').in('purchase_request_id', requestIds).order('slot'),
    supabase.from('service_purchase_request_committees').select('id,purchase_request_id,committee_kind,seat,profile_id,name_snapshot,position_snapshot').in('purchase_request_id', requestIds).order('committee_kind').order('seat'),
    supabase.from('service_purchase_request_po_events').select('id,purchase_request_id,event_kind,po_number,po_file_path,reason,created_at,profiles:actor_id(name)').in('purchase_request_id', requestIds).order('created_at', { ascending: false }),
    planIds.length ? supabase.from('service_plan_documents').select('id,plan_id,document_kind,file_name,mime_type,size_bytes,storage_key,checksum,uploaded_at').in('plan_id', planIds) : Promise.resolve({ data: [], error: null }),
  ])
  for (const result of [items, events, expenses, attachments, committees, poEvents, documents]) if (result.error) throw new Error(`อ่านรายละเอียดใบ PR งานจ้างไม่สำเร็จ: ${result.error.message}`)
  return { items: items.data ?? [], events: events.data ?? [], expenses: expenses.data ?? [], attachments: attachments.data ?? [], committees: committees.data ?? [], poEvents: poEvents.data ?? [], documents: documents.data ?? [] }
}

type ServiceRequestSupport = Awaited<ReturnType<typeof readRequestSupport>> & { snapshots?: Array<Record<string, unknown>> }

function mapRequest(row: z.infer<typeof requestRowSchema>, support: ServiceRequestSupport, planMap: Map<string, { name: string; isRedCross: boolean; requiresContract: boolean }>): ServicePurchaseRequestRecord {
  const plan = planMap.get(row.plan_id)
  const legacyItems = support.items.filter((entry) => entry.purchase_request_id === row.id).map((entry) => ({
    id: String(entry.id), lineNumber: Number(entry.line_number), planItemId: (entry.plan_item_id as string | null) ?? '', inventoryItemId: (entry.inventory_item_id as string | null) ?? null,
    lsCode: (entry.ls_code as string | null) ?? null, name: String(entry.name), unit: String(entry.unit), requestedQuantity: toNumber(entry.requested_quantity),
    unitPrice: toNumber(entry.unit_price), lineTotal: toNumber(entry.line_total), usedQuantity: toNumber(entry.used_quantity), remainingQuantity: Math.max(0, toNumber(entry.requested_quantity) - toNumber(entry.used_quantity)),
  }))
  const snapshotItems = (support.snapshots ?? []).filter((entry) => entry.purchase_request_id === row.id).map((entry) => ({
    id: String(entry.id), lineNumber: Number(entry.line_number), planItemId: (entry.plan_item_id as string | null) ?? '', inventoryItemId: null,
    lsCode: null, name: String(entry.name), unit: String(entry.unit), requestedQuantity: toNumber(entry.requested_quantity),
    unitPrice: entry.unit_price === null || entry.unit_price === undefined ? null : toNumber(entry.unit_price),
    lineTotal: entry.unit_price === null || entry.unit_price === undefined
      ? null
      : Math.round(toNumber(entry.requested_quantity) * toNumber(entry.unit_price) * 100) / 100,
    usedQuantity: 0, remainingQuantity: toNumber(entry.requested_quantity),
  }))
  const items = snapshotItems.length > 0 ? snapshotItems : legacyItems
  const oldEvents: ServiceUsageEventRecord[] = support.events.filter((entry) => entry.purchase_request_id === row.id).map((entry) => ({
    id: String(entry.id), kind: entry.event_kind as ServiceUsageEventRecord['kind'], expenseDate: String(entry.expense_date), amount: toNumber(entry.amount), invoiceNumber: null,
    note: (entry.note as string | null) ?? null, status: 'active', referenceEventId: null, actorName: (entry.profiles as { name?: string | null } | null)?.name ?? null, createdAt: String(entry.created_at),
  }))
  const expenseEvents: ServiceUsageEventRecord[] = (support.expenses ?? []).filter((entry) => entry.purchase_request_id === row.id).map((entry) => ({
    id: String(entry.id), kind: 'lab_expense', expenseDate: String(entry.expense_date), amount: toNumber(entry.amount), invoiceNumber: (entry.invoice_number as string | null) ?? null,
    note: (entry.note as string | null) ?? null, status: (entry.status as 'active' | 'cancelled') ?? 'active', referenceEventId: null,
    actorName: (entry.profiles as { name?: string | null } | null)?.name ?? null, createdAt: String(entry.created_at),
  }))
  const events = [...expenseEvents, ...oldEvents]
  const actualAmount = events.filter((entry) => entry.status === 'active' && ['annual_usage', 'lab_expense', 'expense_adjustment', 'expense_reversal'].includes(entry.kind)).reduce((sum, entry) => sum + entry.amount, 0)
  const usedQuantity = items.reduce((sum, entry) => sum + entry.usedQuantity, 0)
  const requestedQuantity = items.reduce((sum, entry) => sum + entry.requestedQuantity, 0)
  const fulfillment = items.length === 0 ? (expenseEvents.some((entry) => entry.status === 'active') ? 'complete' : 'not_started') : usedQuantity <= 0 ? 'not_started' : usedQuantity >= requestedQuantity ? 'complete' : 'partial'
  return {
    id: row.id, fiscalYear: row.fiscal_year, sequenceNumber: row.sequence_number, documentNumber: row.document_number, requesterId: row.requester_id,
    requesterName: row.requester_name, department: row.department, requestedDate: row.requested_date, note: row.note, planId: row.plan_id,
    planName: plan?.name ?? null, purchaseMethod: row.purchase_method, requestedAmount: toNumber(row.requested_amount), usageStartDate: row.usage_start_date, usageEndDate: row.usage_end_date,
    requestedPoMonth: row.requested_po_month ?? null, status: row.status, poStatus: row.po_status, ephisPrNumber: row.ephis_pr_number, poNumber: row.po_number,
    poFileName: row.po_file_name, poFilePath: row.po_file_path, fulfillment, actualAmount, expenseFrequency: plan?.isRedCross ? 'daily' : 'monthly', isRedCross: plan?.isRedCross ?? false, requiresContract: plan?.requiresContract ?? false,
    items, usageEvents: events, attachments: support.attachments.filter((entry) => entry.purchase_request_id === row.id).map((entry) => ({ id: String(entry.id), kind: entry.attachment_kind, slot: Number(entry.slot), fileName: String(entry.file_name), mimeType: String(entry.mime_type), sizeBytes: Number(entry.size_bytes), storageKey: String(entry.storage_key), uploadedAt: String(entry.uploaded_at) })),
    planDocuments: support.documents.filter((entry) => entry.plan_id === row.plan_id).map((entry) => mapPlanDocument(entry as Record<string, unknown>)),
    committees: support.committees.filter((entry) => entry.purchase_request_id === row.id).map((entry) => ({ id: String(entry.id), kind: entry.committee_kind, seat: Number(entry.seat), profileId: String(entry.profile_id), name: String(entry.name_snapshot), position: (entry.position_snapshot as string | null) ?? null })),
    poEvents: support.poEvents.filter((entry) => entry.purchase_request_id === row.id).map((entry) => ({ id: String(entry.id), kind: entry.event_kind as ServicePurchaseRequestRecord['poEvents'][number]['kind'], poNumber: (entry.po_number as string | null) ?? null, poFilePath: (entry.po_file_path as string | null) ?? null, reason: (entry.reason as string | null) ?? null, actorName: (entry.profiles as { name?: string | null } | null)?.name ?? null, createdAt: String(entry.created_at) })),
    createdAt: row.created_at, updatedAt: row.updated_at,
  }
}

export interface ServiceRequestFilters { fiscalYear?: number; department?: string; status?: string; search?: string; planId?: string }

async function readRequestTestItemSnapshots(supabase: ReadClient, requestIds: string[]) {
  if (!requestIds.length) return [] as Array<Record<string, unknown>>
  const result = await supabase
    .from('service_purchase_request_test_item_snapshots')
    .select('id,purchase_request_id,plan_item_id,line_number,name,unit,unit_price,requested_quantity,created_at')
    .in('purchase_request_id', requestIds)
    .order('line_number')
  if (result.error) throw new Error(`à¸­à¹ˆà¸²à¸™ snapshot à¸£à¸²à¸¢à¸à¸²à¸£à¸ªà¹ˆà¸‡à¸•à¸£à¸§à¸ˆ PR à¹„à¸¡à¹ˆà¸ªà¸³à¹€à¸£à¹‡à¸ˆ: ${result.error.message}`)
  return (result.data ?? []) as Array<Record<string, unknown>>
}

export async function listServicePurchaseRequests(filters: ServiceRequestFilters = {}): Promise<ServicePurchaseRequestRecord[]> {
  const supabase = await createClient()
  // The forward migration keeps historical unlinked Out Lab rows readable in
  // the database, but the new service register only exposes plan-backed PRs.
  let query = supabase.from('service_purchase_requests').select('*').not('plan_id', 'is', null).order('requested_date', { ascending: false }).order('created_at', { ascending: false })
  if (filters.fiscalYear) query = query.eq('fiscal_year', filters.fiscalYear)
  if (filters.department) query = query.eq('department', filters.department)
  if (filters.status && ['pending', 'confirmed', 'closed', 'cancelled'].includes(filters.status)) query = query.eq('status', filters.status)
  if (filters.planId) query = query.eq('plan_id', filters.planId)
  const search = filters.search?.trim().replace(/[,%()]/g, ' ')
  if (search) query = query.or(`document_number.ilike.%${search}%,requester_name.ilike.%${search}%,department.ilike.%${search}%`)
  const result = await query
  if (result.error) throw new Error(`อ่านใบ PR งานจ้างไม่สำเร็จ: ${result.error.message}`)
  const rows = parseRows(requestRowSchema, result.data, 'ใบ PR งานจ้าง')
  const planIds = [...new Set(rows.map((row) => row.plan_id))]
  const planRows = planIds.length ? await supabase.from('service_procurement_plans').select('id,name,is_red_cross,requires_contract').in('id', planIds) : { data: [], error: null }
  if (planRows.error) throw new Error(`อ่านชื่อแผนงานจ้างไม่สำเร็จ: ${planRows.error.message}`)
  const planMap = new Map((planRows.data ?? []).map((row) => [String(row.id), { name: String(row.name), isRedCross: Boolean(row.is_red_cross), requiresContract: Boolean(row.requires_contract) }]))
  const support = await readRequestSupport(supabase, rows.map((row) => row.id), planIds)
  const supportWithSnapshots = { ...support, snapshots: await readRequestTestItemSnapshots(supabase, rows.map((row) => row.id)) }
  return rows.map((row) => mapRequest({ ...row, requested_po_month: row.requested_po_month ?? null }, supportWithSnapshots, planMap))
}

export async function getServicePurchaseRequest(requestId: string): Promise<ServicePurchaseRequestRecord | null> {
  const supabase = await createClient()
  const result = await supabase.from('service_purchase_requests').select('*').eq('id', requestId).not('plan_id', 'is', null).maybeSingle()
  if (result.error) throw new Error(`อ่านใบ PR งานจ้างไม่สำเร็จ: ${result.error.message}`)
  if (!result.data) return null
  const row = parseOne(requestRowSchema, result.data, 'ใบ PR งานจ้าง')
  const plan = await supabase.from('service_procurement_plans').select('id,name,is_red_cross,requires_contract').eq('id', row.plan_id).maybeSingle()
  if (plan.error) throw new Error(`อ่านแผนที่อ้างอิงไม่สำเร็จ: ${plan.error.message}`)
  const support = await readRequestSupport(supabase, [requestId], [row.plan_id])
  const supportWithSnapshots = { ...support, snapshots: await readRequestTestItemSnapshots(supabase, [requestId]) }
  const planMap = new Map<string, { name: string; isRedCross: boolean; requiresContract: boolean }>()
  if (plan.data) planMap.set(String(plan.data.id), { name: String(plan.data.name), isRedCross: Boolean(plan.data.is_red_cross), requiresContract: Boolean(plan.data.requires_contract) })
  return mapRequest({ ...row, requested_po_month: row.requested_po_month ?? null }, supportWithSnapshots, planMap)
}

/** Kept as a compatibility export; the new service PR form does not use inventory catalog items. */
export async function listServiceCatalogItems() {
  return [] as Array<{ inventoryItemId: string; lsCode: string; name: string; unit: string; unitPrice: number }>
}

export async function listServiceCommitteeCandidates() {
  const result = await supabaseAdmin
    .from('profiles')
    .select('id,name,name_prefix,ephis_id,position_title')
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('name', 'is', null)
    .order('name')
  if (result.error) throw new Error(`อ่านรายชื่อกรรมการงานจ้างไม่สำเร็จ: ${result.error.message}`)
  return (result.data ?? []).map((row) => ({
    id: String(row.id), name: String(row.name ?? row.ephis_id ?? row.id), namePrefix: row.name_prefix ? String(row.name_prefix) : null,
    ephisId: row.ephis_id ? String(row.ephis_id) : null, positionTitle: row.position_title ? String(row.position_title) : null,
  }))
}
