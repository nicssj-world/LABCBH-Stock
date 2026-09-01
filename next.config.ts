import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
    // sharp is externalized by Next.js. Include its Linux native runtime in
    // the requisition server action, otherwise Vercel can deploy the JS
    // wrapper without libvips and signature saves fail at runtime.
    '/requisitions/[id]': [
      './node_modules/sharp/**/*',
      './node_modules/@img/**/*',
    ],
    '/api/purchase-requests/*/checklist/committee-pdf': [
      './node_modules/font-th-sarabun-new/fonts/*.ttf',
    ],
    '/api/purchase-requests/*/checklist/download-all': [
      './node_modules/font-th-sarabun-new/fonts/*.ttf',
    ],
  },
  experimental: {
    serverActions: {
      // Matches the lab-stock-contracts bucket's file_size_limit (25MB); the
      // default 1MB Server Action body limit was silently rejecting normal
      // scanned contract PDFs with a redacted production error.
      bodySizeLimit: '26mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // The app intentionally previews private files through same-origin
          // document routes inside modal viewers. Keep cross-origin framing
          // blocked for any remaining external embeds.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
