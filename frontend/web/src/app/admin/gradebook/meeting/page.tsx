'use client'

import Link from 'next/link'
import { ArrowLeft, Presentation } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import GroupMatrix from '@/components/admin/gradebook/GroupMatrix'

/**
 * Vista de reunión (RF-070): la misma matriz, en tamaño de proyección y sin la navegación que
 * distrae cuando está en pantalla frente a la sala.
 */
export default function TeacherMeetingPage() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1800px] space-y-4">
        <header className="flex flex-wrap items-center gap-3">
          <Presentation className="h-6 w-6 text-emerald-600" aria-hidden />
          <h1 className="text-xl font-bold text-gray-900">Reunión de profesores</h1>
          <Link href="/admin/gradebook" className="ml-auto inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Salir del modo reunión
          </Link>
        </header>

        <GroupMatrix projection />
      </main>
    </RoleGuard>
  )
}
