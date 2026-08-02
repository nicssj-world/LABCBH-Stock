interface ContractRemainingGaugeProps {
  percent: number | null | undefined
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

export function ContractRemainingGauge({ percent }: ContractRemainingGaugeProps) {
  const state = gaugeState(percent)
  const ariaLabel = state.tone === 'unknown'
    ? 'คงเหลือ: ไม่ระบุ'
    : `คงเหลือ ${state.value} · ${state.health}`

  return (
    <div className={`remaining-gauge remaining-gauge--${state.tone}`} role="img" aria-label={ariaLabel}>
      <div className="remaining-gauge__label">
        <span>คงเหลือ</span>
        <strong>{state.value}</strong>
      </div>
      <div className="remaining-gauge__track" aria-hidden="true">
        <span className="remaining-gauge__fill" style={{ width: `${state.width}%` }} />
      </div>
      <small>{state.health}</small>
    </div>
  )
}
