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
            Tocá un alumno o una nota para abrir su <strong>panel</strong>: cada materia con su detalle, sus faltas y lo
            que decide la reunión (rendimiento, conducta y juicio). También se decide en la tabla y en «Juicios de la
            reunión».
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
