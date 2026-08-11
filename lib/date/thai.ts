export const BUDDHIST_ERA_OFFSET = 543

export const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

export const THAI_WEEKDAYS_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const

/** Returns a calendar date in the application's business timezone. */
export function bangkokIsoDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

const ISO_DATE_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})$/
const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙'

function normalizeDigits(value: string): string {
  return [...value]
    .map((character) => {
      const index = THAI_DIGITS.indexOf(character)
      return index >= 0 ? String(index) : character
    })
    .join('')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function isoFromParts(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    year > 2200 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null

  return `${year}-${pad(month)}-${pad(day)}`
}

/** Converts an ISO date to the text shown in date fields: DD/MM/YYYY (พ.ศ.). */
export function formatThaiDateInput(isoDate: string | null | undefined): string {
  if (!isoDate) return ''
  const match = isoDate.slice(0, 10).match(ISO_DATE_PATTERN)
  if (!match) return ''

  const [, year, month, day] = match
  return `${pad(Number(day))}/${pad(Number(month))}/${Number(year) + BUDDHIST_ERA_OFFSET}`
}

/** Parses DD/MM/YYYY (พ.ศ.) while also accepting an ISO date pasted by users. */
export function parseThaiDateInput(value: string): string | null {
  const normalized = normalizeDigits(value.trim())
  if (!normalized) return ''

  const isoMatch = normalized.match(ISO_DATE_PATTERN)
  if (isoMatch) {
    return isoFromParts(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]))
  }

  const parts = normalized.split(/[/.\-\s]+/).filter(Boolean)
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) return null

  const [day, month, enteredYear] = parts.map(Number)
  const gregorianYear = enteredYear >= 2400 ? enteredYear - BUDDHIST_ERA_OFFSET : enteredYear
  return isoFromParts(gregorianYear, month, day)
}
