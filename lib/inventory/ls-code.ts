/**
 * LS codes arrive from the legacy Sheets as `ls046022`, `LS 046022`, and
 * `ls-046022`. Catalog identity ignores case and separators so the same reagent
 * never lands twice, while `inventory_items.ls_code` keeps the display form.
 */
export function normalizeLsCode(value: string): string {
  return value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
}
