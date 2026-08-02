const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function StockBoxIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M3.5 8 12 4l8.5 4-8.5 4-8.5-4Z" />
      <path d="M3.5 8v8L12 20l8.5-4V8" />
      <path d="M12 12v8" />
    </svg>
  )
}

export function ThresholdIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M4 15h16" />
      <path d="M8 15V7M12 15V5M16 15v6" />
      <path d="M4 20h16" />
    </svg>
  )
}

export function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M12 3.5 3.5 8 12 12.5 20.5 8Z" />
      <path d="m3.5 12 8.5 4.5L20.5 12" />
      <path d="m3.5 16 8.5 4.5L20.5 16" />
    </svg>
  )
}

export function TrendIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M4 16 9.5 10l4 4L20 6" />
      <path d="M14.5 6H20v5.5" />
    </svg>
  )
}
