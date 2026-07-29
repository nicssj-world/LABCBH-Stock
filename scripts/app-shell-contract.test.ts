import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell = readFileSync('components/ui/AppShell.tsx', 'utf8')
const css = readFileSync('app/globals.css', 'utf8')
assert.match(shell, /ภาพรวม/)
assert.match(shell, /สัญญา/)
assert.match(shell, /ใบ PR/)
assert.match(shell, /รับเข้า/)
assert.match(shell, /เบิกจ่าย/)
assert.match(shell, /aria-current/)
assert.match(shell, /LogoutButton/)
assert.match(css, /--lab-navy:/)
assert.match(css, /Noto Sans Thai/)
assert.doesNotMatch(css, /linear-gradient/)
