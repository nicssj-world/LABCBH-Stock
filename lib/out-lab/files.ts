import { CONTRACT_FILE_BUCKET, CONTRACT_FILE_TYPES } from '@/lib/contracts/files'

// Same private bucket as the contract register: one place to administer, one
// size limit, one set of storage policies. Out Lab documents are kept under
// their own prefix so a path can never be mistaken for a contract's.
export const OUT_LAB_FILE_BUCKET = CONTRACT_FILE_BUCKET
export const OUT_LAB_FILE_TYPES = CONTRACT_FILE_TYPES

/**
 * One folder per contract. The filename is flattened rather than escaped: a
 * name carrying slashes or dot segments would otherwise write outside the
 * folder the path check keys on.
 */
export function outLabFilePath(contractId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_')
  const uniqueId =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `out-lab/${contractId}/${Date.now()}-${uniqueId}-${safe}`
}

/**
 * Re-checked before the path is used. outLabFilePath already sanitises, but the
 * path is what decides which contract's folder is read, so it is verified
 * rather than trusted from the caller.
 */
export function isOutLabFilePathAllowed(path: string, contractId: string): boolean {
  if (path.includes('..')) return false
  const prefix = `out-lab/${contractId}/`
  if (!path.startsWith(prefix)) return false
  return !path.slice(prefix.length).includes('/')
}
