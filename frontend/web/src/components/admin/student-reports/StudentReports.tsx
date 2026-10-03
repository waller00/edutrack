'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { GradeDropsTab, LowGradesTab, StreaksTab, ThresholdsTab } from './ReportTabs'
import { absencesText, gradeText, ReportState, shortDate, studentName, Table, useReport, useSchoolYearQuery } from './shared'

export const REPORT_TABS = [
  { id: 'alertas', label: 'Alertas' },
  { id: 'notas', label: 'Notas bajas' },
  { id: 'bajas', label: 'Bajas de boletín' },
  { id: 'seguidas', label: 'Faltas seguidas' },
  { id: 'faltas', label: '18 / 25 faltas' },
] as const

type TabId = (typeof REPORT_TABS)[number]['id']

type AlertType = 'GRADE_DROP' | 'ABSENCE_STREAK' | 'ABSENCE_THRESHOLD'

type StudentAlertRow = {
  id: string
  type: AlertType
  key: string
  createdAt: string
  payload: Record<string, any>
}

const ALERT_LABEL: Record<AlertType, string> = {
  GRADE_DROP: 'Bajó de boletín',
  ABSENCE_STREAK: 'Faltas seguidas',
  ABSENCE_THRESHOLD: 'Umbral de faltas',
}

/** Qué pasó, en palabras: la alerta se lee sin tener que abrir el reporte. */
export function alertDetail(alert: StudentAlertRow): string {
  const p = alert.payload
  if (alert.type === 'ABSENCE_THRESHOLD') return `Llegó a ${alert.key} faltas (lleva ${absencesText(Number(p.absenceHundredths ?? 0))}).`
  if (alert.type === 'ABSENCE_STREAK') return `${p.days} días seguidos desde el ${shortDate(String(p.from))}.`
  return `${p.subjectName}: de ${gradeText(Number(p.previous))} (${p.previousName ?? 'anterior'}) a ${gradeText(Number(p.current))} (${p.periodName}).`
}

function AlertsTab() {
  const query = useSchoolYearQuery()
  const { data, loading, error } = useReport<{ data: StudentAlertRow[] }>(withSchoolYear('/admin/student-reports/alerts', query))
  const rows = data?.data ?? []
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Cada alerta se avisa una sola vez por notificación a adscripción y dirección. Acá quedan todas las del ciclo.
      </p>
      <ReportState loading={loading} error={error} empty={rows.length === 0} emptyText="No hay alertas en este ciclo." />
      {!loading && rows.length > 0 && (
        <Table head={['Detectada', 'Tipo', 'Alumno', 'Curso', 'Detalle']} minWidth={760}>
          {rows.map((alert) => (
            <tr key={alert.id}>
              <td className="px-3 py-1.5 tabular-nums text-gray-600">{shortDate(alert.createdAt.slice(0, 10))}</td>
              <td className="px-3 py-1.5 font-medium">{ALERT_LABEL[alert.type]}</td>
              <td className="px-3 py-1.5">{studentName({ firstName: alert.payload.firstName ?? '', lastName: alert.payload.lastName ?? '' })}</td>
              <td className="px-3 py-1.5">{alert.payload.courseName ?? '—'}</td>
              <td className="px-3 py-1.5 text-gray-700">{alertDetail(alert)}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

const TAB_CONTENT: Record<TabId, () => React.ReactElement> = {
  alertas: AlertsTab,
  notas: LowGradesTab,
  bajas: GradeDropsTab,
  seguidas: StreaksTab,
  faltas: ThresholdsTab,
}

function isTab(value: string | null): value is TabId {
  return REPORT_TABS.some((tab) => tab.id === value)
}

/**
 * Reportes de estudiantes: notas bajas por materia y curso, bajas de un boletín a otro, faltas
 * seguidas y 18/25 faltas. La pestaña vive en la URL (`?tab=`), así el enlace de una notificación
 * abre directo en la que corresponde.
 */
export default function StudentReports() {
  const router = useRouter()
  const params = useSearchParams()
  const requested = params.get('tab')
  const active: TabId = isTab(requested) ? requested : 'alertas'
  const Content = TAB_CONTENT[active]

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Reportes" className="flex flex-wrap gap-1 border-b border-gray-200">
        {REPORT_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            onClick={() => router.replace(`/admin/reportes?tab=${tab.id}`)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab.id === active ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        <Content />
      </div>
    </div>
  )
}
