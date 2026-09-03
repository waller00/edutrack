'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { formatTimeInUruguay } from '@/lib/forms/datetime-uy'
import {
  applyBulk,
  applyCopySuggestion,
  buildDraft,
  countByStatus,
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
  rollCall: {
    sessionId: string | null
    status: SessionStatus
    takenAt: string | null
    notes: string | null
    canEdit: boolean
    blockedReason: BlockedReason
    editableUntil: string | null
    copyPreviousEnabled: boolean
  }
  students: SheetStudent[]
}

export default function RollCallSheet({ eventId, ymd }: { eventId: string; ymd: string }) {
  const router = useRouter()
  const [sheet, setSheet] = useState<SheetResponse | null>(null)
  const [draft, setDraft] = useState<SheetDraft>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [previous, setPrevious] = useState<PreviousResponse | null>(null)
  /** Alumnos que la hora anterior no tenía: se resaltan hasta que el docente los marque. */
  const [newStudentIds, setNewStudentIds] = useState<string[]>([])
  const [copySource, setCopySource] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const data = await api<SheetResponse>(`/student-attendance/sessions/${eventId}/${ymd}`)
      setSheet(data)
      // Si el docente ya venía marcando, no se le pisa el trabajo con lo del servidor.
      setDraft((prev) => (Object.keys(prev).length > 0 ? mergeServerRoster(data.students, prev) : buildDraft(data.students)))
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

  const students = sheet?.students ?? []
  const counts = useMemo(() => countByStatus(draft, students), [draft, students])
  const canEdit = sheet?.rollCall.canEdit ?? false
  const notice = sheet
    ? editWindowNotice({
        canEdit,
        blockedReason: sheet.rollCall.blockedReason,
        editableUntil: sheet.rollCall.editableUntil,
      })
    : null

  async function save() {
    if (!sheet) return
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
      setMsg('✅ Lista guardada')
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
        <button type="button" className="btn-secondary text-sm" onClick={() => router.push('/me/roll-call')}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver a mis clases
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-emerald-700 hover:underline"
          onClick={() => router.push('/me/roll-call')}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Mis clases
        </button>
        <h1 className="text-xl font-bold text-gray-900">{sheet.subject ?? sheet.title}</h1>
        <p className="text-sm text-gray-600">
          {[sheet.course, sheet.orientation].filter(Boolean).join(' · ') || 'Sin curso'} ·{' '}
          {formatTimeInUruguay(sheet.startAt)}–{formatTimeInUruguay(sheet.endAt)}
        </p>
      </header>

      {notice ? (
        <p
          className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${
            canEdit ? 'bg-gray-50 text-gray-600' : 'bg-amber-50 text-amber-900'
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
          <ul className="space-y-2">
            {students.map((student) => (
              <RollCallStudentRow
                key={student.studentId}
                student={student}
                status={draft[student.studentId]?.status ?? null}
                note={draft[student.studentId]?.note ?? null}
                disabled={!canEdit}
                isNew={newStudentIds.includes(student.studentId)}
                onStatus={(status: TeacherStatus) => setDraft((d) => setStatus(d, student.studentId, status))}
                onNote={(note) => setDraft((d) => setNote(d, student.studentId, note))}
              />
            ))}
          </ul>

          <RollCallBulkBar
            counts={counts}
            disabled={!canEdit}
            saving={saving}
            canCopyPrevious={sheet.rollCall.copyPreviousEnabled}
            onAllPresent={() => setDraft((d) => applyBulk(d, students, 'PRESENT'))}
            onCopyPrevious={() => void openCopyPrevious()}
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
