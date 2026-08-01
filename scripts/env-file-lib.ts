export function parseEnvFile(source: string): Record<string, string> {
  const parsed: Record<string, string> = {}

  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue

    const [, name, rawValue] = match
    let value = rawValue.trim()
    const quote = value[0]
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1)
    }
    parsed[name] = value
  }

  return parsed
}
