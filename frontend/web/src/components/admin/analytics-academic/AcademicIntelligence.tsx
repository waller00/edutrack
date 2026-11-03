'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import GradeFollowUp from '@/components/admin/student-reports/GradeFollowUp'
import AcademicDashboard from './AcademicDashboard'
import AttendanceOverview from '@/components/admin/student-attendance/AttendanceOverview'

/**
 * Rendimiento académico (el "backoffice de inteligencia académica" del RF-200) según quién mira:
 * - con los indicadores (`academic-analytics.read`), el tablero, más "Seguimiento" si también ve los
 *   reportes de estudiantes;
 * - con sólo los reportes (adscripción), seguimiento de notas y alertas de asistencia.
 *
 * `?view=seguimiento` y `?view=asistencia` permiten abrir directamente cada vista.
 */
export default function AcademicIntelligence() {
  const me = useOptionalAuth()?.me ?? null
  const params = useSearchParams()
  const canAnalytics = hasPermission(me, 'academic-analytics.read', 'all')
  const canFollowUp = hasPermission(me, 'student-reports.read', 'all')
  const [reportView, setReportView] = useState<'followup' | 'attendance'>(() =>
    params?.get('view') === 'asistencia' ? 'attendance' : 'followup',
  )

  if (!canAnalytics)
    return canFollowUp ? (
      <div className="space-y-5">
        <div
          role="group"
          aria-label="Vistas de seguimiento de estudiantes"
          className="flex gap-1 rounded-xl border border-slate-200 bg-white p-1"
        >
          {(
            [
              { id: 'followup', label: 'Seguimiento académico' },
              { id: 'attendance', label: 'Asistencia' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={reportView === tab.id}
              onClick={() => setReportView(tab.id)}
              className={`min-h-10 flex-1 rounded-lg px-3 text-sm ${reportView === tab.id ? 'bg-emerald-50 font-medium text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {reportView === 'attendance' ? <AttendanceOverview /> : <GradeFollowUp />}
      </div>
    ) : null
  const wantsFollowUp = params?.get('view') === 'seguimiento' && canFollowUp
  const wantsAttendance = params?.get('view') === 'asistencia' && canFollowUp
  return (
    <AcademicDashboard
      followUp={canFollowUp}
      initialView={wantsAttendance ? 'attendance' : wantsFollowUp ? 'followup' : undefined}
    />
  )
}
