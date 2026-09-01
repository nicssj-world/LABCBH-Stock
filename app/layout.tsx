import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  icons: {
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'LAB-CBH Stock' },
  title: {
    default: 'LAB-CBH Inventory & Contract Management',
    template: '%s | LAB-CBH Inventory & Contract Management',
  },
  description: 'ระบบบริหารคลังพัสดุและสัญญา กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#123944',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
