'use client'
import { Suspense } from 'react'
import RoleGuard from '@/components/auth/RoleGuard'
import ControlVisadoPanel from '@/components/admin/gradebook/ControlVisadoPanel'
import ModuleHeader from '@/components/common/ModuleHeader'

/**
 * Control y visado de libretas. Se entra con la lectura de todas las libretas: quien además
 * controla (`gradebook.review`) ve también los pasos Carga y Cierre.
 */
export default function Page() {
  return (
    <RoleGuard permission="gradebook.read" permissionScope="all">
      <main className="responsive-page max-w-[1500px] space-y-4">
        <ModuleHeader id="gradebook-control" />
        {/* El paso va en la URL: useSearchParams necesita un Suspense para prerenderizar. */}
        <Suspense fallback={null}>
          <ControlVisadoPanel />
        </Suspense>
      </main>
    </RoleGuard>
  )
}
