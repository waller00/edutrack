'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Check, Clock, Copy, Loader2, MoreHorizontal, Search, UserRound, Users, X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import { todayYmdUruguay } from '@/lib/libreta/absence-day'
import { useNow } from '@/lib/hooks/useNow'
import {
  classGroupLabel,
  classTeacherLine,
  formatRollCallDay,
  rollCallPhase,
  rollCallPhaseChipClass,
  rollCallPhaseLabel,
  type PersonRef,
} from '@/lib/rollcall/rollcall-phase'
import { ROLL_CALL_SAVED_EVENT } from '@/lib/rollcall/class-row'
import {
  applyBulk,
  applyCopySuggestion,
  buildDraft,
  countByStatus,
  initialDraft,
  fullName,
  mergeServerRoster,
  setNote,
  setStatus,
  toSavePayload,
  type SheetDraft,
  type SheetStudent,
} from '@/lib/rollcall/rollcall-sheet'
import { editWindowNotice, type BlockedReason } from '@/lib/rollcall/rollcall-window'
import type { SessionStatus, TeacherStatus } from '@/lib/rollcall/rollcall-status'
import RollCallStudentRow from './RollCallStudentRow'
import RollCallBulkBar from './RollCallBulkBar'
import CopyPreviousDialog, { type PreviousResponse } from './CopyPreviousDialog'

export type SheetResponse = {
  eventId: string
  ymd: string
  title: string
  subject: string | null
  course: string | null
  orientation: string | null
  startAt: string
  endAt: string
  teacher: PersonRef | null
  substitute: PersonRef | null
  rollCall: {
    sessionId: string | null
    status: SessionStatus
    takenAt: string | null
    takenBy: string | null
    notes: string | null
    canEdit: boolean
    blockedReason: BlockedReason
    opensAt: string
    editableUntil: string | null
    copyPreviousEnabled: boolean
  }
  students: SheetStudent[]
}

/** Más allá de un día no vale la pena esperar la apertura con un temporizador. */
const MAX_OPEN_WAIT_MS = 24 * 60 * 60 * 1000

