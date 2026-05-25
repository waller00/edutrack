'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import CourseDetailPanel from '@/components/admin/courses/CourseDetailPanel'
import type { CourseGroup } from '@/components/admin/courses/course-sidebar'
import { groupCoursesForSidebar } from '@/components/admin/courses/course-sidebar'
import type {
  CourseOrientationRow,
  CourseRow,
  OrientationRow,
  SubjectRow,
} from '@/components/admin/courses/course-types'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { BookOpen, ChevronDown, ChevronRight, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

type CourseDraft = {
  name: string
  code: string
  level: 'EBI' | 'EMS'
  sortOrder: number
  description: string
  isActive: boolean
  offerInSchoolYear: boolean
}

function emptyCourseDraft(): CourseDraft {
  return { name: '', code: '', level: 'EBI', sortOrder: 0, description: '', isActive: true, offerInSchoolYear: true }
}

export default function AdminCoursesPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const activeSchoolYearId = syCtx?.allYears ? null : syCtx?.selectedId ?? syCtx?.activeId ?? null
  const schoolYearLabel = useMemo(() => {
    if (syCtx?.allYears) return 'Todos los ciclos'
    const id = syCtx?.selectedId ?? syCtx?.activeId
    const y = syCtx?.years.find((row) => row.id === id)
    return y ? `${y.code} — ${y.label}` : 'Ciclo activo'
  }, [syCtx])

  const [showInactiveNotOffered, setShowInactiveNotOffered] = useState(false)
  const [courses, setCourses] = useState<CourseRow[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(emptyCourseDraft())
  const [creatingCourse, setCreatingCourse] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [orientations, setOrientations] = useState<OrientationRow[]>([])
  const [courseOrientations, setCourseOrientations] = useState<CourseOrientationRow[]>([])
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({ EBI: true, EMS: true, OTROS: true })
  const [showCreateCourse, setShowCreateCourse] = useState(false)

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true)
    setMsg('')
    try {
      const qs = showInactiveNotOffered ? 'all=1&includeNotOffered=1' : ''
      const list = await api<CourseRow[]>(withSchoolYear(`/courses?${qs}`, schoolYearQuery))
      setCourses(Array.isArray(list) ? list : [])
    } catch {
      setCourses([])
      setMsg('No se pudieron cargar los cursos.')
    } finally {
      setCoursesLoading(false)
    }
  }, [schoolYearQuery, showInactiveNotOffered])

  const loadOrientations = useCallback(async () => {
    try {
      const list = await api<OrientationRow[]>('/courses/orientations?all=1')
      setOrientations(Array.isArray(list) ? list : [])
    } catch {
      setOrientations([])
    }
  }, [])

  const loadCourseOrientations = useCallback(
    async (courseId: string) => {
      try {
        const list = await api<CourseOrientationRow[]>(
          withSchoolYear(`/courses/${courseId}/orientations?all=1`, schoolYearQuery),
        )
        setCourseOrientations(Array.isArray(list) ? list : [])
      } catch {
        setCourseOrientations([])
      }
    },
    [schoolYearQuery],
  )

  const loadSubjects = useCallback(
    async (courseId: string) => {
      setSubjectsLoading(true)
      try {
        const list = await api<SubjectRow[]>(
          withSchoolYear(`/courses/${courseId}/subjects?all=1`, schoolYearQuery),
        )
        setSubjects(Array.isArray(list) ? list : [])
      } catch {
        setSubjects([])
        setMsg('No se pudieron cargar las asignaturas.')
      } finally {
        setSubjectsLoading(false)
      }
    },
    [schoolYearQuery],
  )

  useEffect(() => {
    void loadCourses()
    void loadOrientations()
  }, [loadCourses, loadOrientations])

  useEffect(() => {
    if (!selectedCourseId) {
      setSubjects([])
      setCourseOrientations([])
      return
    }
    void loadSubjects(selectedCourseId)
    void loadCourseOrientations(selectedCourseId)
  }, [selectedCourseId, loadSubjects, loadCourseOrientations])

  const visibleCourses = useMemo(() => {
    if (showInactiveNotOffered) return courses
    return courses.filter((c) => c.isActive && c.courseOfferingId && (c.offeringIsActive ?? false))
  }, [courses, showInactiveNotOffered])

  const courseGroups: CourseGroup[] = useMemo(() => groupCoursesForSidebar(visibleCourses), [visibleCourses])
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? visibleCourses.find((c) => c.id === selectedCourseId)

  const ws = (path: string) => withSchoolYear(path, schoolYearQuery)

  async function createCourse() {
    if (!courseDraft.name.trim()) {
      setMsg('Escribí el nombre del curso.')
      return
    }
    if (courseDraft.offerInSchoolYear && !activeSchoolYearId) {
      setMsg('Elegí un ciclo lectivo concreto para ofertar el curso.')
      return
    }
    setCreatingCourse(true)
    setMsg('')
    try {
      const created = await api<CourseRow>('/courses', {
        method: 'POST',
        body: JSON.stringify({
          name: courseDraft.name.trim(),
          code: courseDraft.code.trim() || undefined,
          level: courseDraft.level,
          sortOrder: Number(courseDraft.sortOrder) || 0,
          description: courseDraft.description.trim() || undefined,
          isActive: courseDraft.isActive,
          offerInSchoolYear: courseDraft.offerInSchoolYear,
          schoolYearId: courseDraft.offerInSchoolYear ? activeSchoolYearId : undefined,
        }),
      })
      setCourseDraft(emptyCourseDraft())
      setShowCreateCourse(false)
      await loadCourses()
      setSelectedCourseId(created.id)
      setMsg(courseDraft.offerInSchoolYear ? 'Curso creado y ofertado en el ciclo.' : 'Curso creado en el catálogo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al crear curso.')
    } finally {
      setCreatingCourse(false)
    }
  }

  async function toggleCourseActive(course: CourseRow) {
    setMsg('')
    try {
      const currentlyActive = course.offeringIsActive ?? course.isActive
      const updated = await api<CourseRow>(ws(`/courses/${course.id}`), {
        method: 'PUT',
        body: JSON.stringify({ offeringIsActive: !currentlyActive }),
      })
      setCourses((current) =>
        current.map((row) =>
          row.id === course.id ? { ...row, ...updated, offeringIsActive: !currentlyActive } : row,
        ),
      )
      setMsg(!currentlyActive ? 'Curso activado en el ciclo.' : 'Curso desactivado en el ciclo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al cambiar el estado del curso.')
    }
  }

  async function removeCourse(course: CourseRow) {
    if (!confirm(`¿Quitar "${course.name}" de este ciclo? El catálogo y sus asignaturas se conservan.`)) return
    setMsg('')
    try {
      await api(ws(`/courses/${course.id}`), { method: 'DELETE' })
      setCourses((current) => current.filter((row) => row.id !== course.id))
      if (selectedCourseId === course.id) setSelectedCourseId(null)
      setMsg('Curso quitado del ciclo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al eliminar curso.')
    }
  }

  return (
    <RoleGuard permission="courses.manage">
      <main className="responsive-page max-w-[1600px] space-y-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <BookOpen className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Cursos y asignaturas</h1>
            <p className="text-gray-600">
              Elegí un curso a la izquierda. Las asignaturas comunes y las de cada orientación se gestionan en
              contextos separados.
            </p>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={showInactiveNotOffered}
              onChange={(e) => setShowInactiveNotOffered(e.target.checked)}
            />
            Mostrar inactivos / no ofertados
          </label>
        </div>

        {msg ? (
          <div className="rounded border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800">{msg}</div>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-[minmax(260px,320px)_minmax(0,1fr)]">
          <aside className="rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-gray-900">Catálogo por nivel</h2>
                <Layers className="h-4 w-4 text-emerald-600" aria-hidden />
              </div>
              <p className="mt-1 text-xs text-gray-500">Ciclo: {schoolYearLabel}</p>
              <button
                type="button"
                onClick={() => setShowCreateCourse((v) => !v)}
                className="mt-2 inline-flex w-full items-center justify-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {showCreateCourse ? 'Ocultar formulario' : 'Nuevo curso'}
              </button>
            </div>

            {showCreateCourse ? (
              <div className="border-b border-gray-100 bg-emerald-50/30 p-3">
                <div className="grid gap-2">
                  <input
                    className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    placeholder="Nombre del curso"
                    value={courseDraft.name}
                    onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })}
                  />
                  <select
                    className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    value={courseDraft.level}
                    onChange={(e) => setCourseDraft({ ...courseDraft, level: e.target.value as 'EBI' | 'EMS' })}
                  >
                    <option value="EBI">EBI</option>
                    <option value="EMS">EMS</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={courseDraft.offerInSchoolYear}
                      onChange={(e) => setCourseDraft({ ...courseDraft, offerInSchoolYear: e.target.checked })}
                    />
                    Ofertar en ciclo actual
                  </label>
                  <button
                    type="button"
                    disabled={creatingCourse}
                    onClick={() => void createCourse()}
                    className="rounded bg-emerald-600 px-2 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    Crear curso
                  </button>
                </div>
              </div>
            ) : null}

            {coursesLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Cargando…
              </div>
            ) : visibleCourses.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No hay cursos para mostrar con este filtro.</p>
            ) : (
              <div className="max-h-[min(70vh,640px)] overflow-y-auto p-2">
                {courseGroups.map((group) => (
                  <div key={group.key} className="mb-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between rounded-md bg-slate-50 px-2 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-gray-700 hover:bg-slate-100"
                      onClick={() => setExpandedGroups((c) => ({ ...c, [group.key]: !(c[group.key] ?? true) }))}
                    >
                      <span className="flex items-center gap-1">
                        {(expandedGroups[group.key] ?? true) ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {group.title}
                      </span>
                      <span className="font-normal text-gray-500">{group.items.length}</span>
                    </button>
                    {(expandedGroups[group.key] ?? true) && (
                      <ul className="mt-1 space-y-0.5">
                        {group.items.map((c) => {
                          const offered = Boolean(c.courseOfferingId && (c.offeringIsActive ?? false))
                          const dim = !c.isActive || !offered
                          return (
                            <li key={c.id}>
                              <div
                                className={`rounded-md border px-2 py-2 text-sm ${
                                  selectedCourseId === c.id
                                    ? 'border-emerald-500 bg-emerald-50'
                                    : dim
                                      ? 'border-transparent bg-gray-50/80 opacity-80'
                                      : 'border-transparent hover:bg-gray-50'
                                }`}
                              >
                                <button
                                  type="button"
                                  className="w-full text-left"
                                  onClick={() => setSelectedCourseId(c.id)}
                                >
                                  <div className="font-medium text-gray-900">{c.displayLabel}</div>
                                  <div className="mt-0.5 text-[11px] text-gray-500">
                                    {!c.courseOfferingId
                                      ? 'No ofertado'
                                      : offered
                                        ? 'Ofertado'
                                        : 'Oferta inactiva'}
                                    {!c.isActive ? ' · Catálogo inactivo' : ''}
                                  </div>
                                </button>
                                <div className="mt-1 flex justify-end gap-0.5">
                                  <button
                                    type="button"
                                    role="switch"
                                    aria-checked={offered}
                                    className={`relative h-5 w-9 rounded-full ${offered ? 'bg-emerald-600' : 'bg-gray-300'}`}
                                    title="Oferta en ciclo"
                                    onClick={() => void toggleCourseActive(c)}
                                  >
                                    <span
                                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${offered ? 'left-4' : 'left-0.5'}`}
                                    />
                                  </button>
                                  <button
                                    type="button"
                                    className="rounded p-1 text-red-600 hover:bg-red-50"
                                    title="Quitar del ciclo"
                                    onClick={() => void removeCourse(c)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                  </button>
                                </div>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>

          <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {!selectedCourse ? (
              <div className="flex min-h-[400px] flex-col items-center justify-center p-8 text-center text-gray-500">
                <Pencil className="mb-3 h-10 w-10 text-gray-300" aria-hidden />
                <p className="text-sm">Seleccioná un curso para ver asignaturas comunes, orientaciones y oferta en el ciclo.</p>
              </div>
            ) : (
              <CourseDetailPanel
                key={selectedCourse.id}
                course={selectedCourse}
                schoolYearLabel={schoolYearLabel}
                subjects={subjects}
                subjectsLoading={subjectsLoading}
                courseOrientations={courseOrientations}
                orientationsCatalog={orientations}
                onReloadSubjects={() => loadSubjects(selectedCourse.id)}
                onReloadOrientations={() => loadCourseOrientations(selectedCourse.id)}
                onCourseUpdated={(updated) => {
                  setCourses((cur) => cur.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)))
                }}
                onMessage={setMsg}
                withSchoolYear={ws}
              />
            )}
          </section>
        </div>
      </main>
    </RoleGuard>
  )
}
