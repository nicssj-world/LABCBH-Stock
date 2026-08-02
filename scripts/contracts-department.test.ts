import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The lab section that owns a contract lived on public.contracts already
// (carried over from the legacy portal) but LABCBH Stock never read or
// wrote it. This migration teaches create_contract/update_contract to
// require and persist it, and adds a table-level guard so no other write
// path can slip in a value outside the known department list.
const migrationsDir = join(process.cwd(), 'supabase', 'migrations')
const sharedDepartmentsPath = join(process.cwd(), 'lib', 'organization', 'departments.ts')
assert.equal(existsSync(sharedDepartmentsPath), true, 'the standard department list must be shared outside contracts')
const sharedDepartments = readFileSync(sharedDepartmentsPath, 'utf8')
assert.match(sharedDepartments, /export const DEPARTMENTS = \[/)

const contractSchema = readFileSync('lib/contracts/schema.ts', 'utf8')
assert.match(contractSchema, /import \{ DEPARTMENTS \} from '@\/lib\/organization\/departments'/)
assert.match(contractSchema, /export const CONTRACT_DEPARTMENTS = DEPARTMENTS/)

const migrationNames = readdirSync(migrationsDir).filter((n) =>
  n.endsWith('_lab_stock_contract_department.sql'),
)
assert.equal(migrationNames.length, 1, 'exactly one contract-department migration must exist')

const sql = readFileSync(join(migrationsDir, migrationNames[0]), 'utf8')
const compactSql = sql.replace(/\s+/g, ' ')

const departments = [
  'สำนักงานกลุ่มงานเทคนิคการแพทย์',
  'งานเคมีคลินิก',
  'งานโลหิตวิทยาคลินิก',
  'งานภูมิคุ้มกันวิทยาคลินิก',
  'งานจุลทรรศนศาสตร์คลินิก',
  'งานอณูชีววิทยา',
  'งานจุลชีววิทยา',
  'งานคลังเลือด',
  'งานตรวจพิเศษและห้องปฏิบัติการตรวจต่อ',
  'งานบริการผู้ป่วยนอก',
  'ห้องปฏิบัติการศูนย์สุขภาพชุมชนเมืองชลบุรี',
]

// The check is intentionally NOT NULL-free: legacy_import in
// 20260729192247_lab_stock_import_staging.sql inserts contracts without a
// department, and re-running that one-time import must not start failing a
// constraint it was never written against. A plain CHECK still lets NULL
// through in Postgres, same as contracts_contract_type_check already relies
// on for contract_type.
assert.match(sql, /add constraint contracts_department_check/i)
assert.doesNotMatch(sql, /alter\s+column\s+department\s+set\s+not\s+null/i)
for (const department of departments) {
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

  // department joins the same closed field-name allowlist as every other
  // contract metadata field, so an unexpected key is still rejected.
  assert.match(functionBody, /field_name not in \([\s\S]*'department'[\s\S]*\)/i)
  assert.match(functionBody, /p_contract\s+\?&\s+array\s*\[[\s\S]*'department'[\s\S]*\]/i)
  assert.match(functionBody, /jsonb_typeof\(p_contract -> 'department'\) is distinct from 'string'/i)
  assert.match(functionBody, /parsed_department\s*:=\s*p_contract\s*->>\s*'department'/i)
  assert.match(functionBody, /parsed_department not in \(/i)

  for (const department of departments) {
    assert.ok(
      functionBody.includes(`'${department}'`),
      `${functionName} department allowlist must include ${department}`,
    )
  }
}

const createFunction = sql.match(
  /create or replace function public\.create_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(createFunction)
// create_contract validates department on its own, distinctly from
// fiscalYear/contractType; update_contract folds it into the single
// combined metadata check, matching how contractType is already validated
// there. Same asymmetry the two functions already had before this migration.
assert.match(createFunction, /invalid department/i)
assert.match(
  createFunction,
  /insert into public\.contracts\s*\([\s\S]*department[\s\S]*\) values \([\s\S]*parsed_department/i,
)

const updateFunction = sql.match(
  /create or replace function public\.update_contract[\s\S]*?\$function\$;/i,
)?.[0]
assert.ok(updateFunction)
assert.match(updateFunction, /update public\.contracts\s*set[\s\S]*department\s*=\s*parsed_department/i)

console.log(`contracts department: ok (${migrationNames[0]})`)
