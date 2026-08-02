import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// "คลังน้ำยาและวัสดุ" (the stock office itself) and "POCT" were added to the
// contract department allowlist after the original closed list shipped in
// 20260802090000_lab_stock_contract_department.sql. Migrations are
// forward-only, so the new values had to land in a follow-up migration that
// touches contracts_department_check and both RPCs' inline allowlists —
// this proves that follow-up migration actually did all three.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')

const migrationNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_contract_department_add_stock_and_poct.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one stock/POCT department migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

const newDepartments = ['คลังน้ำยาและวัสดุวิทยาศาสตร์', 'POCT']

assert.match(sql, /drop constraint contracts_department_check/i)
assert.match(sql, /add constraint contracts_department_check/i)
for (const department of newDepartments) {
  assert.ok(
    compactSql.includes(`'${department}'`),
    `department check constraint must include ${department}`,
  )
}

for (const functionName of ['create_contract', 'update_contract']) {
  const functionBody = sql.match(
    new RegExp(`create or replace function public\\.${functionName}[\\s\\S]*?\\$function\\$;`, 'i'),
  )?.[0]
  assert.ok(functionBody, `${functionName} body must exist`)
  assert.match(functionBody, /parsed_department not in \(/i)

  for (const department of newDepartments) {
    assert.ok(
      functionBody.includes(`'${department}'`),
      `${functionName} department allowlist must include ${department}`,
    )
  }
}

const sharedDepartments = readFileSync(join(process.cwd(), 'lib', 'organization', 'departments.ts'), 'utf8')
for (const department of newDepartments) {
  assert.ok(
    sharedDepartments.includes(`'${department}'`),
    `shared DEPARTMENTS list must include ${department}`,
  )
}

console.log(`contracts department (stock/POCT addition): ok (${migrationNames[0]})`)
