'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FileText, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { downloadFile } from '@/lib/api/download'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { hasPermission } from '@/lib/auth/permissions'
import { formatHundredths } from '@/lib/academic-config/grade-value'
import { levelStyle } from '@/lib/academic-config/level-tokens'
import { formatAbsenceUnits } from '@/lib/libreta/absences'
import MeetingDecisions from './MeetingDecisions'
import ScrollRegion from '@/components/common/ScrollRegion'

type Group = {
  courseOfferingId: string
  courseName: string
  courseOrientationId: string | null
  orientationName: string | null
  /** EBI / EMS: cada nivel tiene sus propias reuniones. */
  level?: 'EBI' | 'EMS' | null
}

type Period = {
  id: string
  name: string
  level?: 'EBI' | 'EMS' | null
  isMeeting?: boolean
  requiresGeneralGrade?: boolean
  requiresConceptualJudgement?: boolean
}

type Descriptor = { label: string; descriptor: string | null; colorToken: string | null; iconToken: string | null; isAlert: boolean } | null

type Cell = {
  gradeBookId: string
  /** R, el rendimiento: la nota oficial. */
  valueHundredths: number | null
  /** C, la del docente. Se muestra como propuesta mientras no hay R; no promedia. */
  proposedValueHundredths?: number | null
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
  /** Conducta institucional del período, la que pone adscripción. */
  conductValueHundredths?: number | null
  /** Faltas del ciclo en todo el liceo, en centésimos. */
  absenceHundredths?: number
  pendingCount: number
  alertCount: number
  atRisk: boolean
}

type ConductOption = { valueHundredths: number; label: string }

type Matrix = {
  group: { courseName: string; schoolYear: { id?: string; label: string } }
  subjects: Array<{ gradeBookId: string; name: string; teacher: string | null; periodStatus: string | null }>
  students: Row[]
  averageLabel: string
  /** Decimales del promedio. El liceo lo pide con al menos uno: escolaridad y abanderados. */
  averageDecimals?: number
  /** Asignaturas en alerta que marcan al estudiante; `null` si la regla está apagada. */
  alertSubjectsThreshold?: number | null
  /** Tramos de la escala de conducta: rotulan la columna y son las opciones al cargarla. */
  conductLevels?: ConductOption[]
}

function groupKey(g: Group) {
  return `${g.courseOfferingId}::${g.courseOrientationId ?? ''}`
}

function groupLabel(g: Group) {
  return g.orientationName ? `${g.courseName} — ${g.orientationName}` : g.courseName
}

/** Reunión de boletín: pide C y juicio. Es la que tiene boletín para la familia. */
export function isReportCardPeriod(p: Period | undefined): boolean {
  return Boolean(p?.isMeeting && p.requiresGeneralGrade && p.requiresConceptualJudgement)
}

/** Texto de la conducta con la escala; nunca sólo un número suelto ni un color. */
export function conductText(value: number | null | undefined, levels: readonly ConductOption[]): string {
  if (value == null) return '—'
  return levels.find((l) => l.valueHundredths === value)?.label ?? String(value / 100).replace('.', ',')
}

export function reportCardsPath(group: Group, periodId: string): string {
  const params = new URLSearchParams({ courseOfferingId: group.courseOfferingId, periodId })
  if (group.courseOrientationId) params.set('courseOrientationId', group.courseOrientationId)
  return `/admin/gradebook/report-cards?${params}`
}

/**
 * Celda de la matriz: color, símbolo y valor de R. El símbolo evita depender del color (RNF 7.2).
 * Sin R, muestra la calificación que el docente cargó con el sistema anterior (antes de que C
 * pasara a ser la conducta) como propuesta, rotulada con texto y sin color de tramo, porque
 * todavía no es una nota.
 */
function MatrixCell({ cell, decimals }: { cell: Cell; decimals: number }) {
  if (cell.pending) {
    if (cell.proposedValueHundredths != null) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded border border-dashed border-gray-300 px-1.5 py-0.5 text-xs text-gray-600"
          title="Calificación propuesta por el docente; todavía sin rendimiento (R)"
        >
          <span className="text-[10px] uppercase text-gray-400">Prop.</span>
          {formatHundredths(cell.proposedValueHundredths, decimals)}
        </span>
      )
    }
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

