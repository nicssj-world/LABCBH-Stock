import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './globals.css'

const themeScript = `try{const saved=localStorage.getItem('labcbh-theme');document.documentElement.dataset.theme=saved==='dark'?'dark':'light'}catch{}`

export const metadata: Metadata = {
  title: {
    default: 'LABCBH Stock',
    template: '%s | LABCBH Stock',
  },
  description: 'ระบบงานคลังน้ำยาและวัสดุวิทยาศาสตร์ กลุ่มงานเทคนิคการแพทย์ โรงพยาบาลชลบุรี',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="th" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
