import type { AnnualPlanType } from './schema'
import { ANNUAL_PLAN_TYPES } from './schema'

export const ANNUAL_PLAN_BUCKET = 'lab-stock-annual-plans'
export const ANNUAL_PLAN_MIME_TYPE = 'application/pdf'
export const MAX_ANNUAL_PLAN_FILE_SIZE_BYTES = 25 * 1024 * 1024

type AnnualPlanFilePathInput = {
  fiscalYear: number
  planType: AnnualPlanType
  fileName: string
  id: string
}

function safeSegment(value: string) {
  return value
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.\./g, '-')
    .replace(/[^a-zA-Z0-9ก-๙._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'document'
}

export function annualPlanFilePath({ fiscalYear, planType, fileName, id }: AnnualPlanFilePathInput) {
  const safeId = safeSegment(id)
  const safeName = safeSegment(fileName).toLowerCase().endsWith('.pdf') ? safeSegment(fileName) : `${safeSegment(fileName)}.pdf`
  return `annual-plans/${fiscalYear}/${planType}/${safeId}-${safeName}`
}

export function isAnnualPlanFilePathAllowed(path: string) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'annual-plans') return false
  if (!/^\d{4}$/.test(segments[1])) return false
  if (!ANNUAL_PLAN_TYPES.includes(segments[2] as AnnualPlanType)) return false
  if (!segments[3] || !/\.pdf$/i.test(segments[3])) return false
  return segments.every((segment) => segment !== '.' && segment !== '..' && !segment.includes('..'))
}

export async function validateAnnualPlanFile(file: File) {
  if (!file || file.size <= 0) throw new Error('กรุณาเลือกไฟล์ PDF ที่ไม่ว่าง')
  if (file.size > MAX_ANNUAL_PLAN_FILE_SIZE_BYTES) {
    throw new Error('ไฟล์แผนประจำปีต้องมีขนาดไม่เกิน 25 MB')
  }
  if (file.type && file.type !== ANNUAL_PLAN_MIME_TYPE) {
    throw new Error('รองรับเฉพาะไฟล์ PDF เท่านั้น')
  }
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('รองรับเฉพาะไฟล์ PDF เท่านั้น')
  }

  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer())
  const isPdf = header.length === 4 && header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46
  if (!isPdf) throw new Error('ไฟล์ที่เลือกไม่ใช่ PDF ที่ถูกต้อง')
}
