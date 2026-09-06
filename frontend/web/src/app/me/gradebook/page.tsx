'use client'

import { BookOpen } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import MyGradeBooksList from '@/components/gradebook/MyGradeBooksList'

export default function MyGradeBooksPage() {
  return (
    <RoleGuard permission="gradebook.read">
      <main className="responsive-page max-w-[1100px] space-y-5">
        <header className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <BookOpen className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Mis libretas</h1>
            <p className="text-sm text-gray-600">
              Una libreta por asignatura y grupo, generada desde tus clases del horario.
            </p>
          </div>
        </header>

        <MyGradeBooksList />
      </main>
    </RoleGuard>
  )
}
