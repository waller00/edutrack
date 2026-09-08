'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Presentation } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'

type Group = {
  courseOfferingId: string
  courseName: string
  courseOrientationId: string | null
  orientationName: string | null
}

type Period = { id: string; name: string }

type Descriptor = { label: string; descriptor: string | null; colorToken: string | null; iconToken: string | null; isAlert: boolean } | null

type Cell = {
  gradeBookId: string
  valueHundredths: number | null
  conceptualJudgement: string | null
  descriptor: Descriptor
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED' | null
  pending: boolean
}

type Row = {
  studentId: string
  lastName: string
  firstName: string
  cells: Cell[]
  averageHundredths: number | null
  pendingCount: number
  alertCount: number
  atRisk: boolean
}

type Matrix = {
  group: { courseName: string; schoolYear: { label: string } }
  subjects: Array<{ gradeBookId: string; name: string; teacher: string | null; periodStatus: string | null }>
  students: Row[]
  averageLabel: string
}

function groupKey(g: Group) {
  return `${g.courseOfferingId}::${g.courseOrientationId ?? ''}`
}

function groupLabel(g: Group) {
  return g.orientationName ? `${g.courseName} — ${g.orientationName}` : g.courseName
}

/** Celda de la matriz: color, símbolo y valor. El símbolo evita depender del color (RNF 7.2). */
function MatrixCell({ cell, decimals }: { cell: Cell; decimals: number }) {
  if (cell.pending) {
    return <span className="text-xs text-gray-400" title="Sin calificación del período">—</span>
  }
  const style = cell.descriptor ? levelStyle(cell.descriptor) : null
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${style?.badgeClass ?? 'bg-gray-50 text-gray-700'}`}
      title={[cell.descriptor?.label, cell.conceptualJudgement].filter(Boolean).join(' — ') || undefined}
    >
      {style && <span aria-hidden>{style.symbol}</span>}
      {formatHundredths(cell.valueHundredths, decimals)}
    </span>
  )
}

export default function GroupMatrix({ projection = false }: { projection?: boolean }) {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [groups, setGroups] = useState<Group[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [group, setGroup] = useState<Group | null>(null)
  const [periodId, setPeriodId] = useState('')
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [g, p] = await Promise.all([
          api<{ data: Group[] }>(withSchoolYear('/admin/gradebook/groups', query)),
          api<{ data: Period[] }>(withSchoolYear('/admin/gradebook/periods', query)),
        ])
        setGroups(g.data)
        setPeriods(p.data)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'No se pudieron cargar los grupos')
      } finally {
        setLoading(false)
      }
    })()
  }, [query])

  const loadMatrix = useCallback(async () => {
    if (!group || !periodId) return
    setError(null)
    try {
      const params = new URLSearchParams({ courseOfferingId: group.courseOfferingId, periodId })
      if (group.courseOrientationId) params.set('courseOrientationId', group.courseOrientationId)
      setMatrix(await api<Matrix>(`/admin/gradebook/group-matrix?${params}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la matriz')
    }
  }, [group, periodId])

  useEffect(() => {
    void loadMatrix()
  }, [loadMatrix])

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando grupos…
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 block text-xs text-gray-600">Grupo</span>
          <select
            value={group ? groupKey(group) : ''}
            onChange={(e) => setGroup(groups.find((g) => groupKey(g) === e.target.value) ?? null)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Elegí un grupo…</option>
            {groups.map((g) => (
              <option key={groupKey(g)} value={groupKey(g)}>{groupLabel(g)}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs text-gray-600">Período</span>
          <select
            value={periodId}
            onChange={(e) => setPeriodId(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="">Elegí un período…</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {!projection && matrix && (
          <Link
            href="/libreta/reunion"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <Presentation className="h-4 w-4" aria-hidden />
            Modo reunión
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {!matrix ? (
        <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          Elegí un grupo y un período para ver la matriz.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className={`w-full ${projection ? 'text-base' : 'text-sm'}`}>
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="sticky left-0 bg-white px-3 py-2 text-left font-medium">Estudiante</th>
                  {matrix.subjects.map((s) => (
                    <th key={s.gradeBookId} scope="col" className="px-2 py-2 text-left font-medium" title={s.teacher ?? undefined}>
                      {s.name}
                    </th>
                  ))}
                  <th scope="col" className="px-2 py-2 text-left font-medium" title={matrix.averageLabel}>
                    Promedio
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matrix.students.map((row) => (
                  <tr key={row.studentId} className={row.atRisk ? 'bg-red-50/40' : undefined}>
                    <td className="sticky left-0 bg-inherit px-3 py-1.5">
                      <Link href={`/libreta/estudiante/${row.studentId}`} className="text-emerald-700 hover:underline">
                        {row.lastName}, {row.firstName}
                      </Link>
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.gradeBookId} className="px-2 py-1.5">
                        <MatrixCell cell={cell} decimals={0} />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-gray-700">{formatHundredths(row.averageHundredths, 1)}</td>
                    <td className="px-2 py-1.5 text-xs">
                      {row.atRisk ? (
                        <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-800">
                          <span aria-hidden>▲ </span>
                          {row.alertCount} en alerta
                        </span>
                      ) : (
                        <span className="text-gray-500">{row.alertCount}</span>
                      )}
                      {row.pendingCount > 0 && (
                        <span className="ml-1 text-gray-500">· {row.pendingCount} pend.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-500">
            <strong>{matrix.averageLabel}.</strong> No sustituye las decisiones pedagógicas de la reunión
            de profesores. Las alertas son informativas y no generan por sí solas decisiones
            administrativas.
          </p>
        </>
      )}
    </div>
  )
}
