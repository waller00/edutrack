'use client'

import { withSchoolYear } from '@/lib/admin/school-year-query'
import {
  absencesText,
  gradeText,
  ReportCardPeriodSelect,
  ReportState,
  shortDate,
  studentName,
  Table,
  useReport,
  useReportCardPeriods,
  useSchoolYearQuery,
  type StudentRef,
} from './shared'

// ─── % de notas bajas por materia y curso ───────────────────────────────────

type LowGradeRow = {
  courseOfferingId: string
  courseName: string
  orientationName: string | null
  subjectName: string
  graded: number
  low: number
  percent: number | null
  pending: number
}
type LowGradeCourse = { courseOfferingId: string; courseName: string; graded: number; low: number; percent: number | null }
type LowGradesResponse = { period: { name: string }; rows: LowGradeRow[]; courses: LowGradeCourse[] }

/** Barra con el número al lado: el porcentaje nunca es sólo color (RNF 7.2). */
function PercentBar({ percent }: { percent: number | null }) {
  if (percent == null) return <span className="text-gray-400">Sin R</span>
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded bg-gray-100" aria-hidden>
        <span className="block h-full bg-amber-500" style={{ width: `${Math.min(100, percent)}%` }} />
      </span>
      <span className="tabular-nums">{String(percent).replace('.', ',')} %</span>
    </span>
  )
}

