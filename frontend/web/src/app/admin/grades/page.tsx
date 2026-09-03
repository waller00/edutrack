'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import { api, apiBaseUrl } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { fileToDataUrl } from '@/lib/media/image-upload'
import { withSchoolYear } from '@/lib/admin/school-year-query'

type CourseOpt = { id: string; name: string; courseOfferingId: string | null }
type OrientationOpt = { id: string; orientationId: string; orientation: { name: string } }
type SubjectOpt = { id: string; name: string }
type Assignment = {
  id: number
  cmid: number | null
  name: string
  maxGrade: number | null
  gradeType: 'point' | 'scale' | 'none'
}
type UploadResult = { updatedCount: number; errors: Array<{ sheet?: string; row?: number; message: string }> }

/** La subida multi-hoja puede tardar más que el timeout por defecto de `api()` (12s). */
const UPLOAD_TIMEOUT_MS = 180_000

function AdminGradesInner() {
  const syCtx = useOptionalAdminSchoolYear()
  const coursePickerQuery = syCtx?.schoolYearScopedQuery ?? syCtx?.schoolYearQuery ?? ''

  const [courses, setCourses] = useState<CourseOpt[]>([])
  const [orientations, setOrientations] = useState<OrientationOpt[]>([])
  const [subjects, setSubjects] = useState<SubjectOpt[]>([])
  const [assignments, setAssignments] = useState<Assignment[]>([])

  const [courseId, setCourseId] = useState('')
  const [courseOrientationId, setCourseOrientationId] = useState('')
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
  const selectedOrientation = orientations.find((o) => o.id === courseOrientationId) ?? null
  const orientationCatalogId = selectedOrientation?.orientationId ?? ''
  const selectedAssignment = assignments.find((a) => String(a.id) === assignmentId) ?? null

  // Cargar cursos del ciclo activo.
  useEffect(() => {
    api<CourseOpt[]>(withSchoolYear('/courses', coursePickerQuery))
      .then((list) => setCourses(list.filter((c) => c.courseOfferingId)))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar los cursos'))
  }, [coursePickerQuery])

  // Al cambiar de curso: cargar sus orientaciones (si tiene) y limpiar lo dependiente.
  useEffect(() => {
    setOrientations([])
    setCourseOrientationId('')
    if (!courseId) return
    api<OrientationOpt[]>(withSchoolYear(`/courses/${courseId}/orientations`, coursePickerQuery))
      .then(setOrientations)
      .catch(() => setOrientations([])) // sin orientaciones: el filtro simplemente no se muestra
  }, [courseId, coursePickerQuery])

  // Al cambiar curso u orientación: recargar asignaturas y limpiar lo dependiente.
  useEffect(() => {
    setSubjects([])
    setSubjectId('')
    setAssignments([])
    setAssignmentId('')
    if (!courseId) return
    const orientationParam = orientationCatalogId ? `?orientationId=${orientationCatalogId}` : ''
    api<SubjectOpt[]>(withSchoolYear(`/courses/${courseId}/subjects${orientationParam}`, coursePickerQuery))
      .then(setSubjects)
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las asignaturas'))
  }, [courseId, orientationCatalogId, coursePickerQuery])

  /** Parámetros de alcance compartidos por /activities, descarga y subida. */
  const scopeParams = useCallback(
    (extra: Record<string, string> = {}) => {
      const params = new URLSearchParams({ courseOfferingId: courseOfferingId ?? '', ...extra })
      if (subjectId) params.set('subjectId', subjectId)
      if (courseOrientationId && orientationCatalogId) {
        params.set('courseOrientationId', courseOrientationId)
        params.set('orientationId', orientationCatalogId)
      }
      return params
    },
    [courseOfferingId, subjectId, courseOrientationId, orientationCatalogId],
  )

  // Al elegir asignatura: pedir las tareas del curso Moodle.
  useEffect(() => {
    setAssignments([])
    setAssignmentId('')
    if (!courseOfferingId || !subjectId) return
    setLoadingActivities(true)
    setError('')
    api<{ assignments: Assignment[] }>(`/grades/activities?${scopeParams().toString()}`)
      .then((r) => setAssignments(r.assignments))
      .catch((e) => setError(e instanceof Error ? e.message : 'No se pudieron cargar las tareas de Moodle'))
      .finally(() => setLoadingActivities(false))
  }, [courseOfferingId, subjectId, scopeParams])

  const downloadSheet = useCallback(async () => {
    if (!courseOfferingId) return
    setDownloading(true)
    setError('')
    setMessage('')
    setResult(null)
    try {
      const params = scopeParams(assignmentId ? { assignmentId } : {})
      const res = await fetch(`${apiBaseUrl()}/grades/sheet?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.message || `Error ${res.status}`)
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const scopeName =
        selectedAssignment?.name ??
        subjects.find((s) => s.id === subjectId)?.name ??
        selectedCourse?.name ??
        'planilla'
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `Notas_${scopeName}.xlsx`.replace(/[^a-zA-Z0-9_.-]+/g, '_')
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
      setMessage('Planilla descargada. Cargá las notas y volvé a subirla.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo descargar la planilla')
    } finally {
      setDownloading(false)
    }
  }, [courseOfferingId, subjectId, assignmentId, scopeParams, selectedAssignment, selectedCourse, subjects])

  const uploadSheet = useCallback(
    async (file: File) => {
      if (!courseOfferingId) return
      setUploading(true)
      setError('')
      setMessage('')
      setResult(null)
      try {
        const fileBase64 = await fileToDataUrl(file)
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
        try {
          const res = await api<UploadResult>('/grades/sheet/upload', {
            method: 'POST',
            signal: controller.signal,
            body: JSON.stringify({
              courseOfferingId,
              ...(subjectId ? { subjectId } : {}),
              ...(courseOrientationId && orientationCatalogId
                ? { courseOrientationId, orientationId: orientationCatalogId }
                : {}),
              ...(assignmentId ? { assignmentId: Number(assignmentId) } : {}),
              fileBase64,
            }),
          })
          setResult(res)
          setMessage(`Se actualizaron ${res.updatedCount} nota(s) en Moodle.`)
        } finally {
          clearTimeout(timeout)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se pudo subir la planilla')
      } finally {
        setUploading(false)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
    },
    [courseOfferingId, subjectId, assignmentId, courseOrientationId, orientationCatalogId],
  )

  // Con una tarea puntual elegida se exige nota numérica; sin tarea, la validación es por hoja.
  const canGrade = !selectedAssignment || selectedAssignment.gradeType === 'point'
  const ready = Boolean(courseOfferingId)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <header>
        <h1 className="text-2xl font-bold text-gray-900">Notas (Moodle)</h1>
        <p className="mt-1 text-sm text-gray-600">
          Descargá la planilla de un curso, asignatura o tarea; cargá las notas offline y subila para
          escribirlas en Moodle. Con menos filtros, la planilla trae una hoja por tarea.
        </p>
      </header>

      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className={`grid gap-4 ${orientations.length > 0 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
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

          {orientations.length > 0 ? (
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Orientación</span>
              <select
                className="w-full rounded-lg border border-gray-300 px-3 py-2"
                value={courseOrientationId}
                onChange={(e) => setCourseOrientationId(e.target.value)}
              >
                <option value="">General / todas</option>
                {orientations.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.orientation.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Asignatura</span>
            <select
              className="w-full rounded-lg border border-gray-300 px-3 py-2 disabled:bg-gray-100"
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={!courseId}
            >
              <option value="">Todas las asignaturas</option>
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
              <option value="">{loadingActivities ? 'Cargando…' : 'Todas las tareas'}</option>
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
            {result.errors.map((err, idx) => (
              <li key={`${err.sheet ?? ''}-${err.row ?? 'hoja'}-${idx}`}>
                <span className="font-medium">
                  {err.sheet ? `${err.sheet} — ` : ''}
                  {err.row != null ? `Fila ${err.row}:` : 'Hoja:'}
                </span>{' '}
                {err.message}
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
