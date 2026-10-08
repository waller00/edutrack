'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2, TrendingDown } from 'lucide-react'
import { api } from '@/lib/api/client'
import { downloadFile } from '@/lib/api/download'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { formatAbsenceUnits } from '@/lib/libreta/absences'

type Enrollment = {
  schoolYearId?: string
  schoolYearCode: number
  schoolYearLabel: string
  courseName: string
  orientationName: string | null
  status: string
  absences?: { absenceHundredths: number; justified: number }
  conduct?: Array<{ periodId: string; periodName: string; label: string | null }>
  reportCardPeriods?: Array<{ id: string; name: string }>
}

type Point = { periodCode: string; periodName: string; valueHundredths: number | null }

type SubjectEvolution = { subjectName: string; points: Point[]; sustainedDecline: boolean }

type HistoryEntry = {
  subjectName: string
  periodName: string
  periodSortOrder?: number
  conceptualJudgement: string | null
  schoolYearCode: number
}

type Decision = {
  id: string
  periodName: string
  decision: string
  createdAt: string
  createdByName: string | null
}

type File = {
  student: { id: string; firstName: string; lastName: string; documentId: string | null; email: string | null }
  enrollments: Enrollment[]
  history: HistoryEntry[]
  evolutionByYear: Array<{ schoolYearCode: number; subjects: SubjectEvolution[] }>
  decisions?: Decision[]
}

/** El estado de la matrícula en castellano: "ACTIVE" no le dice nada a nadie en el liceo. */
export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  WITHDRAWN: 'Baja',
  GRADUATED: 'Egresó',
  TRANSFERRED: 'Pase a otro centro',
}

/** Juicios de un año agrupados por período, en el orden de la planilla. */
export function judgementsByPeriod(history: readonly HistoryEntry[], schoolYearCode: number) {
  const byPeriod = new Map<string, { order: number; items: Array<{ subjectName: string; text: string }> }>()
  for (const entry of history) {
    const text = (entry.conceptualJudgement ?? '').trim()
    if (entry.schoolYearCode !== schoolYearCode || !text) continue
    const bucket = byPeriod.get(entry.periodName) ?? { order: entry.periodSortOrder ?? 0, items: [] }
    bucket.items.push({ subjectName: entry.subjectName, text })
    byPeriod.set(entry.periodName, bucket)
  }
  return [...byPeriod.entries()]
    .sort((a, b) => a[1].order - b[1].order)
    .map(([periodName, bucket]) => ({ periodName, items: bucket.items }))
}

