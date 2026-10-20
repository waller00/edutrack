'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import JustificationRangesPanel from './JustificationRangesPanel'
import PendingRollCallsPanel from './PendingRollCallsPanel'
import { StreaksTab, ThresholdsTab } from '@/components/admin/student-reports/ReportTabs'

export type AttendanceTabId = 'justificaciones' | 'seguidas' | 'faltas' | 'pendientes'

/**
 * Pestañas de Asistencia de estudiantes. Cada una con su permiso: adscripción y dirección justifican
 * y ven las faltas; las listas sin pasar son de administración.
 */
export const ATTENDANCE_TABS: readonly { id: AttendanceTabId; label: string; permission: string }[] = [
  { id: 'justificaciones', label: 'Justificativos', permission: 'student-attendance.justify' },
  { id: 'seguidas', label: 'Faltas seguidas', permission: 'student-reports.read' },
  { id: 'faltas', label: '18 y 25 faltas', permission: 'student-reports.read' },
  { id: 'pendientes', label: 'Listas sin pasar', permission: 'student-attendance.manage' },
]

const CONTENT: Record<AttendanceTabId, () => React.ReactElement> = {
  justificaciones: JustificationRangesPanel,
  seguidas: StreaksTab,
  faltas: ThresholdsTab,
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

  const allowed = ATTENDANCE_TABS.filter((tab) => hasPermission(me, tab.permission, 'all'))
  if (allowed.length === 0) return null
  const requested = params?.get('tab')
  const active = allowed.find((tab) => tab.id === requested) ?? allowed[0]
  const Content = CONTENT[active.id]

  return (
    <div className="space-y-4">
      {allowed.length > 1 && (
        <div role="tablist" aria-label="Asistencia de estudiantes" className="flex flex-wrap gap-1 border-b border-gray-200">
          {allowed.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active.id}
              onClick={() => router.replace(`${pathname ?? '/admin/student-attendance'}?tab=${tab.id}`, { scroll: false })}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                tab.id === active.id ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div role="tabpanel" aria-label={active.label}>
        <Content />
      </div>
    </div>
  )
}
