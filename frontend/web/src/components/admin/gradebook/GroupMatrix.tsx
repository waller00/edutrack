'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { FileText, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { downloadFile } from '@/lib/api/download'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { hasPermission } from '@/lib/auth/permissions'
import { filterMeetingRows, levelLegend, meetingFilters, meetingTally, type MeetingFilter } from '@/lib/gradebook/meeting-board'
import { neighbors } from '@/lib/gradebook/meeting-student'
import MeetingDecisions, { type JudgementFocus } from './MeetingDecisions'
import MeetingSummary from './meeting/MeetingSummary'
import MatrixTable from './meeting/MatrixTable'
import StudentMeetingPanel from './meeting/StudentMeetingPanel'
import { useMeetingRecords } from './meeting/useMeetingRecords'
import { useMeetingStudent } from './meeting/useMeetingStudent'
import type { Matrix } from './meeting/types'

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

export function reportCardsPath(group: Group, periodId: string): string {
  const params = new URLSearchParams({ courseOfferingId: group.courseOfferingId, periodId })
  if (group.courseOrientationId) params.set('courseOrientationId', group.courseOrientationId)
  return `/admin/gradebook/report-cards?${params}`
}

/** El alumno del panel abierto y, si se tocó una nota, su materia. */
export type OpenStudent = { studentId: string; gradeBookId: string | null }

/**
 * La reunión con su grupo, período y el panel del alumno abierto en la URL: se puede volver de la
 * ficha, recargar o compartir el enlace y queda donde estaba.
 */
