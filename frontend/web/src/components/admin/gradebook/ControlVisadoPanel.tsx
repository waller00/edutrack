'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { hasPermission } from '@/lib/auth/permissions'
import {
  endorsementAbilities,
  readyToEndorse,
  type EndorsementAbilities,
  type EndorsementRow,
} from '@/lib/gradebook/endorsements'
import {
  groupByLevel,
  lastClosedMeeting,
  LEVEL_LABEL,
  MEETING_PERIODS_PATH,
  nextMeeting,
  type MeetingPeriod,
} from '@/lib/gradebook/report-card-periods'
import { todayYmdUruguay } from '@/lib/libreta/absence-day'
import CompletenessPanel, { completenessPath, isDone, type CompletenessRow } from './CompletenessPanel'
import EndorsementGrid, { endorsementGridPath } from './EndorsementGrid'

export type Step = 'carga' | 'cierre' | 'visado'

const STEPS: readonly Step[] = ['carga', 'cierre', 'visado']

const STEP_LABELS: Record<Step, string> = { carga: 'Carga', cierre: 'Cierre', visado: 'Visado' }

const STEP_HINTS: Record<Step, string> = {
  carga: 'Antes de la reunión: qué le falta cargar a cada docente, con aviso.',
  cierre: 'Después de la reunión: quién no cerró el período. Lo que se cierra pasa a Visado.',
  visado: 'Lo cerrado, para observarlo y visarlo. Observar es de Adscripción y Dirección; visar, sólo de Dirección.',
}

type Group = {
  courseOfferingId: string
  courseName: string
  courseOrientationId: string | null
  orientationName: string | null
  level?: string | null
}

export type StepCounts = { carga: number; cierre: number; ready: number; observed: number }

function isStep(value: string | null | undefined): value is Step {
  return STEPS.includes(value as Step)
}

function groupKey(g: Group) {
  return `${g.courseOfferingId}::${g.courseOrientationId ?? ''}`
}

function groupLabel(g: Group) {
  return g.orientationName ? `${g.courseName} — ${g.orientationName}` : g.courseName
}

/**
 * Con qué paso abre. Dirección, que visa y no reabre, en Visado: es lo suyo. Adscripción y
 * Administración (que también puede visar, pero es quien reabre y le avisa al docente), en Carga.
 */
export function defaultStep(abilities: EndorsementAbilities): Step {
  return abilities.canEndorse && !abilities.canReopen ? 'visado' : 'carga'
}

/**
 * La reunión con la que abre: para cargar, la que viene; para cerrar o visar, la última que pasó.
 * Se elige entre las de boletín, que son las que tienen los tres pasos.
 */
export function defaultMeeting(meetings: readonly MeetingPeriod[], step: Step, todayYmd: string): MeetingPeriod | null {
  const reportCards = meetings.filter((m) => m.reportCard)
  const pool = reportCards.length > 0 ? reportCards : meetings
  return step === 'carga' ? nextMeeting(pool, todayYmd) : lastClosedMeeting(pool, todayYmd)
}

/** Lo que le queda a cada paso, en texto: el número solo no dice de qué es. */
export function stepSummary(step: Step, counts: StepCounts): string {
  if (step === 'carga') return counts.carga === 0 ? 'Al día' : `${counts.carga} con faltantes`
  if (step === 'cierre') return counts.cierre === 0 ? 'Todas cerradas' : `${counts.cierre} sin cerrar`
  const parts: string[] = []
  if (counts.ready > 0) parts.push(`${counts.ready} para visar`)
  if (counts.observed > 0) parts.push(counts.observed === 1 ? '1 observada' : `${counts.observed} observadas`)
  return parts.length > 0 ? parts.join(' · ') : 'Nada pendiente'
}

/** Cuánto le queda a cada paso en la reunión elegida (el visado puede traer también otras). */
export function stepCounts(
  control: readonly CompletenessRow[],
  endorsements: readonly EndorsementRow[],
  periodId: string,
): StepCounts {
  const meetingRows = endorsements.filter((row) => row.period.id === periodId)
  return {
    carga: control.filter((row) => !isDone(row, 'before')).length,
    cierre: control.filter((row) => !isDone(row, 'after')).length,
    ready: readyToEndorse(meetingRows).length,
    observed: meetingRows.filter((row) => row.overallStatus !== 'ENDORSED' && row.blockingSections.length > 0).length,
  }
}

const NO_ROWS: readonly never[] = []

type Rows<T> = { rows: readonly T[]; loading: boolean; error: string | null; reload: () => Promise<void> }

/**
 * Las filas de un listado; sin ruta, ninguna. Una respuesta vieja nunca pisa a la nueva, y
 * mientras no llegaron las de la ruta actual no se muestran las de la anterior.
 */
