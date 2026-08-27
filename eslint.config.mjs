import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    // Locally installed skill/agent vendor trees, not project source.
    '.claude/**',
    '.next/**',
    '.vercel/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
  ]),
  {
    files: ['desktop/**/*.cjs'],
    rules: {
      // Electron's CommonJS entrypoints are intentionally loaded by the
      // Electron runtime, which does not expose these modules as ESM imports.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
])
