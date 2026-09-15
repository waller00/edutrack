'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
} from 'lucide-react'
import { api } from '@/lib/api/client'
import { apiBlob } from '@/lib/api/binary'
import { useLibreta } from '@/contexts/LibretaContext'
import { studentFullName } from '@/lib/gradebook/labels'
import type { AbsenceDayBoard, AbsenceDayStudent, GradeBookHeader } from '@/lib/gradebook/types'
import {
  addDaysYmd,
  dayMarkToSelect,
  formatYmdDisplay,
  selectToDayMark,
  todayYmdUruguay,
  weekdayNameEs,
  type DayMarkSelectValue,
} from '@/lib/libreta/absence-day'
import { libretaCode } from './MisLibretas'
import StudentAbsencesDetail from './StudentAbsencesDetail'

function StudentAvatar({
  gradeBookId,
  student,
}: {
  gradeBookId: string
  student: Pick<AbsenceDayStudent, 'studentId' | 'hasPhoto' | 'firstName' | 'lastName'>
}) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!student.hasPhoto) {
      setUrl(null)
      return
    }
    let revoked: string | null = null
    let cancelled = false
    void apiBlob(`/gradebook/${gradeBookId}/students/${student.studentId}/photo`)
      .then((blob) => {
        if (cancelled || !blob) return
        revoked = URL.createObjectURL(blob)
        setUrl(revoked)
      })
      .catch(() => {
        if (!cancelled) setUrl(null)
      })
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [gradeBookId, student.studentId, student.hasPhoto])

  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
    )
  }

  const initials = `${student.lastName[0] ?? ''}${student.firstName[0] ?? ''}`.toUpperCase()
  return (
    <span
      aria-hidden
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-600"
    >
      {initials}
    </span>
  )
}

function draftsFromBoard(board: AbsenceDayBoard | null): Record<string, DayMarkSelectValue> {
  const next: Record<string, DayMarkSelectValue> = {}
  for (const student of board?.students ?? []) {
    next[student.studentId] = dayMarkToSelect(student.dayMark)
  }
  return next
}

/**
 * Inasistencias de la libreta: planilla diaria (foto, faltas/tardes, acumulados) y detalle por alumno.
 */