function EnrollmentRow({
  enrollment,
  canExport,
  busy,
  onReportCard,
}: {
  enrollment: Enrollment
  canExport: boolean
  busy: string | null
  onReportCard: (periodId: string) => void
}) {
  const conduct = (enrollment.conduct ?? []).filter((c) => c.label)
  return (
    <li className="space-y-1 px-4 py-2 text-sm">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-gray-900">{enrollment.schoolYearLabel}</span>
        <span className="text-gray-700">{enrollment.courseName}</span>
        {enrollment.orientationName && <span className="text-gray-500">— {enrollment.orientationName}</span>}
        <span className="ml-auto text-xs text-gray-500">
          {ENROLLMENT_STATUS_LABELS[enrollment.status] ?? enrollment.status}
        </span>
      </div>
      {enrollment.absences && (
        <p className="text-xs text-gray-600">
          Faltas del ciclo: {formatAbsenceUnits(enrollment.absences.absenceHundredths)}
          {enrollment.absences.justified > 0 && ` (${enrollment.absences.justified} justificadas)`}
        </p>
      )}
      {conduct.length > 0 && (
        <p className="text-xs text-gray-600">
          Conducta: {conduct.map((c) => `${c.periodName} ${c.label}`).join(' · ')}
        </p>
      )}
      {canExport && (enrollment.reportCardPeriods ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(enrollment.reportCardPeriods ?? []).map((period) => (
            <button
              key={period.id}
              type="button"
              disabled={busy !== null}
              onClick={() => onReportCard(period.id)}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === period.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : <FileText className="h-3 w-3" aria-hidden />}
              Boletín {period.name}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}

function YearEvolution({ year, history }: { year: File['evolutionByYear'][number]; history: readonly HistoryEntry[] }) {
  const judgements = judgementsByPeriod(history, year.schoolYearCode)
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="border-b border-gray-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-900">Evolución {year.schoolYearCode}</h3>
        <p className="text-xs text-gray-500">
          Nota de reunión de cada período por asignatura. Un guion es un período sin datos.
        </p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">Asignatura</th>
              {year.subjects[0]?.points.map((p) => (
                <th key={p.periodCode} scope="col" className="px-2 py-2 text-left font-medium">{p.periodName}</th>
              ))}
              <th scope="col" className="px-2 py-2 text-left font-medium">Tendencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {year.subjects.map((subject) => (
              <tr key={subject.subjectName}>
                <td className="px-3 py-1.5 text-gray-900">{subject.subjectName}</td>
                {subject.points.map((p) => (
                  <td key={p.periodCode} className="px-2 py-1.5 text-gray-700">
                    {p.valueHundredths == null ? (
                      <span className="text-gray-400" title="Período sin datos">—</span>
                    ) : (
                      formatHundredths(p.valueHundredths, 0)
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5">
                  {subject.sustainedDecline ? (
                    <span className="inline-flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900">
                      <TrendingDown className="h-3 w-3" aria-hidden />
                      Descenso sostenido
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {judgements.length > 0 && (
        <details className="border-t border-gray-100 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-800">Juicios conceptuales</summary>
          <div className="mt-2 space-y-3">
            {judgements.map((group) => (
              <div key={group.periodName}>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{group.periodName}</h4>
                <ul className="mt-1 space-y-1">
                  {group.items.map((item) => (
                    <li key={`${group.periodName}-${item.subjectName}`} className="text-sm text-gray-800">
                      <span className="font-medium">{item.subjectName}:</span> {item.text}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

/** Ficha académica del estudiante (RF-031). */
export default function StudentFile({ studentId }: { studentId: string }) {
  const auth = useOptionalAuth()
  const canExport = hasPermission(auth?.me, 'gradebook.export')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setFile(await api<File>(`/admin/gradebook/students/${studentId}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la ficha')
    } finally {
      setLoading(false)
    }
  }, [studentId])

  useEffect(() => {
    void load()
  }, [load])

  async function reportCard(periodId: string) {
    setBusy(periodId)
    setError(null)
    try {
      await downloadFile(`/admin/gradebook/report-card/${studentId}?periodId=${periodId}`, 'boletin.pdf')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar el boletín')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando ficha…
      </p>
    )
  }

  if (!file) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {error ?? 'No se pudo cargar la ficha'}
      </p>
    )
  }

  const decisions = file.decisions ?? []

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-gray-900">
          {file.student.lastName}, {file.student.firstName}
        </h2>
        <p className="text-sm text-gray-600">
          {file.student.documentId ?? 'Sin documento'}
          {file.student.email && ` · ${file.student.email}`}
        </p>
      </section>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Trayectoria</h3>
        </header>
        {file.enrollments.length === 0 ? (
          <p className="px-4 py-5 text-sm text-gray-500">Sin matrículas registradas.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {file.enrollments.map((e, index) => (
              <EnrollmentRow
                key={`${e.schoolYearCode}-${e.courseName}-${index}`}
                enrollment={e}
                canExport={canExport}
                busy={busy}
                onReportCard={(periodId) => void reportCard(periodId)}
              />
            ))}
          </ul>
        )}
      </section>

      {file.evolutionByYear.map((year) => (
        <YearEvolution key={year.schoolYearCode} year={year} history={file.history} />
      ))}

      {decisions.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white">
          <header className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Decisiones de la reunión</h3>
          </header>
          <ul className="divide-y divide-gray-100">
            {decisions.map((d) => (
              <li key={d.id} className="px-4 py-2 text-sm">
                <p className="text-xs font-medium text-gray-600">{d.periodName}</p>
                <p className="whitespace-pre-line text-gray-900">{d.decision}</p>
                <p className="text-[11px] text-gray-500">
                  {d.createdByName ?? 'Sin autor'} · {d.createdAt.slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-gray-500">
        Los indicadores de esta ficha son informativos y de apoyo a la intervención pedagógica. No
        generan por sí solos decisiones administrativas, promociones, repeticiones ni sanciones.
      </p>
    </div>
  )
}
