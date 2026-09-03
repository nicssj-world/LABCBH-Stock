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

export type AnnualPlanEvidenceActionError = {
  ok: false
  message: string
}

export type AnnualPlanEvidenceActionResult =
  | (GeneratedAnnualPlanEvidence & { ok: true })
  | AnnualPlanEvidenceActionError

export function isAnnualPlanEvidenceActionError(value: unknown): value is AnnualPlanEvidenceActionError {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return candidate.ok === false && typeof candidate.message === 'string'
}

export function normalizePlanText(value: string) {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('th')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    // NFKC decomposes Thai sara am (ำ) into sara aa + nikhahit. Some PDF OCR
    // output drops the nikhahit, so remove that mark in comparisons only.
    .replace(/\u0e4d/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * OCR in the uploaded plan can insert spaces around Thai marks and punctuation
 * (for example, "น ้ายา"). Keep the display text unchanged, but compare a
 * compact form so those layout artefacts do not turn a valid match into a
 * server error.
 */
function compactPlanText(value: string) {
  return normalizePlanText(value).replace(/[\s\p{P}\p{S}]+/gu, '')
}

function planTextContains(expected: string, candidate: string) {
  const expectedText = compactPlanText(expected)
  const candidateText = compactPlanText(candidate)
  if (!expectedText || !candidateText) return false
  return candidateText.includes(expectedText) || expectedText.includes(candidateText)
}

function withoutTrailingPlanAmount(value: string) {
  return value.replace(/[\s(]*[0-9๐-๙][0-9๐-๙,\s]*(?:\.[0-9๐-๙]{1,2})?[\s)]*$/u, '').trim()
}

function editDistance(left: string, right: string) {
  const leftChars = [...left]
  const rightChars = [...right]
  if (leftChars.length > rightChars.length) return editDistance(right, left)

  let previous = Array.from({ length: leftChars.length + 1 }, (_, index) => index)
  for (let rightIndex = 1; rightIndex <= rightChars.length; rightIndex += 1) {
    const current = [rightIndex]
    for (let leftIndex = 1; leftIndex <= leftChars.length; leftIndex += 1) {
      current[leftIndex] = Math.min(
        current[leftIndex - 1] + 1,
        previous[leftIndex] + 1,
        previous[leftIndex - 1] + (leftChars[leftIndex - 1] === rightChars[rightIndex - 1] ? 0 : 1),
      )
    }
    previous = current
  }
  return previous[leftChars.length]
}

/**
 * This helper is used by automatic/server-side text checks when the source PDF
 * contains OCR/layout artefacts. A manually confirmed row is handled as an
 * explicit human choice by the reference validators and does not call this
 * helper as a veto.
 */
export function annualPlanTextIsRelated(
  expectedName: string,
  row: Pick<AnnualPlanRow, 'itemName' | 'rawText'>,
) {
  const expectedVariants = [expectedName, withoutTrailingPlanAmount(expectedName)]
  const rowVariants = [
    row.itemName,
    row.rawText,
    withoutTrailingPlanAmount(row.itemName),
    withoutTrailingPlanAmount(row.rawText),
  ]

  if (expectedVariants.some((expected) => rowVariants.some((candidate) => planTextContains(expected, candidate)))) {
    return true
  }

  const expectedTexts = expectedVariants.map(compactPlanText).filter(Boolean)
  const rowTexts = rowVariants.map(compactPlanText).filter(Boolean)
  return expectedTexts.some((expected) => rowTexts.some((candidate) => {
    const shorterLength = Math.min([...expected].length, [...candidate].length)
    if (shorterLength < 12) return false
    const allowedDistance = Math.max(2, Math.ceil(shorterLength * 0.2))
    return editDistance(expected, candidate) <= allowedDistance
  }))
}

function nameMatches(row: AnnualPlanRow, name: string) {
  return planTextContains(name, row.itemName) || planTextContains(name, row.rawText)
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
