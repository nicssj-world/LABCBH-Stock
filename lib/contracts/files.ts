export const CONTRACT_FILE_BUCKET = 'lab-stock-contracts'

export const CONTRACT_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

/**
 * One folder per contract. The filename is flattened rather than escaped: a
 * name carrying slashes or dot segments would otherwise write outside the
 * folder the storage policy keys on.
 */
export function contractFilePath(contractId: number, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_')
  const uniqueId = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `contracts/${contractId}/${Date.now()}-${uniqueId}-${safe}`
}

/**
 * Re-checked before the path is used. contractFilePath already sanitises, but
 * the path is what the storage policy keys on, so it is verified rather than
 * trusted from the caller.
 */
export function isContractFilePathAllowed(path: string, contractId: number): boolean {
  if (path.includes('..')) return false
  const prefix = `contracts/${contractId}/`
  if (!path.startsWith(prefix)) return false
  return !path.slice(prefix.length).includes('/')
}
