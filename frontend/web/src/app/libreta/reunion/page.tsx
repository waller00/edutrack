'use client'
import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import GroupMatrix from '@/components/admin/gradebook/GroupMatrix'
import ModuleHeader from '@/components/common/ModuleHeader'

/** Vista de reunión (RF-070): la misma matriz, en tamaño de proyección. */
export default function Page() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1800px] space-y-4">
        <ModuleHeader id="teachers-meeting">
          <p className="text-sm text-gray-600">
            La reunión decide el <strong>juicio de cada alumno</strong>, que va a su boletín; R y C son de cada materia.
            Tocá un alumno o una nota para abrir su <strong>panel</strong>: cada materia con sus notas del período, sus
            faltas y su juicio.
          </p>
        </ModuleHeader>
        {/* GroupMatrix guarda grupo y período en la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <GroupMatrix projection />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
