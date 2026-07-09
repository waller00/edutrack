'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import { api, apiBaseUrl } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { fileToDataUrl } from '@/lib/media/image-upload'

type CourseOpt = { id: string; name: string; courseOfferingId: string | null }
type SubjectOpt = { id: string; name: string }
type Assignment = {
  id: number
  cmid: number | null
  name: string
  maxGrade: number | null
  gradeType: 'point' | 'scale' | 'none'
}
type UploadResult = { updatedCount: number; errors: Array<{ row: number; message: string }> }

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

function AdminGradesInner() {
  const syCtx = useOptionalAdminSchoolYear()
  const coursePickerQuery = syCtx?.schoolYearScopedQuery ?? syCtx?.schoolYearQuery ?? ''

  const [courses, setCourses] = useState<CourseOpt[]>([])
  const [subjects, setSubjects] = useState<SubjectOpt[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])

  const [courseId, setCourseId] = useState('')
  const [subjectId, setSubjectId] = useState('')
  const [assignmentId, setAssignmentId] = useState('')

  const [loadingActivities, setLoadingActivities] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<UploadResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const selectedCourse = courses.find((c) => c.id === courseId) ?? null
  const courseOfferingId = selectedCourse?.courseOfferingId ?? null
  const selectedAssignment = assignments.find((a) => String(a.id) === assignmentId) ?? null

  // Cargar cursos del ciclo activo.
  useEffect(() => {
    api<CourseOpt[]>(withSchoolYear('/courses', coursePickerQuery))
      .then((list) => setCourses(list.filter((c) => c.courseOfferingId)))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los cursos'))
  }, [coursePickerQuery])

  // Al cambiar de curso: cargar asignaturas y limpiar lo dependiente.
  useEffect(() => {
    setSubjects([])
    setSubjectId('')
    setAssignments([])
    setAssignmentId('')
    if (!courseId) return
    api<SubjectOpt[]>(withSchoolYear(`/courses/${courseId}/subjects`, coursePickerQuery))
      .then(setSubjects)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las asignaturas'))
  }, [courseId, coursePickerQuery])

  // Al elegir asignatura: pedir las tareas del curso Moodle.
  useEffect(() => {
    setAssignments([])
    setAssignmentId('')
    if (!courseOfferingId || !subjectId) return
    setLoadingActivities(true)
    setError('')
    api<{ assignments: Assignment[] }>(
      `/grades/activities?courseOfferingId=${courseOfferingId}&subjectId=${subjectId}`,
    )
      .then((r) => setAssignments(r.assignments))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las tareas de Moodle'))
      .finally(() => setLoadingActivities(false))
  }, [courseOfferingId, subjectId])

  const downloadSheet = useCallback(async () => {
    if (!courseOfferingId || !subjectId || !assignmentId) return
    setDownloading(true)
    setError('')
    setMessage('')
    setResult(null)
    try {
      const url = `${apiBaseUrl()}/grades/sheet?courseOfferingId=${courseOfferingId}&subjectId=${subjectId}&assignmentId=${assignmentId}`
      const res = await fetch(url, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.message || `Error ${res.status}`)
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `Notas_${selectedAssignment?.name ?? 'tarea'}.xlsx`.replace(/[^a-zA-Z0-9_.-]+/g, '_')
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
      setMessage('Planilla descargada. Cargá las notas y volvé a subirla.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo descargar la planilla')
    } finally {
      setDownloading(false)
    }
  }, [courseOfferingId, subjectId, assignmentId, selectedAssignment])

  const uploadSheet = useCallback(
    async (file: File) => {
      if (!courseOfferingId || !subjectId || !assignmentId) return
      setUploading(true)
      setError('')
      setMessage('')
      setResult(null)
      try {
        const fileBase64 = await fileToDataUrl(file)
        const res = await api<UploadResult>('/grades/sheet/upload', {
          method: 'POST',
          body: JSON.stringify({
            courseOfferingId,
            subjectId,
            assignmentId: Number(assignmentId),
            fileBase64,
          }),
        })
        setResult(res)
        setMessage(`Se actualizaron ${res.updatedCount} nota(s) en Moodle.`)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo subir la planilla')
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [courseOfferingId, subjectId, assignmentId],
  )

  const canGrade = selectedAssignment?.gradeType === 'point'
  const ready = Boolean(courseOfferingId && subjectId && assignmentId)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Notas (Moodle)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Descargá la planilla de una tarea, cargá las notas offline y subila para escribirlas en Moodle.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Curso</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">Elegí un curso…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Asignatura</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={!courseId}
            >
              <option value="">Elegí una asignatura…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Tarea</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
              value={assignmentId}
              onChange={(e) => setAssignmentId(e.target.value)}
              disabled={!subjectId || loadingActivities}
            >
              <option value="">{loadingActivities ? 'Cargando…' : 'Elegí una tarea…'}</option>
              {assignments.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.gradeType === 'point' && a.maxGrade != null ? ` (máx ${a.maxGrade})` : ' (sin nota numérica)'}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selectedAssignment && !canGrade ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Esta tarea no usa calificación numérica (escala/rúbrica); no se puede cargar por planilla.
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="button"
            onClick={() => void downloadSheet()}
            disabled={!ready || downloading}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            {downloading ? 'Generando…' : 'Descargar planilla'}
          </button>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={!ready || !canGrade || uploading}
            className="inline-flex items-center gap-2 rounded-lg border border-emerald-600 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Subiendo…' : 'Subir planilla'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void uploadSheet(file)
            }}
          />
        </div>
      </div>

      {message ? (
        <p className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</p>
      ) : null}
      {error ? <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      {result && result.errors.length > 0 ? (
        <div className="rounded-xl border border-red-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-semibold text-red-700">
            Filas con problemas ({result.errors.length})
          </h2>
          <ul className="space-y-1 text-sm text-gray-700">
            {result.errors.map((err) => (
              <li key={err.row}>
                <span className="font-medium">Fila {err.row}:</span> {err.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export default function AdminGradesPage() {
  return (
    <RoleGuard permission="courses.manage">
      <AdminGradesInner />
    </RoleGuard>
  )
}
