const THAI_ERA_OFFSET = 543

const thaiMonths = [
  'มกราคม',
  'กุมภาพันธ์',
  'มีนาคม',
  'เมษายน',
  'พฤษภาคม',
  'มิถุนายน',
  'กรกฎาคม',
  'สิงหาคม',
  'กันยายน',
  'ตุลาคม',
  'พฤศจิกายน',
  'ธันวาคม',
]

/**
 * Printed hospital documents carry the full Buddhist-era date. `Intl` would
 * abbreviate depending on the runtime's ICU build, so the form is spelled out.
 */
export function toThaiPrintDate(isoDate: string | null): string {
  if (!isoDate) return '—'
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return '—'
  return `${day} ${thaiMonths[month - 1]} ${year + THAI_ERA_OFFSET}`
}

export function formatDocumentDate(isoDate: string | null): string {
  return toThaiPrintDate(isoDate)
}

/** Printed identity blocks for the stock issuer and receiving head. */
export const SIGNATURE_BLOCKS = [
  { role: 'ผู้จ่ายของ', hint: 'เจ้าหน้าที่คลัง' },
  { role: 'หัวหน้าหน่วยงานผู้รับ', hint: 'ผู้รับของ' },
] as const
