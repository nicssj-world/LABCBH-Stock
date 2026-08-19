const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function ViewIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.75" />
    </svg>
  )
}

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

export function PriceTagIcon() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M11.5 3.5H5.5A2 2 0 0 0 3.5 5.5v6l9 9a2 2 0 0 0 2.8 0l6.2-6.2a2 2 0 0 0 0-2.8l-9-9Z" />
      <path d="M8.5 8.5h.01" />
    </svg>
  )
}

export function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="m14.5 5.5 4 4" />
      <path d="m4 20 3.7-.8L19.6 7.3a2.1 2.1 0 0 0-3-3L4.7 16.2 4 20Z" />
      <path d="M13 7 17 11" />
    </svg>
  )
}

export function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...STROKE}>
      <path d="M12 3v9" />
      <path d="M6.1 5.8a8 8 0 1 0 11.8 0" />
    </svg>
  )
}
