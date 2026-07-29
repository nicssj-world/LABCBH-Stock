import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'LABCBH Stock',
    template: '%s | LABCBH Stock',
  },
  description: 'ระบบงานคลังน้ำยาและวัสดุวิทยาศาสตร์ กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  )
}
