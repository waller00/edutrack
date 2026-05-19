'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'

type CourseRow = {
  id: string
  name: string
  code: string | null
  description: string | null
  isActive: boolean
  schoolYearId?: string | null
  courseOfferingId?: string | null
  offeringIsActive?: boolean | null
}

type SubjectRow = {
  id: string
  name: string
  code: string | null
  description: string | null
  sortOrder: number
  isActive: boolean
  courseId: string
}

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

function emptySubjectDraft() {
  return { name: '', code: '', sortOrder: 0, description: '', isActive: true as boolean }
}

const ORIENTATION_LABELS: Record<string, string> = {
  CT: 'Ciencias y Tecnología',
  SH: 'Sociales y Humanidades',
  VIDA: 'Ciencias de la Vida',
  ARTE: 'Arte y Expresión',
}

const COURSE_BASES = [
  { key: 'EBI9', title: '9.º EBI', kind: 'EBI' },
  { key: 'EBI8', title: '8.º EBI', kind: 'EBI' },
  { key: 'EBI7', title: '7.º EBI', kind: 'EBI' },
  { key: 'EMS1', title: '1.º EMS', kind: 'EMS' },
  { key: 'EMS2', title: '2.º EMS', kind: 'EMS' },
  { key: 'EMS3', title: '3.º EMS', kind: 'EMS' },
] as const

type CourseBaseKey = (typeof COURSE_BASES)[number]['key']

type CourseDraft = {
  base: CourseBaseKey
  orientation: string
  subgroup: string
  isActive: boolean
}

type CourseGroup = {
  key: string
  title: string
  kind: string
  items: Array<CourseRow & { displayLabel: string }>
}

function emptyCourseDraft(): CourseDraft {
  return { base: 'EBI9', orientation: 'CT', subgroup: '', isActive: true }
}

function trimRepeatedChar(value: string, char: string) {
  let start = 0
  let end = value.length
  while (start < end && value[start] === char) start += 1
  while (end > start && value[end - 1] === char) end -= 1
  return value.slice(start, end)
}

function slug(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
  return trimRepeatedChar(normalized, '-')
}

function cleanCourseName(name: string) {
  let clean = name.trimEnd()
  const sectionMarker = ' sección '
  const lower = clean.toLowerCase()
  const sectionIndex = lower.lastIndexOf(sectionMarker)
  const sectionSuffixLength = sectionMarker.length + 1
  if (sectionIndex >= 0 && sectionIndex + sectionSuffixLength === clean.length) {
    clean = clean.slice(0, sectionIndex).trimEnd()
  }
  if (clean.length > 2 && clean.slice(-2).toLowerCase() === ' a') {
    clean = clean.slice(0, -2).trimEnd()
  }
  return clean.trim()
}

function courseDisplayLabel(course: CourseRow, groupTitle: string) {
  const name = cleanCourseName(course.name)
  if (name === groupTitle) return 'Grupo principal'
  if (name.startsWith(`${groupTitle} - `)) return name.slice(groupTitle.length + 3)
  if (name.startsWith(`${groupTitle} `)) return name.slice(groupTitle.length).trim()
  return name
}

function groupCourses(courses: CourseRow[]): CourseGroup[] {
  const buckets = new Map<string, CourseGroup>()
  for (const base of COURSE_BASES) {
    buckets.set(base.key, { key: base.key, title: base.title, kind: base.kind, items: [] })
  }
  buckets.set('OTROS', { key: 'OTROS', title: 'Otros cursos', kind: 'OTROS', items: [] })

  for (const course of courses) {
    const code = course.code ?? ''
    const ebi = code.match(/^EBI([789])-/)
    const ems = code.match(/^EMS([123])-/)
    const key = ebi ? `EBI${ebi[1]}` : ems ? `EMS${ems[1]}` : 'OTROS'
    const group = buckets.get(key) ?? buckets.get('OTROS')!
    group.items.push({ ...course, displayLabel: courseDisplayLabel(course, group.title) })
  }

  return [...buckets.values()]
    .map((group) => ({
      ...group,
      items: group.items.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
        return a.displayLabel.localeCompare(b.displayLabel, 'es')
      }),
    }))
    .filter((group) => group.items.length > 0)
}

