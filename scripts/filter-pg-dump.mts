import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { createPgDumpLineFilter } from './filter-pg-dump-lib'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1]?.trim() : undefined
  if (!value || value.startsWith('--')) throw new Error(`missing ${name}`)
  return value
}

async function main() {
  const input = resolve(argument('--input'))
  const output = resolve(argument('--output'))
  const excluded = new Set(argument('--exclude').split(',').map((value) => value.trim()).filter(Boolean))
  if (input === output) throw new Error('input and output must differ')
  if (existsSync(output)) throw new Error('output dump already exists')

  const filter = createPgDumpLineFilter(excluded)
  const reader = createInterface({ input: createReadStream(input), crlfDelay: Infinity })
  const writer = createWriteStream(output, { flags: 'wx' })
  let inputLines = 0
  let outputLines = 0

  for await (const line of reader) {
    inputLines += 1
    const filtered = filter(line)
    if (filtered === null) continue
    if (!writer.write(`${filtered}\n`)) await once(writer, 'drain')
    outputLines += 1
  }
  writer.end()
  await once(writer, 'finish')
  console.log(`PostgreSQL dump filtered: input_lines=${inputLines} output_lines=${outputLines}`)
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause)
  process.exit(1)
})
