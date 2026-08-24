export function formatProfileName(
  name: string | null | undefined,
  namePrefix: string | null | undefined,
) {
  const normalizedName = name?.trim() ?? ''
  const normalizedPrefix = namePrefix?.trim() ?? ''
  return `${normalizedPrefix}${normalizedName}`.trim()
}
