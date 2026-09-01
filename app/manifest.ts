import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'LAB-CBH Inventory & Contract Management',
    short_name: 'LAB-CBH Stock',
    description: 'Inventory and contract management for Chonburi Hospital laboratory services.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui', 'browser'],
    orientation: 'any',
    background_color: '#f4f7fb',
    theme_color: '#123944',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