function useRows<T>(path: string | null, failure: string): Rows<T> {
  const [result, setResult] = useState<{ path: string | null; rows: readonly T[]; error: string | null }>({
    path: null,
    rows: NO_ROWS,
    error: null,
  })
  const [reloading, setReloading] = useState(false)
  const latest = useRef(0)

  const reload = useCallback(async () => {
    const request = ++latest.current
    if (!path) {
      setResult({ path: null, rows: NO_ROWS, error: null })
      return
    }
    setReloading(true)
    try {
      const res = await api<{ data: T[] }>(path)
      if (request === latest.current) setResult({ path, rows: res.data, error: null })
    } catch (err) {
      if (request === latest.current) {
        setResult({ path, rows: NO_ROWS, error: err instanceof Error ? err.message : failure })
      }
    } finally {
      if (request === latest.current) setReloading(false)
    }
  }, [path, failure])

  useEffect(() => {
    void reload()
  }, [reload])

  const stale = result.path !== path
  return {
    rows: stale ? NO_ROWS : result.rows,
    loading: path !== null && (reloading || stale),
    error: stale ? null : result.error,
    reload,
  }
}

function MeetingFilters({
  meetings,
  periodId,
  onMeetingChange,
  groups,
  group,
  onGroupChange,
}: {
  meetings: readonly MeetingPeriod[]
  periodId: string
  onMeetingChange: (id: string) => void
  groups: readonly Group[]
  group: Group | null
  onGroupChange: (group: Group | null) => void
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-600">Reunión</span>
        <select className="select-field" value={periodId} onChange={(e) => onMeetingChange(e.target.value)}>
          {groupByLevel(meetings).map(([level, options]) => (
            <optgroup key={level} label={LEVEL_LABEL[level] ?? level}>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="mb-1 block text-xs text-gray-600">Grupo</span>
        <select
          className="select-field"
          value={group ? groupKey(group) : ''}
          onChange={(e) => onGroupChange(groups.find((g) => groupKey(g) === e.target.value) ?? null)}
        >
          <option value="">Todos</option>
          {groups.map((g) => (
            <option key={groupKey(g)} value={groupKey(g)}>
              {groupLabel(g)}
            </option>
          ))}
        </select>
      </label>
    </div>
  )
}

function StepTabs({
  steps,
  active,
  summaries,
  onChange,
}: {
  steps: readonly Step[]
  active: Step
  summaries: Record<Step, string>
  onChange: (step: Step) => void
}) {
  return (
    <div role="tablist" aria-label="Pasos de la reunión" className="flex flex-wrap gap-1 border-b border-gray-200">
      {steps.map((step, index) => {
        const selected = step === active
        return (
          <button
            key={step}
            type="button"
            role="tab"
            id={`paso-${step}`}
            aria-selected={selected}
            aria-controls="paso-actual"
            onClick={() => onChange(step)}
            className={`-mb-px border-b-2 px-3 py-2 text-left ${
              selected ? 'border-emerald-600' : 'border-transparent hover:border-gray-300'
            }`}
          >
            <span className={`block text-sm font-medium ${selected ? 'text-emerald-800' : 'text-gray-700'}`}>
              {index + 1}. {STEP_LABELS[step]}
            </span>
            <span className="block text-xs text-gray-600">{summaries[step]}</span>
          </button>
        )
      })}
    </div>
  )
}

function summaryOf(source: Rows<unknown>, text: string): string {
  if (source.loading) return 'Revisando…'
  return source.error ? 'No se pudo revisar' : text
}

/**
 * Control y visado de libretas: una reunión de punta a punta, en tres pasos que comparten la
 * reunión y el grupo de arriba. Carga y Cierre controlan al docente y le avisan; en Visado,
 * Adscripción observa y Dirección visa. Cada paso dice cuánto le queda, así se ve de un vistazo en
 * qué está la reunión. El paso va en la URL (`?paso=`): `/libreta/visado` redirige al de visado.
 */
export default function ControlVisadoPanel() {
  const me = useOptionalAuth()?.me ?? null
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const schoolYear = useOptionalAdminSchoolYear()
  // Mientras el contexto carga el ciclo, la consulta saldría sin él y se repetiría después.
  const yearReady = !(schoolYear?.loading ?? false)
  const query = schoolYear?.schoolYearScopedQuery ?? ''

  const abilities = useMemo(() => endorsementAbilities(me), [me])
  // Carga y Cierre son del control (`gradebook.review`); sin él, sólo el visado.
  const canControl = hasPermission(me, 'gradebook.review', 'all')

  const [meetings, setMeetings] = useState<MeetingPeriod[] | null>(null)
  const [meetingsError, setMeetingsError] = useState<string | null>(null)
  const [groups, setGroups] = useState<Group[]>([])
  const [periodId, setPeriodId] = useState('')
  const [group, setGroup] = useState<Group | null>(null)
  const [pendingOnly, setPendingOnly] = useState(true)
  const [allMeetings, setAllMeetings] = useState(false)

  const meeting = meetings?.find((m) => m.id === periodId) ?? null
  // Las reuniones que no son de boletín (exámenes, APE) no tienen carga ni cierre que controlar.
  const withControl = canControl && (meeting?.reportCard ?? true)
  const steps: readonly Step[] = withControl ? STEPS : ['visado']
  const requested = params?.get('paso')
  const preferred = isStep(requested) ? requested : defaultStep(abilities)
  const active: Step = steps.includes(preferred) ? preferred : steps[0]
  // La reunión inicial depende del paso con el que se abrió, no de los que se recorren después.
  const [openingStep] = useState<Step>(active)

  useEffect(() => {
    if (!yearReady) return
    let cancelled = false
    setMeetings(null)
    setMeetingsError(null)
    Promise.all([
      api<{ data: MeetingPeriod[] }>(withSchoolYear(MEETING_PERIODS_PATH, query)),
      api<{ data: Group[] }>(withSchoolYear('/admin/gradebook/groups', query)).catch(() => ({ data: [] as Group[] })),
    ])
      .then(([periodsRes, groupsRes]) => {
        if (cancelled) return
        setMeetings(periodsRes.data)
        setGroups(groupsRes.data)
        // Al cambiar de ciclo, la reunión y el grupo elegidos dejan de existir. El día es el civil
        // de Uruguay: `toISOString()` da el día siguiente después de las 21 h.
        setPeriodId((current) =>
          periodsRes.data.some((m) => m.id === current)
            ? current
            : (defaultMeeting(periodsRes.data, openingStep, todayYmdUruguay())?.id ?? ''),
        )
        setGroup((current) => (current && groupsRes.data.some((g) => groupKey(g) === groupKey(current)) ? current : null))
      })
      .catch(() => {
        if (cancelled) return
        setMeetings([])
        setMeetingsError('No se pudieron cargar las reuniones')
      })
    return () => {
      cancelled = true
    }
  }, [yearReady, query, openingStep])

  const control = useRows<CompletenessRow>(
    yearReady && periodId && withControl ? completenessPath(periodId, group) : null,
    'No se pudo cargar el control',
  )
  const endorsements = useRows<EndorsementRow>(
    yearReady && (periodId || allMeetings)
      ? withSchoolYear(endorsementGridPath({ periodId: allMeetings ? '' : periodId, group, pendingOnly }), query)
      : null,
    'No se pudo cargar el visado',
  )

  if (meetingsError) {
    return (
      <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
        {meetingsError}
      </p>
    )
  }
  if (meetings === null) {
    return (
      <p className="flex items-center gap-2 py-6 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando reuniones…
      </p>
    )
  }
  if (meetings.length === 0) {
    return (
      <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
        Este ciclo no tiene reuniones. Se definen en Configuración de libreta.
      </p>
    )
  }

  const counts = stepCounts(control.rows, endorsements.rows, periodId)
  const summaries: Record<Step, string> = {
    carga: summaryOf(control, stepSummary('carga', counts)),
    cierre: summaryOf(control, stepSummary('cierre', counts)),
    visado: summaryOf(endorsements, stepSummary('visado', counts)),
  }
  // Un grupo de otro nivel no tiene libretas en la reunión elegida.
  const levelGroups = groups.filter((g) => !meeting?.level || !g.level || g.level === meeting.level)

  function chooseMeeting(id: string) {
    setPeriodId(id)
    const next = meetings?.find((m) => m.id === id)
    if (group?.level && next?.level && group.level !== next.level) setGroup(null)
  }

  async function reloadAll() {
    // Reabrir desde el visado devuelve la libreta a Cierre: se recuentan los dos pasos.
    await Promise.all([endorsements.reload(), control.reload()])
  }

  return (
    <div className="space-y-4">
      <MeetingFilters
        meetings={meetings}
        periodId={periodId}
        onMeetingChange={chooseMeeting}
        groups={levelGroups}
        group={group}
        onGroupChange={setGroup}
      />

      {steps.length > 1 && (
        <StepTabs
          steps={steps}
          active={active}
          summaries={summaries}
          onChange={(step) => router.replace(`${pathname ?? '/libreta/control'}?paso=${step}`, { scroll: false })}
        />
      )}
      {canControl && meeting && !meeting.reportCard && (
        <p className="text-sm text-gray-600">
          {meeting.name} no es una reunión de boletín: no tiene carga ni cierre que controlar, sólo el visado.
        </p>
      )}

      <div
        role="tabpanel"
        id="paso-actual"
        aria-labelledby={steps.length > 1 ? `paso-${active}` : undefined}
        aria-label={steps.length > 1 ? undefined : STEP_LABELS[active]}
        className="space-y-3"
      >
        <p className="text-sm text-gray-600">{STEP_HINTS[active]}</p>
        {active === 'visado' ? (
          <EndorsementGrid
            rows={endorsements.rows}
            loading={endorsements.loading}
            error={endorsements.error}
            abilities={abilities}
            periodId={periodId}
            periodName={meeting?.name ?? ''}
            allMeetings={allMeetings}
            onAllMeetingsChange={setAllMeetings}
            pendingOnly={pendingOnly}
            onPendingOnlyChange={setPendingOnly}
            onChanged={reloadAll}
          />
        ) : (
          <CompletenessPanel
            periodId={periodId}
            group={group}
            stage={active === 'carga' ? 'before' : 'after'}
            rows={control.rows}
            loading={control.loading}
            error={control.error}
            onReload={control.reload}
          />
        )}
      </div>
    </div>
  )
}
