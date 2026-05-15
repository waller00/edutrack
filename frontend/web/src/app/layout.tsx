import './globals.css'
import type { Metadata } from 'next'
import UserNav from '@/components/UserNav'

export const metadata: Metadata = {
  title: 'EduTrack',
  description: 'Sistema de gestión educativa',
  icons: {
    icon: '/logo.svg',
    shortcut: '/logo.svg',
    apple: '/logo.svg',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <UserNav>{children}</UserNav>
      </body>
    </html>
  )
}
