import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingIncludes: {
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
          // The app intentionally previews same-origin PDFs and attachments in
          // modal iframes. Keep cross-origin framing blocked while allowing
          // those in-app previews to render.
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ]
  },
}

export default nextConfig
