'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Pencil } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import { formatGrade } from '@/lib/gradebook/grade-scale'

type Decision = {
  id: string
  decision: string
  createdAt: string
  student: { id: string; firstName: string; lastName: string } | null
  createdBy: { id: string; name: string | null } | null
}

type StudentOption = {
  studentId: string
  firstName: string
  lastName: string
  /** Lo que la reunión ya decidió: se lee al lado del nombre mientras se escribe el juicio. */
  performanceValueHundredths?: number | null
  conductValueHundredths?: number | null
  alertCount?: number
  atRisk?: boolean
}

/** Desde la fila de la matriz: ir al juicio de un alumno y, si hace falta, abrirlo para escribir. */
export type JudgementFocus = { studentId: string; edit: boolean; nonce: number }

export const judgementAnchor = (studentId: string) => `juicio-${studentId}`

/**
 * La decisión vigente de cada alumno —y la del grupo— es la más reciente. Las anteriores quedan
 * como historia, no se borran.
 */
export function currentDecisionIds(rows: readonly Decision[]): Set<string> {
  const newest = new Map<string, Decision>()
  for (const row of rows) {
    const key = row.student?.id ?? 'grupo'
    const current = newest.get(key)
    if (!current || row.createdAt > current.createdAt) newest.set(key, row)
  }
  return new Set([...newest.values()].map((row) => row.id))
}

export function meetingRecordsPath(courseOfferingId: string, courseOrientationId: string | null | undefined, periodId: string) {
  const params = new URLSearchParams({ courseOfferingId, periodId })
  if (courseOrientationId) params.set('courseOrientationId', courseOrientationId)
  return `/admin/gradebook/meeting-records?${params}`
}

/** El juicio vigente de cada alumno y el del grupo (clave `null`). */
function currentByKey(rows: readonly Decision[]): Map<string | null, Decision> {
  const current = currentDecisionIds(rows)
  return new Map(rows.filter((row) => current.has(row.id)).map((row) => [row.student?.id ?? null, row]))
}

