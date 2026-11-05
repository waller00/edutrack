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
import {
  filterMeetingRows,
  levelLegend,
  meetingFilters,
  meetingTally,
  saveErrorText,
  type JudgementState,
  type MeetingField,
  type MeetingFilter,
} from '@/lib/gradebook/meeting-board'
import MeetingDecisions, { type JudgementFocus } from './MeetingDecisions'
import MeetingSummary from './meeting/MeetingSummary'
import MatrixTable, { saveKey } from './meeting/MatrixTable'
import type { Matrix, MatrixRow, SaveStatus } from './meeting/types'

export { conductText } from '@/components/gradebook/ConductSelect'

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

/** La reunión con su grupo y período en la URL: se puede volver, recargar o compartir el enlace. */
export function meetingUrl(pathname: string, group: Group | null, periodId: string): string {
  const params = new URLSearchParams()
  if (group) params.set('grupo', groupKey(group))
  if (periodId) params.set('periodo', periodId)
  const qs = params.toString()
  return qs ? `${pathname}?${qs}` : pathname
}

const FIELD_PATH: Record<MeetingField, string> = {
  performance: '/admin/gradebook/meeting-performance',
  conduct: '/admin/gradebook/conduct',
}

const FIELD_OF: Record<MeetingField, 'performanceValueHundredths' | 'conductValueHundredths'> = {
  performance: 'performanceValueHundredths',
  conduct: 'conductValueHundredths',
}

function saveBody(field: MeetingField, schoolYearId: string, periodId: string, studentId: string, value: number | null) {
  if (field === 'performance') return { schoolYearId, periodId, studentId, valueHundredths: value }
  return { schoolYearId, periodId, entries: [{ studentId, valueHundredths: value }] }
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
        <strong>{matrix.averageLabel}.</strong> El promedio sale de las R y es una referencia: el{' '}
        <strong>rendimiento</strong> lo elige la reunión, y es el que va al boletín con la conducta y el juicio. Las
        alertas son informativas y no generan por sí solas decisiones administrativas.
      </p>
    </div>
  )
}

export default function GroupMatrix({ projection = false }: { projection?: boolean }) {
  const router = useRouter()
  const pathname = usePathname() ?? '/libreta/reunion'
  const searchParams = useSearchParams()
  const fromUrl = useRef({ grupo: searchParams?.get('grupo') ?? '', periodo: searchParams?.get('periodo') ?? '' })
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
  const [saves, setSaves] = useState<Record<string, SaveStatus>>({})
  const [filter, setFilter] = useState<MeetingFilter>('all')
  const [judgements, setJudgements] = useState<JudgementState>(null)
  const [focus, setFocus] = useState<JudgementFocus | null>(null)

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
    setSaves({})
    setJudgements(null)
    setMatrixLoading(true)
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

  const tally = useMemo(
    () => (matrix ? meetingTally(matrix.students, matrix.subjects, judgements) : null),
    [matrix, judgements],
  )
  const numberOf = useMemo(
    () => new Map((matrix?.students ?? []).map((row, index) => [row.studentId, index + 1])),
    [matrix],
  )
  const onJudgementsChange = useCallback((state: { studentIds: Set<string>; group: boolean }) => setJudgements(state), [])

  function selectGroup(next: Group | null) {
    setGroup(next)
    setMatrix(null)
    setFilter('all')
    setFocus(null)
    const current = periods.find((p) => p.id === periodId)
    if (next?.level && current?.level && current.level !== next.level) setPeriodId('')
  }

  function selectPeriod(next: string) {
    setPeriodId(next)
    setMatrix(null)
    setFilter('all')
    setFocus(null)
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

  function patchRow(studentId: string, field: MeetingField, value: number | null) {
    setMatrix((prev) =>
      prev && {
        ...prev,
        students: prev.students.map((row) => (row.studentId === studentId ? { ...row, [FIELD_OF[field]]: value } : row)),
      },
    )
  }

  /**
   * Guarda un casillero de la reunión. Si el servidor lo rechaza, vuelve al valor anterior y dice
   * qué no se guardó y por qué: antes recargaba la matriz, que borraba el error, y el rendimiento
   * elegido volvía a «—» sin explicación.
   */
  async function saveField(field: MeetingField, row: MatrixRow, value: number | null) {
    const key = saveKey(field, row.studentId)
    const schoolYearId = matrix?.group.schoolYear.id
    if (!schoolYearId) {
      setSaves((s) => ({ ...s, [key]: 'error' }))
      setError(saveErrorText(field, row, 'Falta el ciclo lectivo del grupo: recargá la página.'))
      return
    }
    const previous = row[FIELD_OF[field]] ?? null
    patchRow(row.studentId, field, value)
    setSaves((s) => ({ ...s, [key]: 'saving' }))
    try {
      await api(FIELD_PATH[field], {
        method: 'PUT',
        body: JSON.stringify(saveBody(field, schoolYearId, periodId, row.studentId, value)),
      })
      setSaves((s) => ({ ...s, [key]: 'saved' }))
    } catch (err) {
      patchRow(row.studentId, field, previous)
      setSaves((s) => ({ ...s, [key]: 'error' }))
      setError(saveErrorText(field, row, err instanceof Error ? err.message : ''))
    }
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
                rows={filterMeetingRows(matrix.students, filter, judgements)}
                numberOf={numberOf}
                projection={projection}
                backTo={here}
                canEdit={canEdit}
                judgements={judgements}
                reportCard={offersReportCards}
                downloading={downloading}
                saves={saves}
                onReportCard={(row) =>
                  void download(row.studentId, `/admin/gradebook/report-card/${row.studentId}?periodId=${periodId}`, 'boletin.pdf')
                }
                onSave={(field, row, value) => void saveField(field, row, value)}
                onOpenJudgement={openJudgement}
              />
              <MatrixLegend matrix={matrix} />
            </>
          )}

          {/* Juicio de reunión: se carga acá (no en la ficha del alumno ni en el cierre del docente). */}
          {group && periodId && (
            <MeetingDecisions
              courseOfferingId={group.courseOfferingId}
              courseOrientationId={group.courseOrientationId}
              periodId={periodId}
              students={matrix.students}
              onJudgementsChange={onJudgementsChange}
              focus={focus}
            />
          )}
        </>
      )}
    </div>
  )
}
