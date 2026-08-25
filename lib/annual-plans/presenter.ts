import type { AnnualPlanType } from './schema'

const ANNUAL_PLAN_TYPE_LABELS: Record<AnnualPlanType, string> = {
  procurement: 'แผนจัดซื้อ',
  hiring: 'แผนจัดจ้าง',
}

export function annualPlanTypeLabel(planType: AnnualPlanType) {
  return ANNUAL_PLAN_TYPE_LABELS[planType]
}

export function fiscalYearLabel(fiscalYear: number) {
  return `ปีงบประมาณ ${fiscalYear}`
}