export default function InasistenciasSection() {
  const { gradeBookId, detail } = useLibreta()
  const router = useRouter()
  const [date, setDate] = useState(todayYmdUruguay)
  const [showAll, setShowAll] = useState(true)
  const [focusStudentId, setFocusStudentId] = useState<string | null>(null)
  const [detailStudentId, setDetailStudentId] = useState<string | null>(null)
  const [board, setBoard] = useState<AbsenceDayBoard | null>(null)
  const [drafts, setDrafts] = useState<Record<string, DayMarkSelectValue>>({})
  const [mine, setMine] = useState<GradeBookHeader[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBoard = useCallback(async () => {
    if (!gradeBookId) return
    setLoading(true)
    try {
      const data = await api<AbsenceDayBoard>(`/gradebook/${gradeBookId}/absences/day?date=${date}`)
      setBoard(data)
      setDrafts(draftsFromBoard(data))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la planilla')
      setBoard(null)
      setDrafts({})
    } finally {
      setLoading(false)
    }
  }, [gradeBookId, date])

  useEffect(() => {
    void loadBoard()
  }, [loadBoard])

  useEffect(() => {
    let alive = true
    api<{ data: GradeBookHeader[] }>('/gradebook/mine')
      .then((res) => {
        if (alive) setMine(res.data ?? [])
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const students = board?.students ?? []
  const visible = useMemo(() => {
    if (showAll) return students
    if (!focusStudentId) return students.slice(0, 1)
    const one = students.find((s) => s.studentId === focusStudentId)
    return one ? [one] : students.slice(0, 1)
  }, [students, showAll, focusStudentId])

  const dirty = useMemo(() => {
    if (!board) return false
    return board.students.some(
      (student) => (drafts[student.studentId] ?? '') !== dayMarkToSelect(student.dayMark),
    )
  }, [board, drafts])

  function setDraft(studentId: string, value: DayMarkSelectValue) {
    setDrafts((prev) => ({ ...prev, [studentId]: value }))
  }

  function cancelDrafts() {
    setDrafts(draftsFromBoard(board))
    setError(null)
  }

  async function saveDrafts() {
    if (!board?.canMark || !board.canGrade || !dirty) return
    const entries = board.students
      .filter((student) => (drafts[student.studentId] ?? '') !== dayMarkToSelect(student.dayMark))
      .map((student) => {
        const payload = selectToDayMark(drafts[student.studentId] ?? '')
        return {
          studentId: student.studentId,
          status: payload.status,
          absenceWeightHundredths: payload.absenceWeightHundredths,
        }
      })
    if (entries.length === 0) return

    setSaving(true)
    try {
      await api(`/gradebook/${gradeBookId}/absences/day`, {
        method: 'PUT',
        body: JSON.stringify({ date, entries }),
      })
      await loadBoard()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la planilla')
    } finally {
      setSaving(false)
    }
  }

  if (!detail) return null

  if (detailStudentId) {
    return (
      <StudentAbsencesDetail
        gradeBookId={gradeBookId}
        studentId={detailStudentId}
        detail={detail}
        onBack={() => setDetailStudentId(null)}
      />
    )
  }

  const weekdayLabel = weekdayNameEs(date)
  const canMark = Boolean(board?.canMark && board.canGrade)

  return (
    <div className="space-y-3">
      <header>
        <h2 className="text-base font-bold uppercase tracking-wide text-teal-800">Inasistencias</h2>
        <p className="text-sm text-slate-600">
          {detail.subject.name} · {detail.course.name}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-slate-100/80 px-3 py-2 text-sm">
        <span className="font-medium text-slate-700">Libreta</span>
        <select
          value={gradeBookId}
          onChange={(e) => {
            const next = e.target.value
            if (next && next !== gradeBookId) router.push(`/libreta/${next}/inasistencias`)
          }}
          className="min-w-[12rem] rounded border border-slate-300 bg-white px-2 py-1.5"
          aria-label="Seleccionar libreta"
        >
          {(mine.length ? mine : [detail]).map((book) => (
            <option key={book.id} value={book.id}>
              {libretaCode(book)}
            </option>
          ))}
        </select>

        <select
          value={showAll ? 'all' : 'one'}
          onChange={(e) => {
            const all = e.target.value === 'all'
            setShowAll(all)
            if (!all && students[0]) setFocusStudentId(students[0].studentId)
          }}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
          aria-label="Modo de alumnos"
        >
          <option value="all">Todos los alumnos</option>
          <option value="one">Un alumno</option>
        </select>

        <select
          value={focusStudentId ?? students[0]?.studentId ?? ''}
          disabled={students.length === 0}
          onChange={(e) => {
            setFocusStudentId(e.target.value)
            setShowAll(false)
          }}
          className="min-w-[14rem] flex-1 rounded border border-slate-300 bg-white px-2 py-1.5"
          aria-label="Seleccionar alumno"
        >
          {students.map((s) => (
            <option key={s.studentId} value={s.studentId}>
              {s.lastName.toUpperCase()} {s.firstName.toUpperCase()}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDate((d) => addDaysYmd(d, -1))}
            className="rounded border border-slate-300 bg-white p-1.5 hover:bg-white"
            aria-label="Día anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 tabular-nums">
            <Calendar className="h-3.5 w-3.5 text-slate-500" aria-hidden />
            {formatYmdDisplay(date)}
          </span>
          <span
            className="min-w-[5.5rem] px-2 py-1 font-semibold text-slate-800"
            aria-label="Día de la semana"
          >
            {weekdayLabel}
          </span>
          <button
            type="button"
            onClick={() => setDate((d) => addDaysYmd(d, 1))}
            className="rounded border border-slate-300 bg-white p-1.5 hover:bg-white"
            aria-label="Día siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <button
          type="button"
          onClick={() => setDate(todayYmdUruguay())}
          className="rounded bg-sky-100 px-2 py-1 text-xs font-semibold uppercase text-sky-900 hover:bg-sky-200"
        >
          Hoy
        </button>
        <button
          type="button"
          onClick={() => setDate((d) => addDaysYmd(d, -7))}
          className="rounded bg-sky-100 px-2 py-1 text-xs font-semibold uppercase text-sky-900 hover:bg-sky-200"
        >
          -1 Semana
        </button>
        <button
          type="button"
          onClick={() => setDate((d) => addDaysYmd(d, 7))}
          className="rounded bg-sky-100 px-2 py-1 text-xs font-semibold uppercase text-sky-900 hover:bg-sky-200"
        >
          +1 Semana
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {loading && !board ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando planilla…
        </p>
      ) : students.length === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          El grupo no tiene estudiantes matriculados.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">N.º</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Nombre</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Inasistencia</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Acumulados</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map((student, index) => {
                  const fullIndex = students.findIndex((s) => s.studentId === student.studentId)
                  const n = (fullIndex >= 0 ? fullIndex : index) + 1
                  const selectValue = drafts[student.studentId] ?? ''
                  return (
                    <tr key={student.studentId}>
                      <td className="px-3 py-2 text-xs text-gray-400">{n}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <StudentAvatar gradeBookId={gradeBookId} student={student} />
                          <button
                            type="button"
                            onClick={() => setDetailStudentId(student.studentId)}
                            className="text-left font-medium text-sky-800 hover:underline"
                          >
                            {studentFullName(student).toUpperCase()}
                          </button>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={selectValue}
                          disabled={!canMark || saving}
                          onChange={(e) => setDraft(student.studentId, e.target.value as DayMarkSelectValue)}
                          className="w-full min-w-[9rem] rounded border border-slate-300 bg-white px-2 py-1.5 disabled:opacity-50"
                          aria-label={`Inasistencia de ${studentFullName(student)}`}
                        >
                          <option value="">—</option>
                          <option value="ABSENT_100">Falta</option>
                          <option value="LATE">Llegada tarde</option>
                          <option value="ABSENT_50">Media falta</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600">
                        <div>Ll. T.: {student.lates ?? 0}</div>
                        <div>Acu. F.: {student.absences ?? '0'}</div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {canMark && (
            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => void saveDrafts()}
                disabled={!dirty || saving}
                className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white hover:bg-teal-800 disabled:opacity-40"
              >
                {saving ? 'Guardando…' : 'Guardar'}
              </button>
              <button
                type="button"
                onClick={cancelDrafts}
                disabled={!dirty || saving}
                className="px-2 py-2 text-sm font-semibold uppercase tracking-wide text-red-600 hover:text-red-700 disabled:opacity-40"
              >
                Cancelar
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
