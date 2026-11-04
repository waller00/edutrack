'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import Link from 'next/link'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { legacyAttendanceIndicatorsTarget, STUDENT_INDICATORS_PATH } from '@/lib/admin/legacy-reports'
import JustificationRangesPanel from './JustificationRangesPanel'
import PendingRollCallsPanel from './PendingRollCallsPanel'
import StudentAttendanceWorkspace from './StudentAttendanceWorkspace'

export type AttendanceTabId = 'estudiantes' | 'justificaciones' | 'pendientes'

/**
 * Pestañas de Asistencia de estudiantes. Cada una con su permiso: adscripción y dirección justifican
 * y ven las faltas; las listas sin pasar son de administración.
 */
export const ATTENDANCE_TABS: readonly { id: AttendanceTabId; label: string; permission: string }[] = [
  { id: 'estudiantes', label: 'Por estudiante', permission: 'student-attendance.read' },
  { id: 'justificaciones', label: 'Carga rápida', permission: 'student-attendance.justify' },
  { id: 'pendientes', label: 'Listas sin pasar', permission: 'student-attendance.manage' },
]

const CONTENT: Record<AttendanceTabId, () => React.ReactElement> = {
  estudiantes: StudentAttendanceWorkspace,
  justificaciones: JustificationRangesPanel,
  pendientes: PendingRollCallsPanel,
}

/**
 * La pestaña vive en la URL (`?tab=`): el aviso de "faltas seguidas" o "18 faltas" abre directo en
 * la que corresponde. Si la pedida no está permitida, abre la primera que sí.
 */
export default function StudentAttendanceTabs() {
  const me = useOptionalAuth()?.me ?? null
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const requested = params?.get('tab')
  const legacyIndicator = requested === 'seguidas' || requested === 'faltas'
  const canIndicators = hasPermission(me, 'student-reports.read', 'all')
  const canRead = hasPermission(me, 'student-attendance.read', 'all')
  useEffect(() => {
    // Los avisos viejos de faltas abrían acá: ahora van a la sección Asistencia de los indicadores.
    if (canIndicators && (legacyIndicator || !canRead)) router.replace(legacyAttendanceIndicatorsTarget(params ?? undefined))
  }, [legacyIndicator, canIndicators, canRead, params, router])
  const allowed = ATTENDANCE_TABS.filter((tab) => canRead && hasPermission(me, tab.permission, 'all'))
  if (allowed.length === 0 || (legacyIndicator && canIndicators)) return null
  const active = allowed.find((tab) => tab.id === requested) ?? allowed[0]
  const Content = CONTENT[active.id]

  return (
    <div className="space-y-4">
      {canIndicators && <div className="flex justify-end"><Link href={`${STUDENT_INDICATORS_PATH}?seccion=asistencia`} className="text-sm font-medium text-emerald-700 hover:underline">Ver indicadores de asistencia →</Link></div>}
      {allowed.length > 1 && (
        <div role="tablist" aria-label="Asistencia de estudiantes" data-tour="student-attendance.tabs" className="flex flex-wrap gap-1 border-b border-gray-200">
          {allowed.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active.id}
              onClick={() => {
                const next = new URLSearchParams(params?.toString())
                next.set('tab', tab.id)
                next.delete('studentId'); next.delete('action')
                router.replace(`${pathname ?? '/admin/student-attendance'}?${next}`, { scroll: false })
              }}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab.id === active.id ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" aria-label={active.label} data-tour="student-attendance.content">
        <Content />
      </div>
    </div>
  )
}