export function meetingUrl(pathname: string, group: Group | null, periodId: string, open: OpenStudent | null = null): string {
  const params = new URLSearchParams()
  if (group) params.set('grupo', groupKey(group))
  if (periodId) params.set('periodo', periodId)
  if (open) params.set('alumno', open.studentId)
  if (open?.gradeBookId) params.set('materia', open.gradeBookId)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

/** El grupo y la reunión que se trabajan; arriba de todo, para cambiar de grupo sin volver a buscar. */
function MeetingFilters({
  groups,
  periods,
  group,
  periodId,
  onGroup,
  onPeriod,
  boletines,
}: Readonly<{
  groups: Group[]
  periods: Period[]
  group: Group | null
  periodId: string
  onGroup: (group: Group | null) => void
  onPeriod: (periodId: string) => void
  boletines: ReactNode
}>) {
  return (
    <div data-tour="reunion.filters" className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3">
      <label>
        <span className="mb-1 block text-xs font-medium text-gray-600">Grupo</span>
        <select
          value={group ? groupKey(group) : ''}
          onChange={(e) => onGroup(groups.find((g) => groupKey(g) === e.target.value) ?? null)}
          className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
        >
          <option value="">Elegí un grupo…</option>
          {groups.map((g) => (
            <option key={groupKey(g)} value={groupKey(g)}>{groupLabel(g)}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="mb-1 block text-xs font-medium text-gray-600">Período</span>
        <select value={periodId} onChange={(e) => onPeriod(e.target.value)} className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm">
          <option value="">Elegí un período…</option>
          {periods.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </label>
      {boletines}
    </div>
  )
}

function FilterBar({
  options,
  value,
  onChange,
}: Readonly<{ options: ReturnType<typeof meetingFilters>; value: MeetingFilter; onChange: (filter: MeetingFilter) => void }>) {
  return (
    <div role="group" aria-label="Mostrar" className="inline-flex flex-wrap gap-1 rounded-lg border border-gray-200 bg-white p-1">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-md px-2.5 py-1 text-sm ${
            value === option.id ? 'bg-emerald-600 font-medium text-white' : 'text-gray-700 hover:bg-gray-100'
          }`}
        >
          {option.label} <span className={value === option.id ? 'text-emerald-50' : 'text-gray-500'}>({option.count})</span>
        </button>
      ))}
    </div>
  )
}

/** Qué quiere decir cada marca de la matriz: los tramos a la vista, la propuesta y el promedio. */
function MatrixLegend({ matrix }: Readonly<{ matrix: Matrix }>) {
  const legend = levelLegend(matrix.students.flatMap((row) => row.cells))
  return (
    <div className="space-y-1.5 text-xs text-gray-600">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {legend.length > 0 && <span className="font-medium text-gray-700">Tramos:</span>}
        {legend.map((item) => (
          <span key={item.label} className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${item.badgeClass}`}>
            <span aria-hidden>{item.symbol}</span>
            {item.label}
            {item.isAlert && ' (alerta)'}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <span className="rounded border border-dashed border-gray-300 px-1 text-gray-500">Prop.</span>
          propuesta del docente, todavía sin R
        </span>
        <span>· — sin nota</span>
      </p>
      <p>
        <strong>{matrix.averageLabel}.</strong> El promedio sale de las R de cada materia y es una referencia. La
        reunión decide el <strong>juicio</strong> de cada alumno, que va a su boletín; R y C son de cada materia. Las
        alertas son informativas y no generan por sí solas decisiones administrativas.
      </p>
    </div>
  )
}

export default function GroupMatrix({ projection = false }: { projection?: boolean }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/libreta/reunion'
  const searchParams = useSearchParams()
  const fromUrl = useRef({
    grupo: searchParams?.get('grupo') ?? '',
    periodo: searchParams?.get('periodo') ?? '',
    alumno: searchParams?.get('alumno') ?? '',
    materia: searchParams?.get('materia') ?? '',
  })
  const auth = useOptionalAuth()
  const canExport = hasPermission(auth?.me, 'gradebook.export')
  const canEdit = hasPermission(auth?.me, 'gradebook.review', 'all')
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [groups, setGroups] = useState<Group[]>([])
  const [periods, setPeriods] = useState<Period[]>([])
  const [group, setGroup] = useState<Group | null>(null)
  const [periodId, setPeriodId] = useState('')
  const [matrix, setMatrix] = useState<Matrix | null>(null)
  const [matrixLoading, setMatrixLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<MeetingFilter>('all')
  const [focus, setFocus] = useState<JudgementFocus | null>(null)
  const [openStudent, setOpenStudent] = useState<OpenStudent | null>(null)
  const meetingScope = useMemo(
    () => (group && periodId ? { courseOfferingId: group.courseOfferingId, courseOrientationId: group.courseOrientationId, periodId } : null),
    [group, periodId],
  )
  const records = useMeetingRecords(meetingScope)
  const judgements = records.judgements
  const { detail, retry, refresh } = useMeetingStudent(meetingScope, openStudent?.studentId ?? null)

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

  /** `quiet`: después de una corrección se relee sin «cargando», con la matriz a la vista. */
  const loadMatrix = useCallback(async (quiet = false) => {
    if (!group || !periodId) return
    if (!quiet) {
      setError(null)
      setMatrixLoading(true)
    }
    try {
      const params = new URLSearchParams({ courseOfferingId: group.courseOfferingId, periodId })
      if (group.courseOrientationId) params.set('courseOrientationId', group.courseOrientationId)
      setMatrix(await api<Matrix>(`/admin/gradebook/group-matrix?${params}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la matriz')
    } finally {
      setMatrixLoading(false)
    }
  }, [group, periodId])

  useEffect(() => {
    void loadMatrix()
  }, [loadMatrix])

  // El panel que venía en la URL (al volver de la ficha) se abre cuando llega la matriz.
  useEffect(() => {
    const alumno = fromUrl.current.alumno
    if (!matrix || !alumno) return
    fromUrl.current.alumno = ''
    if (matrix.students.some((row) => row.studentId === alumno)) {
      setOpenStudent({ studentId: alumno, gradeBookId: fromUrl.current.materia || null })
    }
  }, [matrix])

  const here = meetingUrl(pathname, group, periodId, openStudent)
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

  const tally = useMemo(
    () => (matrix ? meetingTally(matrix.students, matrix.subjects, judgements) : null),
    [matrix, judgements],
  )
  const numberOf = useMemo(
    () => new Map((matrix?.students ?? []).map((row, index) => [row.studentId, index + 1])),
    [matrix],
  )
  const visibleRows = useMemo(
    () => (matrix ? filterMeetingRows(matrix.students, filter, judgements) : []),
    [matrix, filter, judgements],
  )
  const openRow = matrix?.students.find((row) => row.studentId === openStudent?.studentId) ?? null
  const around = openRow && matrix ? neighbors(visibleRows, matrix.students, openRow.studentId) : { previous: null, next: null }
  const closePanel = useCallback(() => setOpenStudent(null), [])

  function selectGroup(next: Group | null) {
    setGroup(next)
    setMatrix(null)
    setFilter('all')
    setFocus(null)
    setOpenStudent(null)
    const current = periods.find((p) => p.id === periodId)
    if (next?.level && current?.level && current.level !== next.level) setPeriodId('')
  }

  function selectPeriod(next: string) {
    setPeriodId(next)
    setMatrix(null)
    setFilter('all')
    setFocus(null)
    setOpenStudent(null)
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

  /** Una corrección cambia notas: el detalle del alumno y la matriz (R, promedio, alertas). */
  function afterCorrection() {
    refresh()
    void loadMatrix(true)
  }

  function openJudgement(studentId: string, edit: boolean) {
    setFocus((prev) => ({ studentId, edit, nonce: (prev?.nonce ?? 0) + 1 }))
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando grupos…
      </p>
    )
  }

  const boletines = matrix && group && offersReportCards && (
    <button
      type="button"
      disabled={downloading !== null}
      onClick={() => void download('group', reportCardsPath(group, periodId), 'boletines.pdf')}
      className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
    >
      {downloading === 'group' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <FileText className="h-4 w-4" aria-hidden />}
      Boletines del grupo
    </button>
  )

  return (
    <div className="space-y-4">
      <MeetingFilters
        groups={groups}
        periods={visiblePeriods}
        group={group}
        periodId={periodId}
        onGroup={selectGroup}
        onPeriod={selectPeriod}
        boletines={boletines}
      />

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {!matrix || !tally ? (
        <p className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
          {matrixLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          {matrixLoading ? 'Cargando la matriz…' : 'Elegí un grupo y un período para ver la matriz.'}
        </p>
      ) : (
        <>
          <MeetingSummary tally={tally} judgements={judgements} alertSubjectsThreshold={matrix.alertSubjectsThreshold ?? null} />

          {matrix.students.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white px-4 py-6 text-sm text-gray-500">
              El grupo no tiene estudiantes matriculados en este período.
            </p>
          ) : (
            <>
              <FilterBar options={meetingFilters(tally)} value={filter} onChange={setFilter} />
              <MatrixTable
                matrix={matrix}
                rows={visibleRows}
                numberOf={numberOf}
                projection={projection}
                canEdit={canEdit}
                judgements={judgements}
                reportCard={offersReportCards}
                downloading={downloading}
                onReportCard={(row) =>
                  void download(row.studentId, `/admin/gradebook/report-card/${row.studentId}?periodId=${periodId}`, 'boletin.pdf')
                }
                onOpenJudgement={openJudgement}
                onOpenStudent={(studentId, gradeBookId) => setOpenStudent({ studentId, gradeBookId })}
                activeStudentId={openStudent?.studentId ?? null}
              />
              <MatrixLegend matrix={matrix} />
            </>
          )}

          {/* Juicio de reunión: se carga acá (no en la ficha del alumno ni en el cierre del docente). */}
          {group && periodId && <MeetingDecisions records={records} students={matrix.students} focus={focus} />}

          {group && (
            <StudentMeetingPanel
              open={openStudent !== null}
              row={openRow}
              number={openRow ? numberOf.get(openRow.studentId) : undefined}
              detail={detail}
              onRetry={retry}
              focusGradeBookId={openStudent?.gradeBookId ?? null}
              previous={around.previous}
              next={around.next}
              onNavigate={(studentId) => setOpenStudent((prev) => ({ studentId, gradeBookId: prev?.gradeBookId ?? null }))}
              onClose={closePanel}
              matrix={matrix}
              canEdit={canEdit}
              onCorrected={afterCorrection}
              records={records}
              fichaHref={openRow ? `/libreta/estudiante/${openRow.studentId}?volver=${encodeURIComponent(here)}` : ''}
              projection={projection}
              groupLabel={groupLabel(group)}
            />
          )}
        </>
      )}
    </div>
  )
}