/** «Rendimiento 7 · Conducta 8 · ▲ 3 en alerta»: lo decidido, para escribir el juicio con eso a la vista. */
export function studentContext(student: StudentOption): string | null {
  const parts: string[] = []
  if (student.performanceValueHundredths != null) parts.push(`Rendimiento ${formatGrade(student.performanceValueHundredths)}`)
  if (student.conductValueHundredths != null) parts.push(`Conducta ${formatGrade(student.conductValueHundredths)}`)
  if (student.atRisk) parts.push(`▲ ${student.alertCount ?? 0} en alerta`)
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * Un juicio vigente con su autor y, para quien conduce la reunión, cómo reemplazarlo. Guardar uno
 * nuevo no borra el anterior: lo sucede.
 */
function JudgementEditor({
  of,
  current,
  canWrite,
  onSave,
  openRequest,
}: {
  /** Sobre quién es, con su preposición: rotula los controles ("del grupo", "de Díaz, Ana"). */
  of: string
  current: Decision | undefined
  canWrite: boolean
  onSave: (text: string) => Promise<boolean>
  /** Cambia cada vez que la matriz pide escribir este juicio. */
  openRequest?: number
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  function start() {
    setDraft(current?.decision ?? '')
    setEditing(true)
  }

  const startRef = useRef(start)
  startRef.current = start
  useEffect(() => {
    if (openRequest && canWrite) startRef.current()
  }, [openRequest, canWrite])

  async function save() {
    setSaving(true)
    const ok = await onSave(draft)
    setSaving(false)
    if (ok) setEditing(false)
  }

  if (editing) {
    return (
      <div className="space-y-2">
        <textarea
          aria-label={`Juicio ${of}`}
          className="input-field min-h-[64px] w-full text-sm"
          value={draft}
          maxLength={2000}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || draft.trim().length < 3}
            className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Guardar
          </button>
          <button type="button" onClick={() => setEditing(false)} disabled={saving} className="btn-secondary text-sm">
            Cancelar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {current ? (
          <>
            <p className="whitespace-pre-line text-sm text-gray-900">{current.decision}</p>
            <p className="text-[11px] text-gray-500">
              {current.createdBy?.name ?? 'Sin autor'} · {current.createdAt.slice(0, 10)}
            </p>
          </>
        ) : (
          <p className="text-sm text-gray-400">Sin juicio</p>
        )}
      </div>
      {canWrite && (
        <button
          type="button"
          onClick={start}
          aria-label={current ? `Cambiar el juicio ${of}` : `Escribir el juicio ${of}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
        >
          <Pencil className="h-3 w-3" aria-hidden />
          {current ? 'Cambiar' : 'Escribir'}
        </button>
      )}
    </div>
  )
}

/**
 * Juicios de la reunión de profesores, en dos partes que no se mezclan:
 *
 * - el **general del grupo** (su orientación, no todo el curso): queda en la reunión y no se
 *   imprime;
 * - el **de cada alumno**, que se escribe alumno por alumno durante la reunión: va a su boletín
 *   como «Informe reunión» y el docente lo ve en su cierre como «Juicio Reu.».
 *
 * Los escriben adscripción y dirección (`gradebook.review`); el resto los lee.
 */
export default function MeetingDecisions({
  courseOfferingId,
  courseOrientationId,
  periodId,
  students,
  onJudgementsChange,
  focus,
}: {
  courseOfferingId: string
  courseOrientationId?: string | null
  periodId: string
  students: readonly StudentOption[]
  /** Quiénes tienen juicio vigente y si el del grupo está escrito: la matriz lo muestra por fila. */
  onJudgementsChange?: (state: { studentIds: Set<string>; group: boolean }) => void
  focus?: JudgementFocus | null
}) {
  const auth = useOptionalAuth()
  const canWrite = hasPermission(auth?.me, 'gradebook.review', 'all')
  const [rows, setRows] = useState<Decision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api<{ data: Decision[] }>(meetingRecordsPath(courseOfferingId, courseOrientationId, periodId))
      setRows(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los juicios')
    } finally {
      setLoading(false)
    }
  }, [courseOfferingId, courseOrientationId, periodId])

  useEffect(() => {
    void load()
  }, [load])

  /** `studentId` null es el juicio general del grupo. */
  async function save(studentId: string | null, text: string): Promise<boolean> {
    setError(null)
    try {
      await api('/admin/gradebook/meeting-records', {
        method: 'POST',
        body: JSON.stringify({
          courseOfferingId,
          courseOrientationId: courseOrientationId ?? undefined,
          periodId,
          studentId: studentId ?? undefined,
          decision: text.trim(),
        }),
      })
      await load()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el juicio')
      return false
    }
  }

  const current = currentByKey(rows)
  const withJudgement = students.filter((s) => current.has(s.studentId)).length
  const [onlyMissing, setOnlyMissing] = useState(false)
  const visible = onlyMissing ? students.filter((s) => !current.has(s.studentId)) : students

  const notify = useRef(onJudgementsChange)
  notify.current = onJudgementsChange
  useEffect(() => {
    if (loading) return
    const byKey = currentByKey(rows)
    notify.current?.({
      studentIds: new Set([...byKey.keys()].filter((key): key is string => key !== null)),
      group: byKey.has(null),
    })
  }, [rows, loading])

  // Ir desde la matriz: se muestra la fila (aunque el filtro la escondiera) y se la trae a la vista.
  useEffect(() => {
    if (!focus) return
    setOnlyMissing(false)
    const id = judgementAnchor(focus.studentId)
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }))
  }, [focus])

  return (
    <section
      id="decisiones-reunion"
      data-tour="reunion.judgements"
      className="scroll-mt-4 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4"
    >
      <div>
        <h3 className="text-sm font-semibold text-gray-900">Juicios de la reunión</h3>
        <p className="text-xs text-gray-600">
          El <strong>juicio de cada alumno</strong> va a su boletín como «Informe reunión» y el docente lo ve en su
          cierre. El <strong>juicio general del grupo</strong> queda en la reunión: no se imprime. Cambiar un juicio
          no borra el anterior.
        </p>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando juicios…
        </p>
      ) : (
        <>
          <div className="space-y-1.5 rounded-lg border border-gray-100 bg-white p-3">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Juicio general del grupo</h4>
            <JudgementEditor
              of="del grupo"
              current={current.get(null)}
              canWrite={canWrite}
              onSave={(text) => save(null, text)}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Juicio de cada alumno{' '}
                <span className="font-normal normal-case tracking-normal text-gray-500">
                  · {withJudgement} de {students.length} con juicio
                </span>
              </h4>
              {withJudgement > 0 && withJudgement < students.length && (
                <label className="inline-flex items-center gap-1.5 text-xs text-gray-700">
                  <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} />
                  Sólo los que no tienen ({students.length - withJudgement})
                </label>
              )}
            </div>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white">
              {visible.map((student) => {
                const name = `${student.lastName}, ${student.firstName}`
                const context = studentContext(student)
                return (
                  <li
                    key={student.studentId}
                    id={judgementAnchor(student.studentId)}
                    className="grid scroll-mt-24 gap-1 px-3 py-2 sm:grid-cols-[220px_1fr] sm:gap-3"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-gray-700">{name}</span>
                      {context && <span className="block text-[11px] text-gray-500">{context}</span>}
                    </span>
                    <JudgementEditor
                      of={`de ${name}`}
                      current={current.get(student.studentId)}
                      canWrite={canWrite}
                      onSave={(text) => save(student.studentId, text)}
                      openRequest={focus?.edit && focus.studentId === student.studentId ? focus.nonce : undefined}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {!canWrite && (
        <p className="border-t border-gray-100 pt-3 text-xs text-gray-500">
          Los juicios los registran adscripción y dirección.
        </p>
      )}
    </section>
  )
}
