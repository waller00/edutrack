'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FileSpreadsheet, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { apiBlob } from '@/lib/api/binary'
import { studentFullName } from '@/lib/gradebook/labels'
import type { GradeBookDetail, StudentAbsencesHistory } from '@/lib/gradebook/types'
import { formatYmdDisplay, buildAbsencesExportRows } from '@/lib/libreta/absence-day'

type Props = {
  gradeBookId: string
  studentId: string
  detail: GradeBookDetail
  onBack: () => void
}

function downloadCsv(filename: string, rows: string[][]) {
  const escape = (cell: string) => `"${cell.replace(/"/g, '""')}"`
  const body = rows.map((r) => r.map((c) => escape(c ?? '')).join(';')).join('\n')
  const blob = new Blob([`\uFEFF${body}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export default function StudentAbsencesDetail({ gradeBookId, studentId, detail, onBack }: Props) {
  const [from, setFrom] = useState(() => `${detail.schoolYear.code}-01-01`)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [typeFilter, setTypeFilter] = useState<'all' | 'ABSENT' | 'LATE'>('all')
  const [history, setHistory] = useState<StudentAbsencesHistory | null>(null)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams()
      if (from) qs.set('from', from)
      if (to) qs.set('to', to)
      const data = await api<StudentAbsencesHistory>(
        `/gradebook/${gradeBookId}/students/${studentId}/absences?${qs.toString()}`,
      )
      setHistory(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial')
      setHistory(null)
    } finally {
      setLoading(false)
    }
  }, [gradeBookId, studentId, from, to])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!history?.student.hasPhoto) {
      setPhotoUrl(null)
      return
    }
    let revoked: string | null = null
    let cancelled = false
    void apiBlob(`/gradebook/${gradeBookId}/students/${studentId}/photo`)
      .then((blob) => {
        if (cancelled || !blob) return
        revoked = URL.createObjectURL(blob)
        setPhotoUrl(revoked)
      })
      .catch(() => {
        if (!cancelled) setPhotoUrl(null)
      })
    return () => {
      cancelled = true
      if (revoked) URL.revokeObjectURL(revoked)
    }
  }, [gradeBookId, studentId, history?.student.hasPhoto])

  const filteredSubjects = useMemo(() => {
    if (!history) return []
    return history.bySubject
      .map((subject) => ({
        ...subject,
        entries: subject.entries.filter((e) => {
          if (typeFilter === 'all') return e.status !== 'PRESENT'
          if (typeFilter === 'LATE') return e.status === 'LATE'
          return e.status === 'ABSENT' || e.status === 'ABSENT_JUSTIFIED'
        }),
      }))
      .filter((s) => s.entries.length > 0)
  }, [history, typeFilter])

  function exportExcel() {
    if (!history) return
    const rows = buildAbsencesExportRows({
      studentName: `${history.student.lastName} ${history.student.firstName}`.toUpperCase(),
      courseName: detail.course.name,
      fromYmd: from,
      toYmd: to,
      subjects: filteredSubjects.map((subject) => ({
        subjectName: subject.subjectName,
        absences: subject.absences,
        entries: subject.entries.map((entry) => ({
          ymd: entry.ymd,
          label: entry.label,
        })),
      })),
    })
    const name = studentFullName(history.student).replace(/[^\wáéíóúñÁÉÍÓÚÑ]+/gi, '_')
    downloadCsv(`inasistencias_${name}.csv`, rows)
  }

  const titleName = history
    ? `${history.student.lastName} ${history.student.firstName}`.toUpperCase()
    : '…'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold uppercase tracking-wide text-teal-800">
          Inasistencias de: {titleName}
        </h2>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Volver
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-14 w-14 rounded border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-14 w-14 items-center justify-center rounded border border-dashed border-slate-300 bg-white text-xs text-slate-400">
            Sin foto
          </div>
        )}
        <div className="min-w-[8rem]">
          <p className="text-xs text-slate-500">Curso</p>
          <p className="font-medium text-slate-800">{detail.course.name}</p>
        </div>
        <label className="text-xs text-slate-600">
          Desde
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-0.5 block rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-600">
          Hasta
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-0.5 block rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          />
        </label>
        <div className="min-w-[8rem]">
          <p className="text-xs text-slate-500">Asignatura</p>
          <p className="font-medium text-slate-800">{detail.subject.name}</p>
        </div>
        <label className="text-xs text-slate-600">
          Tipo
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
            className="mt-0.5 block rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          >
            <option value="all">Todos</option>
            <option value="ABSENT">Faltas</option>
            <option value="LATE">Tardes</option>
          </select>
        </label>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded bg-sky-800 px-3 py-1.5 text-xs font-semibold uppercase text-white hover:bg-sky-900"
        >
          Buscar
        </button>
        <button
          type="button"
          onClick={exportExcel}
          disabled={!history}
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded text-teal-700 hover:bg-teal-50 disabled:opacity-40"
          title="Exportar"
          aria-label="Exportar a Excel"
        >
          <FileSpreadsheet className="h-5 w-5" />
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      )}

      {loading && (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Cargando…
        </p>
      )}

      {!loading && history && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">
            Acumulado: {history.overall.absences} falta
            {history.overall.absenceHundredths === 100 ? '' : 's'}
            {' · '}
            {history.overall.lates} tarde{history.overall.lates === 1 ? '' : 's'}
          </p>

          {filteredSubjects.length === 0 ? (
            <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
              No hay inasistencias en el rango elegido.
            </p>
          ) : (
            filteredSubjects.map((subject) => (
              <section key={subject.subjectId ?? subject.subjectName} className="overflow-hidden rounded border border-slate-200 bg-white">
                <header className="flex items-center justify-between bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
                  <span>{subject.subjectName.toUpperCase()}</span>
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-600">
                    Falta: {subject.absences}
                  </span>
                </header>
                <ul className="divide-y divide-slate-100">
                  {subject.entries.map((entry) => (
                    <li key={entry.entryId} className="flex items-center justify-between px-3 py-2 text-sm">
                      <span className="tabular-nums text-slate-700">{formatYmdDisplay(entry.ymd)}</span>
                      <span className="font-medium uppercase text-slate-800">{entry.label}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
      )}
    </div>
  )
}
