'use client'

import { useSearchParams } from 'next/navigation'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import GradeFollowUp from '@/components/admin/student-reports/GradeFollowUp'
import AcademicDashboard from './AcademicDashboard'

/**
 * Rendimiento académico (el "backoffice de inteligencia académica" del RF-200) según quién mira:
 * - con los indicadores (`academic-analytics.read`), el tablero, más "Seguimiento" si también ve los
 *   reportes de estudiantes;
 * - con sólo los reportes (adscripción), sólo el seguimiento de notas: antes lo veía en "Reportes".
 *
 * `?view=seguimiento` abre directo en esa vista (lo usan los enlaces viejos a Reportes).
 */
export default function AcademicIntelligence() {
  const me = useOptionalAuth()?.me ?? null
  const params = useSearchParams()
  const canAnalytics = hasPermission(me, 'academic-analytics.read', 'all')
  const canFollowUp = hasPermission(me, 'student-reports.read', 'all')

  if (!canAnalytics) return canFollowUp ? <GradeFollowUp /> : null
  const wantsFollowUp = params?.get('view') === 'seguimiento' && canFollowUp
  return <AcademicDashboard followUp={canFollowUp} initialView={wantsFollowUp ? 'followup' : undefined} />
}
