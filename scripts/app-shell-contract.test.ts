import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const shell = readFileSync('components/ui/AppShell.tsx', 'utf8')
const css = readFileSync('app/globals.css', 'utf8')
const dashboard = readFileSync('app/(protected)/dashboard/page.tsx', 'utf8')
assert.match(shell, /href: '\/dashboard', label: 'Dashboard'/)
assert.match(dashboard, /<h1>Dashboard บริหารสัญญา<\/h1>/)
assert.match(shell, /สัญญา/)
assert.match(shell, /ใบ PR/)
assert.match(shell, /รับเข้า/)
assert.match(shell, /เบิกจ่าย/)
assert.match(shell, /aria-current/)
assert.match(shell, /LogoutButton/)
assert.match(shell, /https:\/\/lab-management-cbh\.vercel\.app\/staff\/dashboard/, 'the shell must offer a direct return to the portal dashboard')
assert.match(shell, /กลับไป Lab Management Portal/, 'the portal return action must be clearly named')
assert.match(shell, /<span>Lab Management<\/span>/, 'the portal return action must use the approved concise label')
assert.match(shell, /actor\.avatarUrl/, 'the shell must use the shared portal display photo when available')
assert.match(shell, /actor-badge__avatar/, 'the display photo needs a dedicated avatar treatment')
assert.match(shell, /aria-pressed=\{dark\}/, 'the theme control must expose its active state')
assert.match(shell, /<UtilityIcon name="appearance" dark=\{dark\} \/>/, 'the theme control must show the current appearance mode with a shared SVG icon')
assert.doesNotMatch(shell, /name === 'moon'/, 'the theme control must not render a moon icon')
assert.match(shell, /const \[collapsed, setCollapsed\] = useState\(false\)/, 'the desktop sidebar must keep an explicit collapsed state')
assert.match(shell, /bench-rail\$\{collapsed \? ' is-collapsed' : ''\}/, 'the sidebar must expose its collapsed state to styling')
assert.match(shell, /aria-label=\{collapsed \? 'ขยายเมนูหลัก' : 'ย่อเมนูหลัก'\}/, 'the sidebar control must announce its next action')
assert.match(shell, /onClick=\{\(\) => setCollapsed\(\(value\) => !value\)\}/, 'desktop users must be able to toggle the sidebar')
assert.match(shell, /title=\{collapsed \? item\.label : undefined\}/, 'collapsed navigation must retain a label on hover')
assert.match(shell, /addEventListener\('wheel', blurNumberInputOnWheel/, 'number inputs must not change when the pointer wheel scrolls over them')
assert.match(shell, /target\.type !== 'number'/, 'the wheel guard must only target numeric inputs')
assert.match(shell, /target\.blur\(\)/, 'the wheel guard must release numeric input focus so the page can scroll')
assert.match(css, /\.app-shell:has\(\.bench-rail\.is-collapsed\)/, 'the shell must reserve a compact desktop column for the collapsed sidebar')
assert.match(css, /\.bench-rail\.is-collapsed\s*\{/, 'collapsed sidebar styling must be explicitly defined')
assert.match(css, /\.bench-rail\.is-collapsed \.(?:bench-brand__copy|bench-nav__section|bench-rail__footer-copy)/, 'collapsed sidebar must hide text while retaining its navigation icons')
// Navigation feedback. The route skeleton cannot cover this alone: React
// withholds a Suspense fallback when a transition looks like it will resolve
// quickly, which left opening a record (measured at 500-800ms) showing the
// previous page with no sign the click had registered.
const routeProgress = readFileSync('components/ui/RouteProgress.tsx', 'utf8')
assert.match(shell, /<RouteProgress>/, 'every protected route must sit inside the navigation progress boundary')
assert.match(
  routeProgress,
  /document\.addEventListener\('click', onDocumentClick, true\)/,
  'the bar must observe navigation in the capture phase, before a handler can stop propagation',
)
assert.match(
  routeProgress,
  /anchor\.origin !== window\.location\.origin/,
  'a link off this origin is the browser\'s navigation, not the router\'s',
)
assert.match(
  routeProgress,
  /GIVE_UP_AFTER_MS/,
  'a navigation that never arrives must not leave the bar on screen forever',
)
assert.match(
  readFileSync('components/ui/AutoFilterBench.tsx', 'utf8'),
  /startNavigationProgress\(\)/,
  'filtering re-reads the list on the server, and no anchor click exists for the bar to observe',
)
assert.match(css, /\.route-progress \{/, 'the progress bar needs explicit styling in the design system')
assert.match(
  css,
  /@media \(prefers-reduced-motion: reduce\) \{\s*\.route-progress__bar \{ animation: none/,
  'the advancing bar must stand still for a reader who asked for reduced motion',
)

assert.match(css, /--lab-navy:/)
assert.match(css, /Noto Sans Thai/)
assert.doesNotMatch(css, /linear-gradient/)