export default function RollCallSheet({ eventId, ymd }: { eventId: string; ymd: string }) {
  const router = useRouter()
  const me = useOptionalAuth()?.me ?? null
  const now = useNow()
  const [sheet, setSheet] = useState<SheetResponse | null>(null)
  const [draft, setDraft] = useState<SheetDraft>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [previous, setPrevious] = useState<PreviousResponse | null>(null)
  /** Alumnos que la hora anterior no tenía: se resaltan hasta que el docente los marque. */
  const [newStudentIds, setNewStudentIds] = useState<string[]>([])
  const [copySource, setCopySource] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const data = await api<SheetResponse>(`/student-attendance/sessions/${eventId}/${ymd}`)
      setSheet(data)
      // Si el docente ya venía marcando, no se le pisa el trabajo con lo del servidor.
      setDraft((prev) =>
        Object.keys(prev).length > 0 ? mergeServerRoster(data.students, prev) : initialDraft(data.students, data.rollCall.status),
      )
    } catch (e) {
      const err = e as Error & { data?: { redirectEventId?: string } }
      // La serie se versionó: seguimos al id vigente en vez de mostrar un error opaco.
      if (err.data?.redirectEventId) {
        router.replace(`/me/roll-call/${err.data.redirectEventId}/${ymd}`)
        return
      }
      setMsg(err.message || 'No se pudo cargar la lista')
      setSheet(null)
    } finally {
      setLoading(false)
    }
  }, [eventId, ymd, router])

  useEffect(() => {
    void load()
  }, [load])

  // Abierta antes de hora: cuando llega la apertura se vuelve a pedir, y el servidor la habilita.
  const opensAt = sheet?.rollCall.blockedReason === 'NOT_STARTED' ? sheet.rollCall.opensAt : null
  useEffect(() => {
    if (!opensAt) return
    const wait = new Date(opensAt).getTime() - Date.now()
    if (wait > MAX_OPEN_WAIT_MS) return
    const id = setTimeout(() => void load(), Math.max(wait, 0) + 1000)
    return () => clearTimeout(id)
  }, [opensAt, load])

  const students = useMemo(() => sheet?.students ?? [], [sheet])
  const counts = useMemo(() => countByStatus(draft, students), [draft, students])
  const canEdit = sheet?.rollCall.canEdit ?? false
  const hasChanges = Boolean(copySource) || students.some((student) => {
    const cell = draft[student.studentId]
    return cell?.status !== student.status || (cell?.note?.trim() || null) !== (student.note?.trim() || null)
  })
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  const query = normalize(search)
  const documentQuery = query.replace(/[.\s-]/g, '')
  const visibleStudents = students.map((student, index) => ({ student, number: index + 1 })).filter(({ student }) =>
    normalize(`${fullName(student)} ${student.documentId ?? ''}`).includes(query) ||
    (/^\d+$/.test(documentQuery) && (student.documentId ?? '').replace(/\D/g, '').includes(documentQuery)),
  )
  const notice = sheet
    ? editWindowNotice({
        canEdit,
        blockedReason: sheet.rollCall.blockedReason,
        editableUntil: sheet.rollCall.editableUntil,
        opensAt: sheet.rollCall.opensAt,
      })
    : null
  const backHref = ymd === todayYmdUruguay(now) ? '/me/roll-call' : `/me/roll-call?date=${ymd}`

  async function save() {
    if (!sheet || !canEdit || saving) return
    const entries = toSavePayload(draft, students)
    if (entries.length === 0) {
      setMsg('Marcá al menos un estudiante antes de guardar.')
      return
    }
    setSaving(true)
    setMsg(null)
    try {
      const updated = await api<SheetResponse>(`/student-attendance/sessions/${eventId}/${ymd}`, {
        method: 'PUT',
        body: JSON.stringify({
          entries,
          source: copySource ? 'COPIED_FROM_PREVIOUS' : 'MANUAL',
          copiedFromSessionId: copySource,
        }),
      })
      setSheet(updated)
      setDraft(buildDraft(updated.students))
      setNewStudentIds([])
      setCopySource(null)
      setMsg('✅ Lista guardada')
      // El aviso de arriba ("pasá la lista") se entera sin esperar a su próxima consulta.
      globalThis.dispatchEvent?.(new Event(ROLL_CALL_SAVED_EVENT))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo guardar la lista')
    } finally {
      setSaving(false)
    }
  }

  async function openCopyPrevious() {
    setMsg(null)
    try {
      const data = await api<PreviousResponse>(`/student-attendance/sessions/${eventId}/${ymd}/previous`)
      if (!data.available) {
        setMsg('No hay una lista anterior de este grupo hoy para copiar.')
        return
      }
      setPrevious(data)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo consultar la hora anterior')
    }
  }

  function confirmCopyPrevious() {
    if (!previous) return
    const result = applyCopySuggestion(draft, students, previous.suggestions)
    setDraft(result.draft)
    setNewStudentIds(result.unmatchedIds)
    setCopySource(previous.sourceSession?.id ?? null)
    setPrevious(null)
    setMsg(
      result.unmatchedIds.length > 0
        ? `Se copiaron ${result.applied} estudiantes. Faltan marcar ${result.unmatchedIds.length}.`
        : `Se copiaron ${result.applied} estudiantes. Revisá y guardá.`,
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando lista…
      </div>
    )
  }

  if (!sheet) {
    return (
      <div className="space-y-4">
        {msg ? <p className={`rounded-lg px-3 py-2 text-sm ${getAdminFlashMessageClass(msg)}`}>{msg}</p> : null}
        <button type="button" className="btn-secondary text-sm" onClick={() => router.push(backHref)}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a mis clases
        </button>
      </div>
    )
  }

  const phase = rollCallPhase(
    {
      status: sheet.rollCall.status,
      blockedReason: sheet.rollCall.blockedReason,
      opensAt: sheet.rollCall.opensAt,
      endAt: sheet.endAt,
      editableUntil: sheet.rollCall.editableUntil,
      takenAt: sheet.rollCall.takenAt,
    },
    now,
  )
  const teacherLine = classTeacherLine({ meId: me?.id, teacher: sheet.teacher, substitute: sheet.substitute })

  return (
    <div className="space-y-4">
      <header className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <button
          type="button"
          className="inline-flex min-h-8 items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-emerald-700"
          onClick={() => router.push(backHref)}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Mis clases
        </button>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{classGroupLabel(sheet.course, sheet.orientation)}</h1>
            <p className="mt-1 text-sm text-slate-600">{sheet.subject ?? sheet.title}</p>
          </div>
          <span className={`max-w-full rounded-full px-2.5 py-1 text-xs font-medium ${rollCallPhaseChipClass(phase)}`}>
            {rollCallPhaseLabel(phase, sheet.rollCall)}
            {sheet.rollCall.takenBy && sheet.rollCall.status === 'TAKEN' ? ` · ${sheet.rollCall.takenBy}` : ''}
          </span>
        </div>
        <p className="flex items-start gap-1.5 text-xs tabular-nums text-slate-500">
          <Clock className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          {formatRollCallDay(ymd)} · {formatTimeInUruguay(sheet.startAt)}–{formatTimeInUruguay(sheet.endAt)}
        </p>
        {teacherLine ? (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <UserRound className="h-4 w-4 text-gray-400" aria-hidden />
            {teacherLine}
          </p>
        ) : null}
      </header>

      {notice ? (
        <p
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
            canEdit ? 'text-xs text-slate-500' : 'bg-amber-50 text-amber-900'
          }`}
        >
          {canEdit ? null : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
          {notice}
        </p>
      ) : null}

      {msg ? <p className={`rounded-lg px-3 py-2 text-sm ${getAdminFlashMessageClass(msg)}`}>{msg}</p> : null}

      {students.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
          Este grupo no tiene estudiantes matriculados en el ciclo.
        </p>
      ) : (
        <>
          {canEdit && (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-3 text-xs text-emerald-900">
              <p className="font-medium">{sheet.rollCall.status === 'PENDING' ? 'Todos empiezan presentes. Tocá el estado para cambiarlo.' : 'Tocá el estado para corregirlo y guardá los cambios.'}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Check className="h-3.5 w-3.5" aria-hidden />Presente <span aria-hidden>→</span>
                <X className="h-3.5 w-3.5 text-red-600" aria-hidden />Ausente <span aria-hidden>→</span>
                <Clock className="h-3.5 w-3.5 text-amber-600" aria-hidden />Llegada tarde <span aria-hidden>→</span>Presente
              </p>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Buscar estudiante</span>
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-slate-400" aria-hidden />
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar nombre o documento" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-9 pr-3 text-base focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
            </label>
            {canEdit && (
              <details className="relative shrink-0" onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.currentTarget.open = false
                  event.currentTarget.querySelector('summary')?.focus()
                }
              }}>
                <summary aria-label="Opciones de lista" className="flex min-h-12 min-w-12 cursor-pointer list-none items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 [&::-webkit-details-marker]:hidden">
                  <MoreHorizontal className="h-5 w-5" aria-hidden /><span className="sr-only sm:not-sr-only">Opciones de lista</span>
                </summary>
                <div className="absolute right-0 top-full z-30 mt-2 w-60 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg" onClick={(event) => {
                  const details = event.currentTarget.closest('details')
                  if (details) { details.open = false; details.querySelector('summary')?.focus() }
                }}>
                <button type="button" disabled={saving} onClick={() => { setDraft((d) => applyBulk(d, students, 'PRESENT')); setMsg(null) }} className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-emerald-700 disabled:opacity-50">
                  <Users className="h-4 w-4" aria-hidden />Todos presentes
                </button>
                {sheet.rollCall.copyPreviousEnabled && (
                  <button type="button" disabled={saving} onClick={() => void openCopyPrevious()} className="inline-flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-600 hover:bg-slate-50 hover:text-emerald-700 disabled:opacity-50">
                    <Copy className="h-4 w-4" aria-hidden />Copiar hora anterior
                  </button>
                )}
                </div>
              </details>
            )}
          </div>
          <p className="text-xs text-slate-500">{query ? `${visibleStudents.length} de ${students.length} estudiantes` : `${students.length} estudiantes`}</p>
          {visibleStudents.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-600">
              <p>No hay estudiantes que coincidan con la búsqueda.</p>
              <button type="button" onClick={() => setSearch('')} className="mt-2 min-h-11 rounded-lg px-3 font-medium text-emerald-700 hover:bg-emerald-50">Limpiar búsqueda</button>
            </div>
          )}
          <ul aria-label="Lista de estudiantes" className="space-y-2">
            {visibleStudents.map(({ student, number }) => (
              <RollCallStudentRow
                key={student.studentId}
                student={student}
                number={number}
                status={draft[student.studentId]?.status ?? null}
                note={draft[student.studentId]?.note ?? null}
                disabled={!canEdit || saving}
                isNew={newStudentIds.includes(student.studentId)}
                onStatus={(status: TeacherStatus) => { setDraft((d) => setStatus(d, student.studentId, status)); setMsg(null) }}
                onNote={(note) => { setDraft((d) => setNote(d, student.studentId, note)); setMsg(null) }}
              />
            ))}
          </ul>

          <RollCallBulkBar
            counts={counts}
            disabled={!canEdit}
            saving={saving}
            taken={sheet.rollCall.status === 'TAKEN'}
            hasChanges={hasChanges}
            onSave={() => void save()}
          />
        </>
      )}

      {previous ? (
        <CopyPreviousDialog
          data={previous}
          newStudentNames={students
            .filter((s) => previous.newStudentIds.includes(s.studentId))
            .map((s) => fullName(s))}
          onConfirm={confirmCopyPrevious}
          onCancel={() => setPrevious(null)}
        />
      ) : null}
    </div>
  )
}
