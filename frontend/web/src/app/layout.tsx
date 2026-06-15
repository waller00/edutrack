import './globals.css'
import type { Metadata } from 'next'
import UserNav from '@/components/navigation/UserNav'
import { Observability } from '@/components/observability/Observability'
import { AuthProvider } from '@/contexts/AuthContext'

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
        <Observability />
        <AuthProvider>
          <UserNav>{children}</UserNav>
        </AuthProvider>
      </body>
    </html>
  )
}
