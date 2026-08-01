export function createPgDumpLineFilter(excludedSchemas: ReadonlySet<string>) {
  let skippingCopy = false

  return (line: string): string | null => {
    if (skippingCopy) {
      if (line === '\\.') skippingCopy = false
      return null
    }

    const copySchema = /^COPY "([^"]+)"\./.exec(line)?.[1]
    if (copySchema && excludedSchemas.has(copySchema)) {
      skippingCopy = true
      return null
    }

    const sequenceSchema = /^SELECT pg_catalog\.setval\('\"([^\"]+)\"\./.exec(line)?.[1]
    if (sequenceSchema && excludedSchemas.has(sequenceSchema)) return null

    return line
  }
}