function ConductCell({
  row,
  levels,
  editable,
  onChange,
}: {
  row: Row
  levels: readonly ConductOption[]
  editable: boolean
  onChange: (value: number | null) => void
}) {
  if (!editable || levels.length === 0) return <>{conductText(row.conductValueHundredths, levels)}</>
  return (
    <select
      aria-label={`Conducta de ${row.lastName}, ${row.firstName}`}
      value={row.conductValueHundredths ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      className="rounded border border-gray-300 px-1 py-0.5 text-xs"
    >
      <option value="">—</option>
      {levels.map((level) => (
        <option key={level.valueHundredths} value={level.valueHundredths}>
          {level.label}
        </option>
      ))}
    </select>
  )
}

function StudentCell({
  row,
  backTo,
  reportCard,
  busy,
  onReportCard,
}: {
  row: Row
  /** Esta reunión con su grupo y período: la ficha vuelve acá sin hacer elegir todo de nuevo. */
  backTo: string
  /** ¿Se ofrece el boletín? Sólo en reuniones de boletín y con permiso para exportar. */
  reportCard: boolean
  /** Descarga en curso: la de este alumno muestra el spinner y las demás quedan en espera. */
  busy: string | null
  onReportCard: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Link
        href={`/libreta/estudiante/${row.studentId}?volver=${encodeURIComponent(backTo)}`}
        className="text-emerald-700 hover:underline"
      >
        {row.lastName}, {row.firstName}
      </Link>
      {reportCard && (
        <button
          type="button"
          disabled={busy !== null}
          onClick={onReportCard}
          aria-label={`Boletín de ${row.lastName}, ${row.firstName}`}
          title="Descargar el boletín"
          className="text-gray-400 hover:text-emerald-700 disabled:opacity-40"
        >
          {busy === row.studentId ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <FileText className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      )}
    </span>
  )
}

function AlertCell({ row }: { row: Row }) {
  return (
    <>
      {row.atRisk ? (
        <span className="rounded border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-800">
          <span aria-hidden>▲ </span>
          {row.alertCount} en alerta
        </span>
      ) : (
        <span className="text-gray-500">{row.alertCount}</span>
      )}
      {row.pendingCount > 0 && <span className="ml-1 text-gray-500">· {row.pendingCount} pend.</span>}
    </>
  )
}

/** La reunión con su grupo y período en la URL: se puede volver, recargar o compartir el enlace. */
export function meetingUrl(pathname: string, group: Group | null, periodId: string): string {
  const params = new URLSearchParams()
  if (group) params.set('grupo', groupKey(group))
  if (periodId) params.set('periodo', periodId)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

export default function GroupMatrix({ projection = false }: { projection?: boolean }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/libreta/reunion'
  const searchParams = useSearchParams()
  const fromUrl = useRef({ grupo: searchParams?.get('grupo') ?? '', periodo: searchParams?.get('periodo') ?? '' })
  const auth = useOptionalAuth()
  const canExport = hasPermission(auth?.me, 'gradebook.export')
  const canEditConduct = hasPermission(auth?.me, 'gradebook.review', 'all')
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [groups, setGroups] = useState<Group[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [group, setGroup] = useState<Group | null>(null)
  const [periodId, setPeriodId] = useState('')
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
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
        // Lo que venía en la URL (al volver de la ficha, o un enlace compartido).
        const initialGroup = g.data.find((x) => groupKey(x) === fromUrl.current.grupo) ?? null
        if (initialGroup) setGroup(initialGroup)
        if (p.data.some((x) => x.id === fromUrl.current.periodo)) setPeriodId(fromUrl.current.periodo)
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

  const here = meetingUrl(pathname, group, periodId)
  const currentQuery = searchParams?.toString() ?? ''
  useEffect(() => {
    if (loading) return
    const current = currentQuery ? `${pathname}?${currentQuery}` : pathname
    if (here !== current) router.replace(here, { scroll: false })
  }, [here, currentQuery, pathname, loading, router])

  // Sólo las reuniones del nivel del grupo: un período EMS sobre un grupo EBI da una matriz vacía.
  const visiblePeriods = periods.filter((p) => !group?.level || !p.level || p.level === group.level)
  const period = periods.find((p) => p.id === periodId)
  const offersReportCards = canExport && isReportCardPeriod(period)

  function selectGroup(next: Group | null) {
    setGroup(next)
    setMatrix(null)
    const current = periods.find((p) => p.id === periodId)
    if (next?.level && current?.level && current.level !== next.level) setPeriodId('')
  }

  async function download(key: string, path: string, fallbackName: string) {
    setDownloading(key)
    setError(null)
    try {
      await downloadFile(path, fallbackName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo descargar')
    } finally {
      setDownloading(null)
    }
  }

  async function saveConduct(studentId: string, value: number | null) {
    const schoolYearId = matrix?.group.schoolYear.id
    if (!matrix || !schoolYearId) return
    setMatrix({
      ...matrix,
      students: matrix.students.map((row) => (row.studentId === studentId ? { ...row, conductValueHundredths: value } : row)),
    })
    try {
      await api('/admin/gradebook/conduct', {
        method: 'PUT',
        body: JSON.stringify({ schoolYearId, periodId, entries: [{ studentId, valueHundredths: value }] }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la conducta')
      void loadMatrix()
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando grupos…
      </p>
    )
  }

  const conductLevels = matrix?.conductLevels ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 block text-xs text-gray-600">Grupo</span>
          <select
            value={group ? groupKey(group) : ''}
            onChange={(e) => selectGroup(groups.find((g) => groupKey(g) === e.target.value) ?? null)}
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
            {visiblePeriods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
        {matrix && group && offersReportCards && (
          <button
            type="button"
            disabled={downloading !== null}
            onClick={() => void download('group', reportCardsPath(group, periodId), 'boletines.pdf')}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {downloading === 'group' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
            Boletines del grupo
          </button>
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
          <ScrollRegion label="Matriz de calificaciones del grupo" className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
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
                  <th scope="col" className="px-2 py-2 text-left font-medium" title="La pone adscripción, para todo el liceo">
                    Conducta
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium" title="Faltas del ciclo en todo el liceo">
                    Faltas
                  </th>
                  <th scope="col" className="px-2 py-2 text-left font-medium">Alertas</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {matrix.students.map((row) => (
                  <tr key={row.studentId} className={row.atRisk ? 'bg-red-50/40' : undefined}>
                    <td className="sticky left-0 bg-inherit px-3 py-1.5">
                      <StudentCell
                        row={row}
                        backTo={here}
                        reportCard={offersReportCards}
                        busy={downloading}
                        onReportCard={() =>
                          void download(
                            row.studentId,
                            `/admin/gradebook/report-card/${row.studentId}?periodId=${periodId}`,
                            'boletin.pdf',
                          )
                        }
                      />
                    </td>
                    {row.cells.map((cell) => (
                      <td key={cell.gradeBookId} className="px-2 py-1.5">
                        <MatrixCell cell={cell} decimals={0} />
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-gray-700">
                      {formatHundredths(row.averageHundredths, matrix.averageDecimals ?? 1)}
                    </td>
                    <td className="px-2 py-1.5 text-gray-700">
                      <ConductCell
                        row={row}
                        levels={conductLevels}
                        editable={canEditConduct}
                        onChange={(value) => void saveConduct(row.studentId, value)}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-gray-700">
                      {formatAbsenceUnits(row.absenceHundredths ?? 0)}
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      <AlertCell row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>

          <p className="text-xs text-gray-500">
            <strong>{matrix.averageLabel}.</strong> Se calcula con el rendimiento (R); una celda con{' '}
            <span className="rounded border border-dashed border-gray-300 px-1">C</span> es la propuesta del
            docente y todavía no cuenta. No sustituye las decisiones pedagógicas de la reunión de profesores.
            {matrix.alertSubjectsThreshold != null &&
              ` En alerta: ${matrix.alertSubjectsThreshold} o más asignaturas en el tramo de alerta.`}{' '}
            Las alertas son informativas y no generan por sí solas decisiones administrativas.
          </p>

          {/* Juicio de reunión: se carga acá (no en la ficha del alumno ni en el cierre del docente). */}
          {group && periodId && (
            <MeetingDecisions
              courseOfferingId={group.courseOfferingId}
              courseOrientationId={group.courseOrientationId}
              periodId={periodId}
              students={matrix.students}
            />
          )}
        </>
      )}
    </div>
  )
}
