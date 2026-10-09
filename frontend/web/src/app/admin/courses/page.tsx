'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import UserActionsMenu from '@/components/admin/UserActionsMenu'
import SubjectListBlock from '@/components/admin/courses/SubjectListBlock'
import type {
  CourseOrientationRow,
  CourseRow,
  OrientationRow,
  SubjectDraft,
  SubjectRow,
} from '@/components/admin/courses/course-types'
import { courseShortLabel, isOfferedInCycle, partitionSubjects } from '@/components/admin/courses/course-types'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, Loader2, Pencil, Plus, Power, Search, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { withSchoolYear } from '@/lib/admin/school-year-query'

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

  const [courses, setCourses] = useState<CourseRow[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(emptyCourseDraft())
  const [creatingCourse, setCreatingCourse] = useState(false)
  const [courseSearch, setCourseSearch] = useState('')
  const [offeringFilter, setOfferingFilter] = useState<'all' | 'offered' | 'not-offered'>('all')
  const [updatingOffering, setUpdatingOffering] = useState(false)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)
  const [orientations, setOrientations] = useState<OrientationRow[]>([])
  const [courseOrientations, setCourseOrientations] = useState<CourseOrientationRow[]>([])
  const [showCreateCourse, setShowCreateCourse] = useState(false)
  const [showHistoricalSubjects, setShowHistoricalSubjects] = useState(false)
  const [orientationsOpen, setOrientationsOpen] = useState(false)
  const [showAddOrientation, setShowAddOrientation] = useState(false)
  const [orientationMode, setOrientationMode] = useState<'existing' | 'new'>('existing')
  const [selectedCourseOrientationId, setSelectedCourseOrientationId] = useState<string | null>(null)
  const [attachOrientationId, setAttachOrientationId] = useState('')
  const [newOrientationName, setNewOrientationName] = useState('')
  const [editingOrientationId, setEditingOrientationId] = useState<string | null>(null)
  const [editingOrientationName, setEditingOrientationName] = useState('')

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true)
    setMsg('')
    try {
      const list = await api<CourseRow[]>(
        withSchoolYear('/courses?all=1&includeNotOffered=1', schoolYearQuery),
      )
      setCourses(Array.isArray(list) ? list : [])
    } catch {
      setCourses([])
      setMsg('No se pudieron cargar los cursos.')
    } finally {
      setCoursesLoading(false)
    }
  }, [schoolYearQuery])

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
          withSchoolYear(`/courses/${courseId}/subjects?all=1&includeNotOffered=1`, schoolYearQuery),
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
    setSubjects([])
    setCourseOrientations([])
    setOrientationsOpen(false)
    setShowAddOrientation(false)
    setShowHistoricalSubjects(false)
    setSelectedCourseOrientationId(null)
    setAttachOrientationId('')
    setNewOrientationName('')
    setEditingOrientationId(null)
    setEditingOrientationName('')
    void loadSubjects(selectedCourseId)
    void loadCourseOrientations(selectedCourseId)
  }, [selectedCourseId, loadSubjects, loadCourseOrientations])

  const visibleCourses = useMemo(
    () =>
      [...courses].sort(
        (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'es'),
      ),
    [courses],
  )
  useEffect(() => {
    if (!activeSchoolYearId) setOfferingFilter('all')
  }, [activeSchoolYearId])

  const filteredCourses = useMemo(() => {
    const term = courseSearch.trim().toLocaleLowerCase('es')
    return visibleCourses.filter((course) => {
      const matchesSearch = !term || course.name.toLocaleLowerCase('es').includes(term) || (course.code ?? '').toLocaleLowerCase('es').includes(term)
      const matchesOffering = offeringFilter === 'all' || isOfferedInCycle(course) === (offeringFilter === 'offered')
      return matchesSearch && matchesOffering
    })
  }, [visibleCourses, courseSearch, offeringFilter])
  const selectedCourse = courses.find((c) => c.id === selectedCourseId)
  const selectedCourseOrientation =
    courseOrientations.find((row) => row.id === selectedCourseOrientationId) ?? null
  const currentSubjects = useMemo(
    () =>
      showHistoricalSubjects
        ? subjects
        : subjects.filter(
            (s) =>
              s.isActive &&
              (s.assignmentIsActive ?? true) &&
              (s.assignmentIsOffered ?? true) &&
              (s.visibleInFilters ?? true),
          ),
    [subjects, showHistoricalSubjects],
  )
  const { common, byOrientation } = useMemo(() => partitionSubjects(currentSubjects), [currentSubjects])
  const selectedSpecificSubjects = selectedCourseOrientation
    ? byOrientation.get(selectedCourseOrientation.orientationId) ?? []
    : []
  const unattachedOrientations = useMemo(
    () => orientations.filter((o) => !courseOrientations.some((co) => co.orientationId === o.id)),
    [orientations, courseOrientations],
  )

  const ws = (path: string) => withSchoolYear(path, schoolYearQuery)
  const adminPath = (path: string) => {
    const separator = path.includes('?') ? '&' : '?'
    return ws(`${path}${separator}all=1&includeNotOffered=1`)
  }

  async function createCourse() {
    const offerInSchoolYear = Boolean(activeSchoolYearId) && courseDraft.offerInSchoolYear
    if (!courseDraft.name.trim()) {
      setMsg('Escribí el nombre del curso.')
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
          sortOrder: Number(courseDraft.sortOrder) || 0,
          description: courseDraft.description.trim() || undefined,
          isActive: courseDraft.isActive,
          offerInSchoolYear,
          schoolYearId: offerInSchoolYear ? activeSchoolYearId : undefined,
        }),
      })
      setCourseDraft(emptyCourseDraft())
      setShowCreateCourse(false)
      await loadCourses()
      setSelectedCourseId(created.id)
      setMsg(offerInSchoolYear ? 'Curso creado y ofertado en el ciclo.' : 'Curso creado en el catálogo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al crear curso.')
    } finally {
      setCreatingCourse(false)
    }
  }

  async function toggleCourseOffering(course: CourseRow) {
    if (!activeSchoolYearId) {
      setMsg('Elegí un ciclo lectivo concreto para activar o desactivar la oferta.')
      return
    }
    const offered = isOfferedInCycle(course)
    setUpdatingOffering(true)
    setMsg('')
    try {
      const updated = await api<CourseRow>(ws(`/courses/${course.id}`), {
        method: 'PUT',
        body: JSON.stringify({ offeringIsActive: !offered }),
      })
      setCourses((current) => current.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
      setMsg(!offered ? 'Curso activado en el ciclo.' : 'Curso desactivado en el ciclo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la oferta del curso.')
    } finally {
      setUpdatingOffering(false)
    }
  }

  async function createSubject(draft: SubjectDraft, opts: { common: boolean; orientationId?: string }) {
    if (!selectedCourse) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/subjects`), {
        method: 'POST',
        body: JSON.stringify({
          name: draft.name.trim(),
          sortOrder: Number(draft.sortOrder) || 0,
          isActive: true,
          associationType: opts.common ? (selectedCourse.level === 'EMS' ? 'TRONCO_COMUN_CURSO' : 'CURSO_COMPLETO') : 'ORIENTACION',
          orientationId: opts.orientationId,
        }),
      })
      await loadSubjects(selectedCourse.id)
      onMessage(opts.common ? 'Asignatura común agregada.' : 'Asignatura específica agregada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo agregar la asignatura.')
      throw e
    }
  }

  async function updateSubject(id: string, draft: SubjectDraft) {
    if (!selectedCourse) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/subjects/${id}`), {
        method: 'PUT',
        body: JSON.stringify({
          name: draft.name.trim(),
          code: draft.code.trim() || null,
          description: draft.description.trim() || null,
          sortOrder: Number(draft.sortOrder) || 0,
          isActive: draft.isActive,
        }),
      })
      await loadSubjects(selectedCourse.id)
      onMessage('Asignatura actualizada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la asignatura.')
      throw e
    }
  }

  async function removeSubject(id: string) {
    if (!selectedCourse) return
    if (!confirm('¿Eliminar esta asignatura del plan?')) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/subjects/${id}`), { method: 'DELETE' })
      await loadSubjects(selectedCourse.id)
      onMessage('Asignatura quitada del plan.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo quitar la asignatura.')
    }
  }

  async function attachOrientation() {
    if (!selectedCourse || !attachOrientationId) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/orientations`), {
        method: 'POST',
        body: JSON.stringify({ orientationId: attachOrientationId, isActive: true }),
      })
      setAttachOrientationId('')
      setShowAddOrientation(false)
      await loadCourseOrientations(selectedCourse.id)
      onMessage('Orientación agregada al curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo agregar la orientación.')
    }
  }

  async function createOrientation() {
    if (!selectedCourse || !newOrientationName.trim()) return
    setMsg('')
    try {
      const created = await api<OrientationRow>('/courses/orientations', {
        method: 'POST',
        body: JSON.stringify({ name: newOrientationName.trim(), isActive: true }),
      })
      await api(adminPath(`/courses/${selectedCourse.id}/orientations`), {
        method: 'POST',
        body: JSON.stringify({ orientationId: created.id, isActive: true }),
      })
      setNewOrientationName('')
      setShowAddOrientation(false)
      await loadOrientations()
      await loadCourseOrientations(selectedCourse.id)
      onMessage('Orientación creada y agregada al curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo crear la orientación.')
    }
  }

  async function updateOrientation(row: CourseOrientationRow) {
    if (!selectedCourse || !editingOrientationName.trim()) return
    setMsg('')
    try {
      await api<OrientationRow>(`/courses/orientations/${row.orientationId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editingOrientationName.trim() }),
      })
      setEditingOrientationId(null)
      setEditingOrientationName('')
      await loadOrientations()
      await loadCourseOrientations(selectedCourse.id)
      onMessage('Orientación actualizada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la orientación.')
    }
  }

  async function toggleOrientationOffer(row: CourseOrientationRow) {
    if (!selectedCourse) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/orientations`), {
        method: 'POST',
        body: JSON.stringify({ orientationId: row.orientationId, isActive: !row.isActive }),
      })
      await loadCourseOrientations(selectedCourse.id)
      await loadSubjects(selectedCourse.id)
      onMessage(!row.isActive ? 'Orientación activada en el curso.' : 'Orientación desactivada en el curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo actualizar la orientación.')
    }
  }

  async function removeOrientationFromCourse(row: CourseOrientationRow) {
    if (!selectedCourse) return
    if (!confirm(`¿Quitar "${row.orientation.name}" de ${courseShortLabel(selectedCourse.name)}?`)) return
    setMsg('')
    try {
      await api(adminPath(`/courses/${selectedCourse.id}/orientations/${row.id}`), { method: 'DELETE' })
      await loadCourseOrientations(selectedCourse.id)
      await loadSubjects(selectedCourse.id)
      onMessage('Orientación quitada del curso.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo quitar la orientación.')
    }
  }

  async function deleteOrientation(row: CourseOrientationRow) {
    if (!selectedCourse) return
    if (!confirm(`¿Eliminar "${row.orientation.name}" del catálogo? También se ocultará de los cursos donde esté asociada.`)) return
    setMsg('')
    try {
      await api(`/courses/orientations/${row.orientationId}`, { method: 'DELETE' })
      await loadOrientations()
      await loadCourseOrientations(selectedCourse.id)
      await loadSubjects(selectedCourse.id)
      onMessage('Orientación eliminada del catálogo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'No se pudo eliminar la orientación.')
    }
  }

  function onMessage(message: string) {
    setMsg(message)
  }

  return (
    <RoleGuard permission="courses.manage">
      <main className="responsive-page max-w-[1600px] space-y-5">
        <header className="flex flex-wrap items-center gap-3">
          <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 sm:flex">
            <BookOpen className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold">Cursos y asignaturas</h1>
            <p className="text-sm text-gray-600">Elegí un curso para gestionar su oferta y sus asignaturas.</p>
          </div>
          <button type="button" aria-expanded={showCreateCourse} aria-controls="new-course-form" onClick={() => {
            setCourseDraft((draft) => ({ ...draft, offerInSchoolYear: Boolean(activeSchoolYearId) }))
            setShowCreateCourse((value) => !value)
          }} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <Plus className="h-4 w-4" aria-hidden />Nuevo curso
          </button>
        </header>

        {msg ? <div role="status" className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800">{msg}</div> : null}

        {showCreateCourse ? (
          <form id="new-course-form" onSubmit={(event) => { event.preventDefault(); void createCourse() }} className="space-y-4 rounded-xl border border-emerald-200 bg-white p-4 shadow-sm sm:p-5">
            <h2 className="font-semibold text-gray-900">Nuevo curso</h2>
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Nombre del curso</span>
                <input autoFocus required className="input-field" placeholder="Ej. Primero" value={courseDraft.name} onChange={(e) => setCourseDraft({ ...courseDraft, name: e.target.value })} />
              </label>
              <label className="space-y-1 text-sm font-medium text-gray-700">
                <span>Orden en el listado</span>
                <input type="number" className="input-field" value={courseDraft.sortOrder} onChange={(e) => setCourseDraft({ ...courseDraft, sortOrder: Number(e.target.value) })} />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input type="checkbox" disabled={!activeSchoolYearId} checked={Boolean(activeSchoolYearId) && courseDraft.offerInSchoolYear} onChange={(e) => setCourseDraft({ ...courseDraft, offerInSchoolYear: e.target.checked })} />
              Ofertar en {schoolYearLabel}
            </label>
            {!activeSchoolYearId ? <p className="text-xs text-gray-500">Elegí un ciclo lectivo para ofertarlo. Podés crearlo ahora en el catálogo.</p> : null}
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={creatingCourse} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60">
                {creatingCourse ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}Crear curso
              </button>
              <button type="button" disabled={creatingCourse} onClick={() => setShowCreateCourse(false)} className="min-h-10 rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50">Cancelar</button>
            </div>
          </form>
        ) : null}

        <div className="grid items-start gap-5 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside aria-label="Catálogo de cursos" className={`${selectedCourse ? 'hidden lg:block' : ''} min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm`}>
            <div className="space-y-3 border-b border-gray-100 p-4">
              <div>
                <h2 className="font-semibold text-gray-900">Cursos</h2>
                <p className="mt-1 text-xs text-gray-500">{schoolYearLabel}</p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden />
                <input type="search" value={courseSearch} onChange={(e) => setCourseSearch(e.target.value)} placeholder="Buscar por nombre o código" aria-label="Buscar curso" className="min-h-10 w-full rounded-lg border border-gray-300 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-gray-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100" />
              </div>
              <div role="group" aria-label="Filtrar cursos por oferta" className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
                {([{ value: 'all', label: 'Todos' }, { value: 'offered', label: 'Ofertados' }, { value: 'not-offered', label: 'No ofertados' }] as const).map(({ value, label }) => (
                  <button key={value} type="button" aria-pressed={offeringFilter === value} disabled={value !== 'all' && !activeSchoolYearId} onClick={() => setOfferingFilter(value)} className={`min-h-9 flex-1 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition disabled:opacity-50 ${offeringFilter === value ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-600 hover:bg-white/70'}`}>
                    {label}
                  </button>
                ))}
              </div>
              {!activeSchoolYearId ? <p className="text-xs text-gray-500">Elegí un ciclo para filtrar y modificar su oferta.</p> : null}
              {!coursesLoading ? <p className="text-xs text-gray-500">Mostrando {filteredCourses.length} de {courses.length} cursos</p> : null}
            </div>

            {coursesLoading ? (
              <div className="flex items-center gap-2 p-4 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Cargando cursos…</div>
            ) : visibleCourses.length === 0 ? (
              <p className="p-4 text-sm text-gray-500">No hay cursos en el catálogo.</p>
            ) : filteredCourses.length === 0 ? (
              <div className="space-y-3 p-4 text-sm text-gray-500">
                <p>{courseSearch.trim() ? `Ningún curso coincide con «${courseSearch.trim()}» y estos filtros.` : 'No hay cursos con este estado de oferta.'}</p>
                <button type="button" onClick={() => { setCourseSearch(''); setOfferingFilter('all') }} className="font-medium text-emerald-700 hover:underline">Limpiar filtros</button>
              </div>
            ) : (
              <ul className="max-h-80 space-y-1 overflow-y-auto p-2 lg:max-h-[min(70vh,640px)]">
                {filteredCourses.map((course) => (
                  <li key={course.id}>
                    <button type="button" aria-current={selectedCourseId === course.id ? 'true' : undefined} onClick={() => setSelectedCourseId(course.id)} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left ${selectedCourseId === course.id ? 'border-emerald-300 bg-emerald-50' : 'border-transparent hover:bg-gray-50'}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block break-words text-sm font-medium text-gray-900">{course.name}</span>
                        <span className="mt-1 block text-xs text-gray-500">
                          {activeSchoolYearId ? (isOfferedInCycle(course) ? 'Ofertado' : 'No ofertado') : (course.code ? `Código ${course.code}` : 'Curso del catálogo')}
                          {!course.isActive ? ' · Catálogo inactivo' : ''}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section aria-label="Detalle del curso" className={`${!selectedCourse ? 'hidden lg:block' : ''} min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm`}>
            {!selectedCourse ? (
              <div className="flex min-h-60 flex-col items-center justify-center p-8 text-center lg:min-h-[400px]">
                <BookOpen className="mb-3 h-10 w-10 text-emerald-200" aria-hidden />
                <h2 className="font-semibold text-gray-700">Seleccioná un curso</h2>
                <p className="mt-1 text-sm text-gray-500">Acá vas a ver sus asignaturas y orientaciones.</p>
              </div>
            ) : (
              <div className="space-y-5 p-4 sm:p-5">
                <button type="button" onClick={() => setSelectedCourseId(null)} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 lg:hidden">
                  <ArrowLeft className="h-4 w-4" aria-hidden />Volver a cursos
                </button>
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 pb-4">
                  <div className="min-w-0">
                    <h2 className="break-words text-xl font-bold text-gray-900">{courseShortLabel(selectedCourse.name)}</h2>
                    <p className="mt-1 text-xs text-gray-500">{schoolYearLabel}{!selectedCourse.isActive ? ' · Catálogo inactivo' : ''}</p>
                  </div>
                  <div className="space-y-1">
                    <button type="button" role="switch" aria-label={`Oferta de ${selectedCourse.name} en el ciclo`} aria-checked={isOfferedInCycle(selectedCourse)} disabled={!activeSchoolYearId || updatingOffering} onClick={() => void toggleCourseOffering(selectedCourse)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      {updatingOffering ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : (
                        <span className={`relative h-5 w-9 shrink-0 rounded-full ${isOfferedInCycle(selectedCourse) ? 'bg-emerald-600' : 'bg-gray-300'}`} aria-hidden>
                          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow ${isOfferedInCycle(selectedCourse) ? 'left-4' : 'left-0.5'}`} />
                        </span>
                      )}
                      {activeSchoolYearId ? (isOfferedInCycle(selectedCourse) ? 'Ofertado en el ciclo' : 'No ofertado en el ciclo') : 'Elegí un ciclo para ofertar'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className="w-full min-w-0 space-y-1 text-sm font-medium text-gray-700 sm:w-auto sm:max-w-sm sm:flex-1">
                    <span>Ver asignaturas</span>
                    <select aria-label="Ver asignaturas" value={selectedCourseOrientation?.id ?? ''} onChange={(event) => setSelectedCourseOrientationId(event.target.value || null)} className="input-field">
                      <option value="">Asignaturas comunes</option>
                      {courseOrientations.map((row) => <option key={row.id} value={row.id}>{row.orientation.name}{!row.isActive ? ' (inactiva)' : ''}</option>)}
                    </select>
                  </label>
                  <details className="text-sm text-gray-600">
                    <summary className="cursor-pointer rounded-lg px-2 py-2 hover:bg-gray-50">Más opciones</summary>
                    <label className="mt-2 flex items-center gap-2 rounded-lg bg-gray-50 p-3 text-xs">
                      <input type="checkbox" checked={showHistoricalSubjects} onChange={(e) => setShowHistoricalSubjects(e.target.checked)} />Ver asignaturas históricas
                    </label>
                  </details>
                </div>

                {selectedCourseOrientation ? (
                  <details key={selectedCourseOrientation.id} className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
                    <summary className="cursor-pointer font-medium">Comunes heredadas de {courseShortLabel(selectedCourse.name)} ({common.length})</summary>
                    {common.length === 0 ? <p className="mt-3 text-sky-900/70">Todavía no hay comunes cargadas.</p> : (
                      <ul className="mt-3 grid gap-1 text-gray-800 sm:grid-cols-2">{common.map((subject) => <li key={subject.id}>{subject.name}</li>)}</ul>
                    )}
                  </details>
                ) : null}

                <SubjectListBlock
                  key={`${selectedCourse.id}:${selectedCourseOrientation?.id ?? 'common'}`}
                  title={selectedCourseOrientation ? `Asignaturas de ${selectedCourseOrientation.orientation.name}` : 'Asignaturas comunes'}
                  subjects={selectedCourseOrientation ? selectedSpecificSubjects : common}
                  loading={subjectsLoading}
                  addLabel={selectedCourseOrientation ? 'Agregar específica' : 'Agregar asignatura'}
                  onCreate={(draft) => createSubject(draft, { common: !selectedCourseOrientation, orientationId: selectedCourseOrientation?.orientationId })}
                  onUpdate={updateSubject}
                  onRemove={removeSubject}
                  showStatus={showHistoricalSubjects}
                />

                <div className="rounded-lg border border-gray-200">
                  <button type="button" aria-expanded={orientationsOpen} aria-controls="course-orientations" onClick={() => setOrientationsOpen((value) => !value)} className="flex min-h-11 w-full items-center gap-2 p-3 text-left text-sm hover:bg-gray-50">
                    {orientationsOpen ? <ChevronDown className="h-4 w-4 text-gray-500" aria-hidden /> : <ChevronRight className="h-4 w-4 text-gray-500" aria-hidden />}
                    <span className="flex-1 font-medium text-gray-700">Gestionar orientaciones</span>
                    <span className="text-xs text-gray-500">{courseOrientations.length}</span>
                  </button>
                  {orientationsOpen ? (
                    <div id="course-orientations" className="space-y-3 border-t border-gray-100 p-3">
                      {courseOrientations.length === 0 ? <p className="text-sm text-gray-500">Este curso no tiene orientaciones.</p> : (
                        <ul className="divide-y divide-gray-100">
                          {courseOrientations.map((row) => (
                            <li key={row.id} className="py-2">
                              {editingOrientationId === row.id ? (
                                <form onSubmit={(event) => { event.preventDefault(); void updateOrientation(row) }} className="space-y-2">
                                  <label className="block space-y-1 text-sm text-gray-700">
                                    <span>Nombre de la orientación</span>
                                    <input autoFocus required className="input-field" value={editingOrientationName} onChange={(e) => setEditingOrientationName(e.target.value)} />
                                  </label>
                                  <div className="flex flex-wrap gap-2">
                                    <button type="submit" className="min-h-9 rounded-lg bg-emerald-600 px-3 py-2 text-xs text-white">Guardar</button>
                                    <button type="button" onClick={() => { setEditingOrientationId(null); setEditingOrientationName('') }} className="min-h-9 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600">Cancelar</button>
                                  </div>
                                </form>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <button type="button" onClick={() => setSelectedCourseOrientationId(row.id)} className="min-w-0 flex-1 rounded-lg py-2 text-left hover:bg-gray-50">
                                    <span className="block break-words text-sm font-medium text-gray-900">{row.orientation.name}</span>
                                    <span className="mt-1 block text-xs text-gray-500">{byOrientation.get(row.orientationId)?.length ?? 0} específicas{!row.isActive ? ' · Inactiva' : ''}</span>
                                  </button>
                                  <UserActionsMenu name={`orientación ${row.orientation.name}`} actions={[
                                    { label: 'Editar nombre', icon: Pencil, onSelect: () => { setEditingOrientationId(row.id); setEditingOrientationName(row.orientation.name) } },
                                    { label: row.isActive ? 'Desactivar en el curso' : 'Activar en el curso', icon: Power, onSelect: () => void toggleOrientationOffer(row) },
                                    { label: 'Quitar del curso', icon: X, destructive: true, onSelect: () => void removeOrientationFromCourse(row) },
                                    { label: 'Eliminar del catálogo', icon: Trash2, destructive: true, onSelect: () => void deleteOrientation(row) },
                                  ]} />
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                      <button type="button" aria-expanded={showAddOrientation} aria-controls="add-orientation-form" onClick={() => setShowAddOrientation((value) => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50">
                        <Plus className="h-4 w-4" aria-hidden />Agregar orientación
                      </button>
                      {showAddOrientation ? (
                        <form id="add-orientation-form" onSubmit={(event) => { event.preventDefault(); void (orientationMode === 'existing' ? attachOrientation() : createOrientation()) }} className="space-y-3 rounded-lg bg-gray-50 p-3">
                          <div role="group" aria-label="Tipo de orientación" className="flex flex-wrap gap-2">
                            {(['existing', 'new'] as const).map((mode) => <button key={mode} type="button" aria-pressed={orientationMode === mode} onClick={() => setOrientationMode(mode)} className={`min-h-9 rounded-lg px-3 py-2 text-xs ${orientationMode === mode ? 'bg-white font-medium text-emerald-800 shadow-sm' : 'text-gray-600'}`}>{mode === 'existing' ? 'Del catálogo' : 'Crear nueva'}</button>)}
                          </div>
                          {orientationMode === 'existing' ? (
                            <label className="block space-y-1 text-sm text-gray-700">
                              <span>Orientación del catálogo</span>
                              <select aria-label="Orientación del catálogo" required className="input-field" value={attachOrientationId} onChange={(e) => setAttachOrientationId(e.target.value)}>
                                <option value="">Seleccioná una orientación</option>
                                {unattachedOrientations.map((orientation) => <option key={orientation.id} value={orientation.id}>{orientation.name}</option>)}
                              </select>
                              {unattachedOrientations.length === 0 ? <span className="block text-xs text-gray-500">No quedan orientaciones para agregar. Podés crear una nueva.</span> : null}
                            </label>
                          ) : (
                            <label className="block space-y-1 text-sm text-gray-700"><span>Nueva orientación</span><input required className="input-field" value={newOrientationName} onChange={(e) => setNewOrientationName(e.target.value)} /></label>
                          )}
                          <div className="flex flex-wrap gap-2">
                            <button type="submit" disabled={orientationMode === 'existing' ? !attachOrientationId : !newOrientationName.trim()} className="min-h-10 rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">{orientationMode === 'existing' ? 'Agregar al curso' : 'Crear y agregar'}</button>
                            <button type="button" onClick={() => setShowAddOrientation(false)} className="min-h-10 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600">Cancelar</button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </RoleGuard>
  )
}
