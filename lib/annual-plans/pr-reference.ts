import { z } from 'zod'
import { normalizeLsCode } from '@/lib/inventory/ls-code'
import { ANNUAL_PLAN_TYPES, type AnnualPlanType } from './schema'

export const ANNUAL_PLAN_MATCH_METHODS = ['name_exact', 'code_exact', 'manual_confirmed'] as const
export type AnnualPlanMatchMethod = (typeof ANNUAL_PLAN_MATCH_METHODS)[number]

export const annualPlanMatchMethodSchema = z.enum(ANNUAL_PLAN_MATCH_METHODS)

export const annualPlanReferenceLineSchema = z
  .object({
    lineNumber: z.number().int().positive(),
    planRowId: z.string().uuid(),
    matchMethod: annualPlanMatchMethodSchema,
  })
  .strict()

export const annualPlanContractReferenceSchema = z
  .object({
    contractName: z.string().trim().min(1).max(240),
    line: annualPlanReferenceLineSchema,
  })
  .strict()

export const annualPlanReferenceSchema = z
  .object({
    planVersionId: z.string().uuid(),
    planFiscalYear: z.number().int().min(2500).max(3000),
    planType: z.enum(ANNUAL_PLAN_TYPES),
    lines: z.array(annualPlanReferenceLineSchema),
    contract: annualPlanContractReferenceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.planType === 'hiring') {
      if (value.lines.length > 0 || !value.contract) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contract'],
          message: 'แผนจัดจ้างต้องอ้างอิงจากชื่อสัญญา',
        })
      }
      if (value.contract?.line.matchMethod === 'code_exact') {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contract', 'line', 'matchMethod'],
          message: 'แผนจัดจ้างต้องจับคู่ด้วยชื่อสัญญาเท่านั้น',
        })
      }
      return
    }
    if (value.lines.length < 1 || value.contract) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['lines'],
        message: 'แผนจัดซื้อต้องอ้างอิงรายการ PR รายบรรทัด',
      })
    }
  })

export type AnnualPlanReference = z.infer<typeof annualPlanReferenceSchema>
export type AnnualPlanReferenceLine = AnnualPlanReference['lines'][number]
export type AnnualPlanContractReference = z.infer<typeof annualPlanContractReferenceSchema>

/**
 * The plan PDF is indexed once on the server. These bounds are PDF points in
 * the original page coordinate system so the same row can be highlighted
 * without asking the requester to upload a cropped page.
 */
export interface AnnualPlanRow {
  id: string
  lineNumber: number
  planSequence: string
  itemName: string
  lsCode: string | null
  rawText: string
  pageNumber: number
  pageWidth: number
  pageHeight: number
  x: number
  y: number
  width: number
  height: number
}

export interface AnnualPlanForPurchaseRequest {
  planType: AnnualPlanType
  currentFiscalYear: number
  status: 'ready' | 'missing' | 'unavailable'
  planVersionId: string | null
  fiscalYear: number
  fileName: string | null
  uploadedAt: string | null
  rows: AnnualPlanRow[]
  message: string | null
}

export interface GeneratedAnnualPlanEvidence {
  uploadId: string
  fileName: string
  planVersionId: string
  planFiscalYear: number
}

export function normalizePlanText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('th')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function nameMatches(row: AnnualPlanRow, name: string) {
  const needle = normalizePlanText(name)
  if (!needle) return false
  const rowText = normalizePlanText(`${row.itemName} ${row.rawText}`)
  return rowText.includes(needle) || needle.includes(normalizePlanText(row.itemName))
}

function codeMatches(row: AnnualPlanRow, lsCode: string) {
  const needle = normalizeLsCode(lsCode)
  return Boolean(needle && row.lsCode && normalizeLsCode(row.lsCode) === needle)
}

function codeConflicts(row: AnnualPlanRow, lsCode: string) {
  const needle = normalizeLsCode(lsCode)
  return Boolean(
    needle &&
    row.lsCode &&
    normalizeLsCode(row.lsCode) &&
    normalizeLsCode(row.lsCode) !== needle,
  )
}

export interface AnnualPlanMatchResult {
  selected: AnnualPlanRow | null
  candidates: AnnualPlanRow[]
  matchMethod: Extract<AnnualPlanMatchMethod, 'name_exact' | 'code_exact'> | null
}

/**
 * Matching deliberately gives the human-readable name priority. LS is a
 * confirmation/fallback because old plans often contain the name before a
 * catalogue code was assigned.
 */
export function matchAnnualPlanLine(
  name: string,
  lsCode: string,
  rows: readonly AnnualPlanRow[],
): AnnualPlanMatchResult {
  const byName = rows.filter((row) => nameMatches(row, name))
  const byCode = rows.filter((row) => codeMatches(row, lsCode))
  if (byName.length === 1 && !codeConflicts(byName[0], lsCode)) {
    return { selected: byName[0], candidates: byName, matchMethod: 'name_exact' }
  }
  if (byCode.length === 1) return { selected: byCode[0], candidates: byCode, matchMethod: 'code_exact' }

  const candidates = byName.length > 0
    ? [...new Map([...byName, ...byCode].map((row) => [row.id, row])).values()]
    : byCode.length > 1 ? byCode : []
  return { selected: null, candidates, matchMethod: null }
}

/** Hiring plans do not carry an LS/material code, so contract name is the
 * only useful key for their equipment-lease reference. */
export function matchAnnualPlanContractName(
  contractName: string,
  rows: readonly AnnualPlanRow[],
): AnnualPlanMatchResult {
  const needle = normalizePlanText(contractName)
  if (!needle) return { selected: null, candidates: [], matchMethod: null }
  const candidates = rows.filter((row) => nameMatches(row, contractName))
  if (candidates.length === 1) {
    return { selected: candidates[0], candidates, matchMethod: 'name_exact' }
  }
  return { selected: null, candidates, matchMethod: null }
}

export function annualPlanReferenceFingerprint(
  planVersionId: string | null,
  lines: readonly { name: string; lsCode: string; reference?: AnnualPlanReferenceLine }[],
  contract?: { name: string; reference?: AnnualPlanReferenceLine },
) {
  return JSON.stringify({
    planVersionId,
    lines: lines.map((line) => ({
      name: normalizePlanText(line.name),
      lsCode: normalizeLsCode(line.lsCode),
      row: line.reference?.planRowId ?? null,
      line: line.reference?.lineNumber ?? null,
      method: line.reference?.matchMethod ?? null,
    })),
    contract: contract
      ? {
          name: normalizePlanText(contract.name),
          row: contract.reference?.planRowId ?? null,
          line: contract.reference?.lineNumber ?? null,
          method: contract.reference?.matchMethod ?? null,
        }
      : null,
  })
}