export function LowGradesTab() {
  const { periods, periodId, setPeriodId, error: periodsError } = useReportCardPeriods()
  const { data, loading, error } = useReport<LowGradesResponse>(
    periodId ? `/admin/student-reports/low-grades?periodId=${periodId}` : null,
  )
  return (
    <div className="space-y-4">
      <ReportCardPeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
      <p className="text-xs text-gray-500">
        Nota baja: la banda de alerta de la escala del nivel, sobre la nota oficial (R) del boletín.
      </p>
      <ReportState loading={loading} error={periodsError ?? error} empty={!data || data.rows.length === 0} emptyText="No hay libretas para este boletín." />
      {!loading && data && data.rows.length > 0 && (
        <>
          <Table head={['Curso', 'Alumnos con alguna nota baja', '%']} minWidth={480}>
            {data.courses.map((c) => (
              <tr key={c.courseOfferingId}>
                <td className="px-3 py-1.5 font-medium">{c.courseName}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  {c.low} de {c.graded}
                </td>
                <td className="px-3 py-1.5">
                  <PercentBar percent={c.percent} />
                </td>
              </tr>
            ))}
          </Table>
          <Table head={['Curso', 'Materia', 'Con nota baja', '%', 'Sin R']}>
            {data.rows.map((row) => (
              <tr key={`${row.courseOfferingId}-${row.orientationName}-${row.subjectName}`}>
                <td className="px-3 py-1.5">
                  {row.courseName}
                  {row.orientationName ? ` · ${row.orientationName}` : ''}
                </td>
                <td className="px-3 py-1.5">{row.subjectName}</td>
                <td className="px-3 py-1.5 tabular-nums">
                  {row.low} de {row.graded}
                </td>
                <td className="px-3 py-1.5">
                  <PercentBar percent={row.percent} />
                </td>
                <td className="px-3 py-1.5 tabular-nums text-gray-600">{row.pending || '—'}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  )
}

// ─── Bajó de un boletín a otro ──────────────────────────────────────────────

type GradeDropRow = StudentRef & { subjectId: string; subjectName: string; previous: number; current: number }
type GradeDropsResponse = { period: { name: string }; previous: { name: string } | null; rows: GradeDropRow[] }

export function GradeDropsTab() {
  const { periods, periodId, setPeriodId, error: periodsError } = useReportCardPeriods()
  const { data, loading, error } = useReport<GradeDropsResponse>(
    periodId ? `/admin/student-reports/grade-drops?periodId=${periodId}` : null,
  )
  const emptyText = data && !data.previous ? 'Es el primer boletín: no hay uno anterior con qué comparar.' : 'Nadie bajó respecto del boletín anterior.'
  return (
    <div className="space-y-4">
      <ReportCardPeriodSelect periods={periods} value={periodId} onChange={setPeriodId} />
      {data?.previous && (
        <p className="text-xs text-gray-500">
          Compara la R de cada materia de {data.period.name} con la de {data.previous.name}.
        </p>
      )}
      <ReportState loading={loading} error={periodsError ?? error} empty={!data || data.rows.length === 0} emptyText={emptyText} />
      {!loading && data && data.rows.length > 0 && (
        <Table head={['Alumno', 'Curso', 'Materia', data.previous?.name ?? 'Anterior', data.period.name]}>
          {data.rows.map((row) => (
            <tr key={`${row.studentId}-${row.subjectId}`}>
              <td className="px-3 py-1.5 font-medium">{studentName(row)}</td>
              <td className="px-3 py-1.5">{row.courseName}</td>
              <td className="px-3 py-1.5">{row.subjectName}</td>
              <td className="px-3 py-1.5 tabular-nums">{gradeText(row.previous)}</td>
              <td className="px-3 py-1.5 tabular-nums text-amber-800">
                {gradeText(row.current)} <span className="text-xs">(bajó)</span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

// ─── Faltas seguidas ────────────────────────────────────────────────────────

type StreakRow = StudentRef & { from: string; to: string; days: number; open: boolean }

export function StreaksTab() {
  const query = useSchoolYearQuery()
  const { data, loading, error } = useReport<{ data: StreakRow[] }>(withSchoolYear('/admin/student-reports/absence-streaks', query))
  const rows = data?.data ?? []
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        3 o más días de clase seguidos con falta entera sin justificar. Fines de semana y feriados no cortan la racha.
      </p>
      <ReportState loading={loading} error={error} empty={rows.length === 0} emptyText="No hay alumnos con faltas seguidas." />
      {!loading && rows.length > 0 && (
        <Table head={['Alumno', 'Curso', 'Desde', 'Hasta', 'Días', 'Estado']}>
          {rows.map((row) => (
            <tr key={`${row.studentId}-${row.from}`}>
              <td className="px-3 py-1.5 font-medium">{studentName(row)}</td>
              <td className="px-3 py-1.5">{row.courseName}</td>
              <td className="px-3 py-1.5 tabular-nums">{shortDate(row.from)}</td>
              <td className="px-3 py-1.5 tabular-nums">{shortDate(row.to)}</td>
              <td className="px-3 py-1.5 tabular-nums">{row.days}</td>
              <td className="px-3 py-1.5">
                {row.open ? <span className="font-medium text-red-700">Sigue faltando</span> : <span className="text-gray-600">Cortada</span>}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}

// ─── 18 / 25 faltas ─────────────────────────────────────────────────────────

type ThresholdRow = StudentRef & { absenceHundredths: number; threshold: number }

export function ThresholdsTab() {
  const query = useSchoolYearQuery()
  const { data, loading, error } = useReport<{ data: ThresholdRow[] }>(withSchoolYear('/admin/student-reports/absence-thresholds', query))
  const rows = data?.data ?? []
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">Alumnos con 18 faltas o más en el ciclo. Se vuelve a avisar a las 25.</p>
      <ReportState loading={loading} error={error} empty={rows.length === 0} emptyText="Ningún alumno llegó a 18 faltas." />
      {!loading && rows.length > 0 && (
        <Table head={['Alumno', 'Curso', 'Faltas', 'Umbral']} minWidth={520}>
          {rows.map((row) => (
            <tr key={row.studentId}>
              <td className="px-3 py-1.5 font-medium">{studentName(row)}</td>
              <td className="px-3 py-1.5">{row.courseName}</td>
              <td className="px-3 py-1.5 tabular-nums">{absencesText(row.absenceHundredths)}</td>
              <td className="px-3 py-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-semibold ${row.threshold >= 2500 ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-900'}`}
                >
                  {row.threshold / 100}+
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}
