'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, TrendingDown } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatHundredths } from '@/lib/academic-config/grade-value'

type Enrollment = {
  schoolYearCode: number
  schoolYearLabel: string
  courseName: string
  orientationName: string | null
  status: string
}

type Point = { periodCode: string; periodName: string; valueHundredths: number | null }

type SubjectEvolution = { subjectName: string; points: Point[]; sustainedDecline: boolean }

type File = {
  student: { id: string; firstName: string; lastName: string; documentId: string | null; email: string | null }
  enrollments: Enrollment[]
  history: Array<{ subjectName: string; periodName: string; conceptualJudgement: string | null; schoolYearCode: number }>
  evolutionByYear: Array<{ schoolYearCode: number; subjects: SubjectEvolution[] }>
}

/** Ficha académica del estudiante (RF-031). */
export default function StudentFile({ studentId }: { studentId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
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

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando ficha…
      </p>
    )
  }

  if (error || !file) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {error ?? 'No se pudo cargar la ficha'}
      </p>
    )
  }

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

      <section className="rounded-xl border border-gray-200 bg-white">
        <header className="border-b border-gray-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-gray-900">Trayectoria</h3>
        </header>
        {file.enrollments.length === 0 ? (
          <p className="px-4 py-5 text-sm text-gray-500">Sin matrículas registradas.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {file.enrollments.map((e) => (
              <li key={e.schoolYearCode} className="flex flex-wrap items-baseline gap-2 px-4 py-2 text-sm">
                <span className="font-medium text-gray-900">{e.schoolYearLabel}</span>
                <span className="text-gray-700">{e.courseName}</span>
                {e.orientationName && <span className="text-gray-500">— {e.orientationName}</span>}
                <span className="ml-auto text-xs text-gray-500">{e.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {file.evolutionByYear.map((year) => (
        <section key={year.schoolYearCode} className="rounded-xl border border-gray-200 bg-white">
          <header className="border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Evolución {year.schoolYearCode}</h3>
            <p className="text-xs text-gray-500">
              Calificación de cada período por asignatura. Un guion es un período sin datos.
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
        </section>
      ))}

      <p className="text-xs text-gray-500">
        Los indicadores de esta ficha son informativos y de apoyo a la intervención pedagógica. No
        generan por sí solos decisiones administrativas, promociones, repeticiones ni sanciones.
      </p>
    </div>
  )
}