export default function AdminCoursesPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const activeSchoolYearId = syCtx?.allYears ? null : syCtx?.selectedId ?? syCtx?.activeId ?? null

  const [courses, setCourses] = useState<CourseRow[]>([])
  const [coursesLoading, setCoursesLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [courseDraft, setCourseDraft] = useState<CourseDraft>(emptyCourseDraft)
  const [creatingCourse, setCreatingCourse] = useState(false)
  const [editingCourseId, setEditingCourseId] = useState<string | null>(null)
  const [courseEditDraft, setCourseEditDraft] = useState({ name: '', code: '', description: '', isActive: true })

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [subjects, setSubjects] = useState<SubjectRow[]>([])
  const [subjectsLoading, setSubjectsLoading] = useState(false)

  const [createDraft, setCreateDraft] = useState(emptySubjectDraft)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState(emptySubjectDraft)
  const courseGroups = useMemo(() => groupCourses(courses), [courses])

  const loadCourses = useCallback(async () => {
    setCoursesLoading(true)
    setMsg('')
    try {
      const list = await api<CourseRow[]>(withSchoolYear('/courses?all=1', schoolYearQuery))
      setCourses(Array.isArray(list) ? list : [])
    } catch {
      setCourses([])
      setMsg('No se pudieron cargar los cursos.')
    } finally {
      setCoursesLoading(false)
    }
  }, [schoolYearQuery])

  const loadSubjects = useCallback(
    async (courseId: string) => {
      setSubjectsLoading(true)
      try {
        const path = `/courses/${courseId}/subjects?all=1`
        const list = await api<SubjectRow[]>(withSchoolYear(path, schoolYearQuery))
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
  }, [loadCourses])

  useEffect(() => {
    setEditingId(null)
    setCreateDraft(emptySubjectDraft())
    if (!selectedCourseId) {
      setSubjects([])
      return
    }
    void loadSubjects(selectedCourseId)
  }, [selectedCourseId, loadSubjects])

  async function createSubject() {
    if (!selectedCourseId || !createDraft.name.trim()) return
    setMsg('')
    try {
      await api(
        withSchoolYear(`/courses/${selectedCourseId}/subjects`, schoolYearQuery),
        {
          method: 'POST',
          body: JSON.stringify({
            name: createDraft.name.trim(),
            code: createDraft.code.trim() || undefined,
            description: createDraft.description.trim() || undefined,
            sortOrder: Number(createDraft.sortOrder) || 0,
            isActive: createDraft.isActive,
          }),
        },
      )
      setCreateDraft(emptySubjectDraft())
      await loadSubjects(selectedCourseId)
      setMsg('Asignatura creada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al crear asignatura.')
    }
  }

  async function createCourseSubdivision() {
    if (!activeSchoolYearId) {
      setMsg('Elegí un ciclo lectivo concreto para crear cursos o subgrupos.')
      return
    }
    const baseMeta = COURSE_BASES.find((base) => base.key === courseDraft.base)
    if (!baseMeta) return

    const subgroup = courseDraft.subgroup.trim()
    const isEms = baseMeta.kind === 'EMS'
    const orientationLabel = ORIENTATION_LABELS[courseDraft.orientation] ?? courseDraft.orientation
    const name = isEms
      ? `${baseMeta.title} - ${orientationLabel}${subgroup ? ` - ${subgroup}` : ''}`
      : `${baseMeta.title}${subgroup ? ` - ${subgroup}` : ''}`
    const codeParts = [courseDraft.base, ...(isEms ? [courseDraft.orientation] : [])]
    if (subgroup) codeParts.push(slug(subgroup))
    const code = codeParts.join('-')

    setCreatingCourse(true)
    setMsg('')
    try {
      const created = await api<CourseRow>('/courses', {
        method: 'POST',
        body: JSON.stringify({
          name,
          code,
          description: isEms ? `Orientación ${orientationLabel}` : subgroup ? `Subgrupo ${subgroup}` : 'Curso base',
          isActive: courseDraft.isActive,
          schoolYearId: activeSchoolYearId,
        }),
      })
      setCourseDraft(emptyCourseDraft())
      await loadCourses()
      setSelectedCourseId(created.id)
      setMsg('Curso/subgrupo creado.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al crear curso/subgrupo.')
    } finally {
      setCreatingCourse(false)
    }
  }

  function startEditCourse(course: CourseRow) {
    setEditingCourseId(course.id)
    setCourseEditDraft({
      name: course.name,
      code: course.code ?? '',
      description: course.description ?? '',
      isActive: course.isActive,
    })
  }

  async function saveCourseEdit(courseId: string) {
    if (!courseEditDraft.name.trim()) return
    setMsg('')
    try {
      const updated = await api<CourseRow>(withSchoolYear(`/courses/${courseId}`, schoolYearQuery), {
        method: 'PUT',
        body: JSON.stringify({
          name: courseEditDraft.name.trim(),
          code: courseEditDraft.code.trim() || null,
          description: courseEditDraft.description.trim() || null,
          isActive: courseEditDraft.isActive,
        }),
      })
      setCourses((current) => current.map((course) => (course.id === courseId ? updated : course)))
      setEditingCourseId(null)
      setMsg('Curso actualizado.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al actualizar curso.')
    }
  }

  async function toggleCourseActive(course: CourseRow) {
    setMsg('')
    try {
      const currentlyActive = course.offeringIsActive ?? course.isActive
      const updated = await api<CourseRow>(withSchoolYear(`/courses/${course.id}`, schoolYearQuery), {
        method: 'PUT',
        body: JSON.stringify({ isActive: !currentlyActive }),
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
      await api(withSchoolYear(`/courses/${course.id}`, schoolYearQuery), { method: 'DELETE' })
      setCourses((current) => current.filter((row) => row.id !== course.id))
      if (selectedCourseId === course.id) setSelectedCourseId(null)
      setMsg('Curso quitado del ciclo.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al eliminar curso.')
    }
  }

  function startEdit(s: SubjectRow) {
    setEditingId(s.id)
    setEditDraft({
      name: s.name,
      code: s.code ?? '',
      sortOrder: s.sortOrder,
      description: s.description ?? '',
      isActive: s.isActive,
    })
  }

  async function saveEdit() {
    if (!selectedCourseId || !editingId || !editDraft.name.trim()) return
    setMsg('')
    try {
      await api(
        withSchoolYear(`/courses/${selectedCourseId}/subjects/${editingId}`, schoolYearQuery),
        {
          method: 'PUT',
          body: JSON.stringify({
            name: editDraft.name.trim(),
            code: editDraft.code.trim() || null,
            description: editDraft.description.trim() || null,
            sortOrder: Number(editDraft.sortOrder) || 0,
            isActive: editDraft.isActive,
          }),
        },
      )
      setEditingId(null)
      await loadSubjects(selectedCourseId)
      setMsg('Asignatura actualizada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al guardar.')
    }
  }

  async function removeSubject(subjectId: string) {
    if (!selectedCourseId) return
    if (!confirm('¿Eliminar esta asignatura?')) return
    setMsg('')
    try {
      await api(withSchoolYear(`/courses/${selectedCourseId}/subjects/${subjectId}`, schoolYearQuery), {
        method: 'DELETE',
      })
      if (editingId === subjectId) setEditingId(null)
      await loadSubjects(selectedCourseId)
      setMsg('Asignatura eliminada.')
    } catch (e: unknown) {
      setMsg((e as Error)?.message || 'Error al eliminar.')
    }
  }

  const selectedCourse = courses.find((c) => c.id === selectedCourseId)

  return (
    <RoleGuard permission="courses.manage">
      <main className="mx-auto max-w-7xl p-6 space-y-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-100">
            <BookOpen className="h-7 w-7 text-emerald-600" aria-hidden />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Cursos y asignaturas</h1>
            <p className="text-gray-600">
              Los cursos se muestran por nivel. Dentro de cada nivel podés manejar grupos, subgrupos u orientaciones.
            </p>
          </div>
        </div>

        {msg && (
          <div className="rounded border border-gray-200 bg-white px-4 py-2 text-sm text-gray-800">{msg}</div>
        )}

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Cursos</h2>
                <p className="text-xs text-gray-500">Catálogo estable; cada ciclo activa su propia oferta.</p>
              </div>
              <Layers className="h-5 w-5 text-emerald-600" aria-hidden />
            </div>

            <div className="mb-4 rounded-lg border border-dashed border-emerald-200 bg-emerald-50/40 p-3">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                <Plus className="h-4 w-4 text-emerald-700" aria-hidden />
                Crear grupo u orientación
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="block text-xs">
                  <span className="text-gray-600">Nivel</span>
                  <select
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    value={courseDraft.base}
                    onChange={(e) => {
                      const base = e.target.value as CourseBaseKey
                      setCourseDraft((current) => ({ ...current, base }))
                    }}
                  >
                    {COURSE_BASES.map((base) => (
                      <option key={base.key} value={base.key}>
                        {base.title}
                      </option>
                    ))}
                  </select>
                </label>
                {courseDraft.base.startsWith('EMS') ? (
                  <label className="block text-xs">
                    <span className="text-gray-600">Orientación</span>
                    <select
                      className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                      value={courseDraft.orientation}
                      onChange={(e) => setCourseDraft({ ...courseDraft, orientation: e.target.value })}
                    >
                      {Object.entries(ORIENTATION_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label className={`block text-xs ${courseDraft.base.startsWith('EMS') ? 'sm:col-span-2' : ''}`}>
                  <span className="text-gray-600">Subgrupo opcional</span>
                  <input
                    className="mt-1 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm"
                    value={courseDraft.subgroup}
                    onChange={(e) => setCourseDraft({ ...courseDraft, subgroup: e.target.value })}
                    placeholder="Ej. Grupo B, Taller, Laboratorio"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={courseDraft.isActive}
                    onChange={(e) => setCourseDraft({ ...courseDraft, isActive: e.target.checked })}
                  />
                  Activo
                </label>
              </div>
              <button
                type="button"
                onClick={() => void createCourseSubdivision()}
                disabled={creatingCourse || syCtx?.allYears}
                className="mt-3 inline-flex items-center gap-2 rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {creatingCourse ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                Crear
              </button>
              {syCtx?.allYears ? (
                <p className="mt-2 text-xs text-amber-700">Para crear, desactivá “Ver todos los ciclos”.</p>
              ) : null}
            </div>

            {coursesLoading ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                Cargando…
              </div>
            ) : courses.length === 0 ? (
              <p className="text-sm text-gray-500">No hay cursos en este ciclo lectivo.</p>
            ) : (
              <div className="max-h-[520px] space-y-4 overflow-y-auto pr-1">
                {courseGroups.map((group) => (
                  <div key={group.key}>
                    <div className="mb-1 flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2">
                      <h3 className="text-sm font-semibold text-gray-900">{group.title}</h3>
                      <span className="text-xs text-gray-500">{group.items.length} opción{group.items.length === 1 ? '' : 'es'}</span>
                    </div>
                    <ul className="space-y-1">
                      {group.items.map((c) => (
                        <li key={c.id}>
                          <div
                            className={`rounded-lg border px-3 py-2 text-sm transition ${
                              selectedCourseId === c.id ? 'border-emerald-500 bg-emerald-50' : 'border-transparent hover:bg-gray-50'
                            }`}
                          >
                            {editingCourseId === c.id ? (
                              <div className="space-y-2">
                                <input
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                                  value={courseEditDraft.name}
                                  onChange={(e) => setCourseEditDraft({ ...courseEditDraft, name: e.target.value })}
                                />
                                <input
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                                  value={courseEditDraft.code}
                                  onChange={(e) => setCourseEditDraft({ ...courseEditDraft, code: e.target.value })}
                                  placeholder="Código"
                                />
                                <textarea
                                  rows={2}
                                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs"
                                  value={courseEditDraft.description}
                                  onChange={(e) => setCourseEditDraft({ ...courseEditDraft, description: e.target.value })}
                                  placeholder="Descripción"
                                />
                                <label className="flex items-center gap-2 text-xs text-gray-700">
                                  <input
                                    type="checkbox"
                                    checked={courseEditDraft.isActive}
                                    onChange={(e) => setCourseEditDraft({ ...courseEditDraft, isActive: e.target.checked })}
                                  />
                                  Activo
                                </label>
                                <div className="flex gap-2">
                                  <button type="button" className="rounded bg-emerald-600 px-2 py-1 text-xs text-white" onClick={() => void saveCourseEdit(c.id)}>
                                    Guardar
                                  </button>
                                  <button type="button" className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700" onClick={() => setEditingCourseId(null)}>
                                    Cancelar
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-start gap-2">
                                <button type="button" onClick={() => setSelectedCourseId(c.id)} className="min-w-0 flex-1 text-left">
                                  <div className="font-medium text-gray-900">{c.displayLabel}</div>
                                  <div className="text-xs text-gray-500">
                                    {c.code ? `${c.code} · ` : ''}
                                    {(c.offeringIsActive ?? c.isActive) ? 'Activo en ciclo' : 'Inactivo'}
                                  </div>
                                </button>
                                <div className="flex shrink-0 gap-1">
                                  <button
                                    type="button"
                                    className={`rounded p-1.5 text-xs ${(c.offeringIsActive ?? c.isActive) ? 'text-amber-700 hover:bg-amber-50' : 'text-emerald-700 hover:bg-emerald-50'}`}
                                    title={(c.offeringIsActive ?? c.isActive) ? 'Desactivar' : 'Activar'}
                                    onClick={() => void toggleCourseActive(c)}
                                  >
                                    {(c.offeringIsActive ?? c.isActive) ? 'Off' : 'On'}
                                  </button>
                                  <button type="button" className="rounded p-1.5 text-gray-500 hover:bg-gray-100" title="Editar" onClick={() => startEditCourse(c)}>
                                    <Pencil className="h-4 w-4" aria-hidden />
                                  </button>
                                  <button type="button" className="rounded p-1.5 text-red-600 hover:bg-red-50" title="Eliminar" onClick={() => void removeCourse(c)}>
                                    <Trash2 className="h-4 w-4" aria-hidden />
                                  </button>
                                </div>
                              </div>
                            )}
                            </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            {!selectedCourseId ? (
              <p className="text-sm text-gray-500">Seleccioná un curso para ver o editar asignaturas.</p>
            ) : (
              <>
                <h2 className="mb-1 text-lg font-semibold">Asignaturas</h2>
                <p className="mb-4 text-sm text-gray-600">
                  Curso: <strong>{selectedCourse?.name}</strong>
                </p>

                <div className="mb-6 space-y-3 rounded-md border border-dashed border-gray-300 p-3">
                  <div className="text-sm font-medium text-gray-800">Nueva asignatura</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs sm:col-span-2">
                      <span className="text-gray-600">Nombre</span>
                      <input
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={createDraft.name}
                        onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })}
                        placeholder="Ej. Matemática"
                      />
                    </label>
                    <label className="block text-xs">
                      <span className="text-gray-600">Código (opcional)</span>
                      <input
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={createDraft.code}
                        onChange={(e) => setCreateDraft({ ...createDraft, code: e.target.value })}
                      />
                    </label>
                    <label className="block text-xs">
                      <span className="text-gray-600">Orden</span>
                      <input
                        type="number"
                        min={0}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={createDraft.sortOrder}
                        onChange={(e) => setCreateDraft({ ...createDraft, sortOrder: Number(e.target.value) })}
                      />
                    </label>
                    <label className="block text-xs sm:col-span-2">
                      <span className="text-gray-600">Descripción (opcional)</span>
                      <textarea
                        rows={2}
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-sm"
                        value={createDraft.description}
                        onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={createDraft.isActive}
                        onChange={(e) => setCreateDraft({ ...createDraft, isActive: e.target.checked })}
                      />
                      Activa
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => void createSubject()}
                    className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
                  >
                    Agregar
                  </button>
                </div>

                {subjectsLoading ? (
                  <div className="flex items-center gap-2 text-gray-500">
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
                    Cargando asignaturas…
                  </div>
                ) : subjects.length === 0 ? (
                  <p className="text-sm text-gray-500">Este curso aún no tiene asignaturas.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs uppercase text-gray-500">
                          <th className="py-2 pr-2">Orden</th>
                          <th className="py-2 pr-2">Nombre</th>
                          <th className="py-2 pr-2">Código</th>
                          <th className="py-2 pr-2">Estado</th>
                          <th className="py-2">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {subjects.map((s) => (
                          <tr key={s.id} className="border-b border-gray-100">
                            {editingId === s.id ? (
                              <>
                                <td className="py-2 pr-2 align-top">
                                  <input
                                    type="number"
                                    className="w-16 rounded border px-1 py-1"
                                    value={editDraft.sortOrder}
                                    onChange={(e) =>
                                      setEditDraft({ ...editDraft, sortOrder: Number(e.target.value) })
                                    }
                                  />
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  <input
                                    className="w-full min-w-[8rem] rounded border px-1 py-1"
                                    value={editDraft.name}
                                    onChange={(e) => setEditDraft({ ...editDraft, name: e.target.value })}
                                  />
                                  <textarea
                                    rows={2}
                                    placeholder="Descripción"
                                    className="mt-1 w-full rounded border px-1 py-1 text-xs"
                                    value={editDraft.description}
                                    onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                                  />
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  <input
                                    className="w-full min-w-[5rem] rounded border px-1 py-1"
                                    value={editDraft.code}
                                    onChange={(e) => setEditDraft({ ...editDraft, code: e.target.value })}
                                  />
                                </td>
                                <td className="py-2 pr-2 align-top">
                                  <label className="flex items-center gap-1 text-xs">
                                    <input
                                      type="checkbox"
                                      checked={editDraft.isActive}
                                      onChange={(e) =>
                                        setEditDraft({ ...editDraft, isActive: e.target.checked })
                                      }
                                    />
                                    Activa
                                  </label>
                                </td>
                                <td className="py-2 align-top whitespace-nowrap">
                                  <button
                                    type="button"
                                    className="text-indigo-600 hover:underline"
                                    onClick={() => void saveEdit()}
                                  >
                                    Guardar
                                  </button>
                                  <button
                                    type="button"
                                    className="ml-2 text-gray-600 hover:underline"
                                    onClick={() => setEditingId(null)}
                                  >
                                    Cancelar
                                  </button>
                                </td>
                              </>
                            ) : (
                              <>
                                <td className="py-2 pr-2">{s.sortOrder}</td>
                                <td className="py-2 pr-2 font-medium">{s.name}</td>
                                <td className="py-2 pr-2 text-gray-600">{s.code ?? '—'}</td>
                                <td className="py-2 pr-2">{s.isActive ? 'Activa' : 'Inactiva'}</td>
                                <td className="py-2 whitespace-nowrap">
                                  <button
                                    type="button"
                                    className="text-indigo-600 hover:underline"
                                    onClick={() => startEdit(s)}
                                  >
                                    Editar
                                  </button>
                                  <button
                                    type="button"
                                    className="ml-2 text-red-600 hover:underline"
                                    onClick={() => void removeSubject(s.id)}
                                  >
                                    Eliminar
                                  </button>
                                </td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </RoleGuard>
  )
}
