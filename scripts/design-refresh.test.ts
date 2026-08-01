import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(path, 'utf8')

const shell = read('components/ui/AppShell.tsx')
assert.match(shell, /aria-label="เปิดเมนูหลัก"/, 'mobile navigation must have an accessible trigger')
assert.match(shell, /aria-label="ปิดเมนูหลัก"/, 'mobile navigation must have an accessible dismiss target')
assert.match(shell, /aria-label="เปลี่ยนธีม"/, 'the shared shell must expose the portal-style theme control')
assert.match(shell, /data-nav-tone=/, 'navigation icons must use a consistent semantic tone system')
assert.match(shell, /aria-expanded=/, 'the menu trigger must announce its state')

const styles = read('app/globals.css')
assert.match(styles, /--lab-primary:\s*#1e5fad/i, 'the portal primary blue must anchor the shared visual language')
assert.match(styles, /--lab-accent:\s*#059669/i, 'stock actions must retain a distinct inventory-green accent')
assert.match(styles, /--lab-shadow-panel:/, 'panels must use a shared elevation token')
assert.match(styles, /\[data-theme="dark"\]/, 'the application design system must support dark mode')
assert.match(styles, /\.bench-rail-overlay/, 'mobile navigation must use a dismissible scrim')
assert.match(styles, /@media \(max-width:\s*800px\)[\s\S]*\.bench-rail\.is-open/, 'the sidebar must become an off-canvas drawer on small screens')
assert.match(styles, /@media \(prefers-reduced-motion:\s*reduce\)/, 'motion must respect the operating-system preference')
assert.match(styles, /\.utility-button\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/, 'icon controls must meet the 44px touch-target minimum')
assert.match(styles, /\.password-toggle\s*\{[\s\S]*?width:\s*44px;[\s\S]*?height:\s*44px;/, 'the password control must meet the 44px touch-target minimum')

const rootLayout = read('app/layout.tsx')
assert.match(rootLayout, /labcbh-theme/, 'the saved theme must be restored before hydration')

console.log('portal-aligned design refresh contract: ok')
