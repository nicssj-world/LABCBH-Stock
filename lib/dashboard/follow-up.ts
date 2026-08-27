export const EXECUTIVE_FOLLOW_UP_CATEGORIES = [
  {
    value: 'all',
    label: 'ทุกประเด็น',
  },
  {
    value: 'receiving-data-quality',
    label: 'รับเข้าต้องตรวจสอบ',
  },
  {
    value: 'lease-usage-data-quality',
    label: 'ค่าเช่าไม่มีเดือนอ้างอิง',
  },
  {
    value: 'lease-contract-metadata',
    label: 'ข้อมูลสัญญาเช่าไม่ครบ',
  },
  {
    value: 'lease-risk',
    label: 'สัญญาเช่าที่ต้องติดตาม',
  },
  {
    value: 'pending-contracts',
    label: 'สัญญาอยู่ระหว่างดำเนินการ',
  },
] as const

export type ExecutiveFollowUpCategory = (typeof EXECUTIVE_FOLLOW_UP_CATEGORIES)[number]['value']

const categoryValues = new Set<string>(EXECUTIVE_FOLLOW_UP_CATEGORIES.map((category) => category.value))

export function isExecutiveFollowUpCategory(value: string | undefined): value is ExecutiveFollowUpCategory {
  return value !== undefined && categoryValues.has(value)
}

export function executiveFollowUpHref(
  fiscalYear: number,
  category: ExecutiveFollowUpCategory = 'all',
): string {
  const params = new URLSearchParams({ fiscalYear: String(fiscalYear) })
  if (category !== 'all') params.set('category', category)
  return `/dashboard/follow-up?${params.toString()}`
}
