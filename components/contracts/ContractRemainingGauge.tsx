interface ContractRemainingGaugeProps {
  percent: number | null | undefined
  compact?: boolean
}

const percentFormatter = new Intl.NumberFormat('th-TH', {
  maximumFractionDigits: 1,
})

function gaugeState(percent: number | null | undefined) {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) {
    return { tone: 'unknown' as const, width: 0, value: 'ไม่ระบุ', health: 'ไม่มีข้อมูลยอดคงเหลือ' }
  }

  const width = Math.min(100, Math.max(0, percent))
  if (width <= 0) return { tone: 'danger' as const, width, value: '0%', health: 'หมดแล้ว' }
  if (width < 30) {
    return {
      tone: 'danger' as const,
      width,
      value: `${percentFormatter.format(width)}%`,
      health: 'เหลือน้อยกว่า 30%',
    }
  }

  return {
    tone: 'ok' as const,
    width,
    value: `${percentFormatter.format(width)}%`,
    health: 'มีคงเหลือเพียงพอ',
  }
}

export function ContractRemainingGauge({ percent, compact = false }: ContractRemainingGaugeProps) {
  const state = gaugeState(percent)
  const ariaLabel = state.tone === 'unknown'
    ? 'คงเหลือ: ไม่ระบุ'
    : `คงเหลือ ${state.value} · ${state.health}`

  return (
    <div
      className={`remaining-gauge remaining-gauge--${state.tone}${compact ? ' remaining-gauge--compact' : ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={state.tone === 'unknown' ? undefined : state.width}
      aria-label={ariaLabel}
    >
      <div className="remaining-gauge__label">
        <span className={compact ? 'visually-hidden' : undefined}>คงเหลือ</span>
        <strong>{state.value}</strong>
      </div>
      <div className="remaining-gauge__track" aria-hidden="true">
        <span className="remaining-gauge__fill" style={{ width: `${state.width}%` }} />
      </div>
      <small className={compact ? 'visually-hidden' : undefined}>{state.health}</small>
    </div>
  )
}
