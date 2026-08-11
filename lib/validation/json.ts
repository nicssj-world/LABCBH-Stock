/**
 * Database JSON payloads use a missing optional property and JSON null
 * differently in a few guarded RPCs. Keep meaningful falsy values intact;
 * only omit values that mean "not supplied".
 */
export function omitNullishProperties<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined),
  ) as Partial<T>
}
