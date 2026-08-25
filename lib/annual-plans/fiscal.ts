const BANGKOK_TIME_ZONE = 'Asia/Bangkok'

function datePart(date: Date, type: 'year' | 'month') {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new Error('Invalid date')
  }

  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: BANGKOK_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  })
    .formatToParts(date)
    .find(({ type: partType }) => partType === type)

  if (!part) throw new Error(`Missing ${type} date part`)
  return Number(part.value)
}

/** Returns the Thai fiscal year for an instant, using the Bangkok calendar. */
export function fiscalYearOfDate(date: Date) {
  const year = datePart(date, 'year')
  const month = datePart(date, 'month')
  return year + (month >= 10 ? 544 : 543)
}

export function retainedFiscalYears(asOf = new Date()) {
  const current = fiscalYearOfDate(asOf)
  return [current, current - 1] as const
}

export function isRetainedFiscalYear(fiscalYear: number, asOf = new Date()) {
  const [current, previous] = retainedFiscalYears(asOf)
  return fiscalYear === current || fiscalYear === previous
}

export function fiscalYearBounds(fiscalYear: number) {
  const calendarStartYear = fiscalYear - 544
  return {
    startDate: `${calendarStartYear}-10-01`,
    endDate: `${calendarStartYear + 1}-09-30`,
  }
}
