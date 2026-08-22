import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'LAB-CBH Inventory & Contract Management',
    template: '%s | LAB-CBH Inventory & Contract Management',
  },
  description: 'ระบบบริหารคลังพัสดุและสัญญา กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
