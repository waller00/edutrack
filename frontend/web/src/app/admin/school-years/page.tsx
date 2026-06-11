'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { useAdminSchoolYear, type SchoolYearApiRow } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  BookOpen,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  Copy,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Trash2,
  Users,
} from 'lucide-react'

const STATUS_LABEL: Record<string, string> = {
  PLANNED: 'Planificado',
  ACTIVE: 'Activo',
  CLOSED: 'Cerrado',
}

const ENROLL_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  WITHDRAWN: 'Abandonó',
  GRADUATED: 'Egresó',
  TRANSFERRED: 'Transferido',
}

type ComparePayload = {
  a: {
    id: string
    code: number
    label: string
    studentsTotal: number
    coursesCount: number
    studentsByStatus: Record<string, number>
  }
  b: {
    id: string
    code: number
    label: string
    studentsTotal: number
    coursesCount: number
    studentsByStatus: Record<string, number>
  }
}

type StartPlanCourse = {
  id: string
  name: string
  code: string | null
  level: string | null
  sortOrder: number
  targetOffered: boolean
  sourceOffered: boolean
  recommended: boolean
  orientations: StartPlanOrientation[]
}

type StartPlanOrientation = {
  orientationId: string
  name: string
  code: string | null
  sortOrder: number
  targetOffered: boolean
  sourceOffered: boolean
  recommended: boolean
}

type StartPlanStudent = {
  studentId: string
  firstName: string
  lastName: string
  documentId: string | null
  sourceCourseId: string | null
  sourceCourseName: string
  sourceCourseCode: string | null
  sourceOrientationId: string | null
  sourceOrientationName: string | null
  sourceOrientationCode: string | null
  enrollmentStatus: string
}

type StartPlanPayload = {
  target: SchoolYearApiRow
  source: SchoolYearApiRow | null
  sourceYears: SchoolYearApiRow[]
  courses: StartPlanCourse[]
  students: StartPlanStudent[]
}

type StartAction = 'PROMOTE' | 'REPEAT' | 'GRADUATED' | 'WITHDRAWN' | 'TRANSFERRED'
type StartDecision = { action: StartAction; targetCourseId?: string; targetOrientationId?: string; notes?: string }

const START_ACTION_LABEL: Record<StartAction, string> = {
  PROMOTE: 'Pasa',
  REPEAT: 'Repite',
  GRADUATED: 'Egresa',
  WITHDRAWN: 'No siguió',
  TRANSFERRED: 'Transferido',
}

const ACTIONS_WITH_TARGET = new Set<StartAction>(['PROMOTE', 'REPEAT'])
const START_STEPS = [
  { key: 'courses', label: 'Cursos', Icon: BookOpen },
  { key: 'students', label: 'Estudiantes', Icon: Users },
  { key: 'review', label: 'Resumen', Icon: CheckCircle2 },
] as const

function toInputDate(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function courseLabel(course: Pick<StartPlanCourse, 'name' | 'code'>): string {
  return course.code ? `${course.code} · ${course.name}` : course.name
}

function orientationKey(courseId: string, orientationId: string): string {
  return `${courseId}:${orientationId}`
}

function targetValue(courseId?: string, orientationId?: string): string {
  if (!courseId) return ''
  return orientationId ? `${courseId}:${orientationId}` : courseId
}

function parseTargetValue(value: string): Partial<StartDecision> {
  if (!value) return {}
  const [targetCourseId, targetOrientationId] = value.split(':')
  return { targetCourseId, targetOrientationId }
}

function sourceGroupKey(student: Pick<StartPlanStudent, 'sourceCourseId' | 'sourceOrientationId'>): string {
  return `${student.sourceCourseId ?? 'none'}:${student.sourceOrientationId ?? ''}`
}

function buildTargetOptionsForPlan(
  plan: StartPlanPayload,
  courseIds: Set<string>,
  orientationKeys: Set<string>,
): Array<{ value: string; label: string; courseId: string; orientationId?: string }> {
  const options: Array<{ value: string; label: string; courseId: string; orientationId?: string }> = []
  for (const course of plan.courses.filter((row) => courseIds.has(row.id))) {
    const selectedOrientations = course.orientations.filter((orientation) =>
      orientationKeys.has(orientationKey(course.id, orientation.orientationId)),
    )
    if (selectedOrientations.length === 0) {
      options.push({ value: targetValue(course.id), label: courseLabel(course), courseId: course.id })
    } else {
      for (const orientation of selectedOrientations) {
        options.push({
          value: targetValue(course.id, orientation.orientationId),
          label: `${courseLabel(course)} - ${orientation.name}`,
          courseId: course.id,
          orientationId: orientation.orientationId,
        })
      }
    }
  }
  return options
}

export default function AdminSchoolYearsPage() {
  const { years, activeId, loading, reload } = useAdminSchoolYear()
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createCode, setCreateCode] = useState(String(new Date().getFullYear() + 1))
  const [createLabel, setCreateLabel] = useState('')
  const [createStart, setCreateStart] = useState('')
  const [creating, setCreating] = useState(false)

  const [editing, setEditing] = useState<SchoolYearApiRow | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editStart, setEditStart] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [copyTarget, setCopyTarget] = useState<SchoolYearApiRow | null>(null)
  const [copySourceId, setCopySourceId] = useState('')
  const [copying, setCopying] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SchoolYearApiRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  const [startTarget, setStartTarget] = useState<SchoolYearApiRow | null>(null)
  const [startPlan, setStartPlan] = useState<StartPlanPayload | null>(null)
  const [startLoading, setStartLoading] = useState(false)
  const [startStep, setStartStep] = useState<'courses' | 'students' | 'review'>('courses')
  const [startSourceId, setStartSourceId] = useState('')
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(() => new Set())
  const [selectedOrientationKeys, setSelectedOrientationKeys] = useState<Set<string>>(() => new Set())
  const [studentDecisions, setStudentDecisions] = useState<Record<string, StartDecision>>({})
  const [studentCourseFilter, setStudentCourseFilter] = useState('')
  const [starting, setStarting] = useState(false)

  const [cmpA, setCmpA] = useState('')
  const [cmpB, setCmpB] = useState('')
  const [cmpData, setCmpData] = useState<ComparePayload | null>(null)
  const [cmpLoading, setCmpLoading] = useState(false)
  const [cmpErr, setCmpErr] = useState('')

  const sortedYears = useMemo(() => [...years].sort((a, b) => b.code - a.code), [years])
  const canCreateSchoolYear = !activeId
  const selectedStartCourses = useMemo(
    () => startPlan?.courses.filter((course) => selectedCourseIds.has(course.id)) ?? [],
    [selectedCourseIds, startPlan],
  )
  const selectedTargetOptions = useMemo(() => {
    if (!startPlan) return []
    return buildTargetOptionsForPlan(startPlan, selectedCourseIds, selectedOrientationKeys)
  }, [selectedCourseIds, selectedOrientationKeys, startPlan])
  const startStudentGroups = useMemo(() => {
    const groups = new Map<string, { id: string; label: string; students: StartPlanStudent[] }>()
    for (const student of startPlan?.students ?? []) {
      const id = sourceGroupKey(student)
      const courseLabelText = student.sourceCourseCode ? `${student.sourceCourseCode} · ${student.sourceCourseName}` : student.sourceCourseName
      const label = student.sourceOrientationName ? `${courseLabelText} - ${student.sourceOrientationName}` : courseLabelText
      const current = groups.get(id) ?? { id, label, students: [] }
      current.students.push(student)
      groups.set(id, current)
    }
    return [...groups.values()]
  }, [startPlan])
  const visibleStartStudents = useMemo(() => {
    if (!studentCourseFilter) return startPlan?.students ?? []
    return startPlan?.students.filter((student) => sourceGroupKey(student) === studentCourseFilter) ?? []
  }, [startPlan, studentCourseFilter])
  const startDecisionSummary = useMemo(() => {
    const summary: Record<StartAction, number> = {
      PROMOTE: 0,
      REPEAT: 0,
      GRADUATED: 0,
      WITHDRAWN: 0,
      TRANSFERRED: 0,
    }
    for (const decision of Object.values(studentDecisions)) summary[decision.action] += 1
    return summary
  }, [studentDecisions])

  useEffect(() => {
    if (!loading && canCreateSchoolYear) setCreateOpen(true)
  }, [canCreateSchoolYear, loading])

  const clearFlash = useCallback(() => {
    setMsg('')
    setErr('')
  }, [])

  function buildDefaultDecisions(
    plan: StartPlanPayload,
    courseIds: Set<string>,
    orientationKeys: Set<string>,
  ): Record<string, StartDecision> {
    const options = buildTargetOptionsForPlan(plan, courseIds, orientationKeys)
    const fallback = options[0]
    const decisions: Record<string, StartDecision> = {}
    for (const student of plan.students) {
      const sourceExact = options.find(
        (option) => option.courseId === student.sourceCourseId && option.orientationId === (student.sourceOrientationId ?? undefined),
      )
      const sourceCourse = options.find((option) => option.courseId === student.sourceCourseId)
      const target = sourceExact ?? sourceCourse ?? fallback
      decisions[student.studentId] = {
        action: 'PROMOTE',
        ...(target?.courseId ? { targetCourseId: target.courseId } : {}),
        ...(target?.orientationId ? { targetOrientationId: target.orientationId } : {}),
      }
    }
    return decisions
  }

  function applyStartPlan(plan: StartPlanPayload) {
    const recommended = plan.courses.filter((course) => course.recommended).map((course) => course.id)
    const initialIds = new Set(recommended.length ? recommended : plan.courses.map((course) => course.id))
    const initialOrientationKeys = new Set(
      plan.courses.flatMap((course) =>
        course.orientations
          .filter((orientation) => initialIds.has(course.id) && orientation.recommended)
          .map((orientation) => orientationKey(course.id, orientation.orientationId)),
      ),
    )
    setStartPlan(plan)
    setStartSourceId(plan.source?.id ?? '')
    setSelectedCourseIds(initialIds)
    setSelectedOrientationKeys(initialOrientationKeys)
    setStudentDecisions(buildDefaultDecisions(plan, initialIds, initialOrientationKeys))
    setStudentCourseFilter('')
    setStartStep('courses')
  }

  async function loadStartPlan(target: SchoolYearApiRow, sourceSchoolYearId?: string) {
    setStartLoading(true)
    try {
      const suffix = sourceSchoolYearId ? `?sourceSchoolYearId=${encodeURIComponent(sourceSchoolYearId)}` : ''
      const plan = await api<StartPlanPayload>(`/admin/school-years/${target.id}/start-plan${suffix}`)
      applyStartPlan(plan)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo preparar el inicio del ciclo')
      setStartTarget(null)
    } finally {
      setStartLoading(false)
    }
  }

  async function openStartWizard(target: SchoolYearApiRow) {
    clearFlash()
    setStartTarget(target)
    setStartPlan(null)
    await loadStartPlan(target)
  }

  function closeStartWizard() {
    setStartTarget(null)
    setStartPlan(null)
    setStartStep('courses')
    setStartSourceId('')
    setSelectedCourseIds(new Set())
    setSelectedOrientationKeys(new Set())
    setStudentDecisions({})
    setStudentCourseFilter('')
  }

  function normalizeDecisions(
    plan: StartPlanPayload,
    courseIds: Set<string>,
    orientationKeys: Set<string>,
    decisions: Record<string, StartDecision>,
  ): Record<string, StartDecision> {
    const options = buildTargetOptionsForPlan(plan, courseIds, orientationKeys)
    const fallback = options[0]
    const validValues = new Set(options.map((option) => option.value))
    const updated: Record<string, StartDecision> = {}
    for (const [studentId, decision] of Object.entries(decisions)) {
      if (!ACTIONS_WITH_TARGET.has(decision.action)) {
        updated[studentId] = { ...decision, targetCourseId: undefined, targetOrientationId: undefined }
        continue
      }
      const currentValue = targetValue(decision.targetCourseId, decision.targetOrientationId)
      const target = validValues.has(currentValue)
        ? { courseId: decision.targetCourseId, orientationId: decision.targetOrientationId }
        : fallback
      updated[studentId] = {
        ...decision,
        ...(target?.courseId ? { targetCourseId: target.courseId } : { targetCourseId: undefined }),
        ...(target?.orientationId ? { targetOrientationId: target.orientationId } : { targetOrientationId: undefined }),
      }
    }
    return updated
  }

  function setCourseSelected(courseId: string, selected: boolean) {
    if (!startPlan) return
    setSelectedCourseIds((current) => {
      const next = new Set(current)
      if (selected) next.add(courseId)
      else next.delete(courseId)
      setSelectedOrientationKeys((currentOrientations) => {
        const nextOrientations = new Set(currentOrientations)
        const course = startPlan.courses.find((row) => row.id === courseId)
        if (!selected) {
          for (const key of [...nextOrientations]) {
            if (key.startsWith(`${courseId}:`)) nextOrientations.delete(key)
          }
        } else {
          for (const orientation of course?.orientations ?? []) {
            if (orientation.recommended) nextOrientations.add(orientationKey(courseId, orientation.orientationId))
          }
        }
        setStudentDecisions((decisions) => normalizeDecisions(startPlan, next, nextOrientations, decisions))
        return nextOrientations
      })
      return next
    })
  }

  function setOrientationSelected(courseId: string, orientationId: string, selected: boolean) {
    if (!startPlan) return
    setSelectedCourseIds((currentCourses) => {
      const nextCourses = new Set(currentCourses)
      nextCourses.add(courseId)
      setSelectedOrientationKeys((currentOrientations) => {
        const nextOrientations = new Set(currentOrientations)
        const key = orientationKey(courseId, orientationId)
        if (selected) nextOrientations.add(key)
        else nextOrientations.delete(key)
        setStudentDecisions((decisions) => normalizeDecisions(startPlan, nextCourses, nextOrientations, decisions))
        return nextOrientations
      })
      return nextCourses
    })
  }

  function patchStudentDecision(studentId: string, patch: Partial<StartDecision>) {
    setStudentDecisions((decisions) => {
      const current = decisions[studentId] ?? { action: 'PROMOTE' as StartAction }
      const next = { ...current, ...patch }
      if (ACTIONS_WITH_TARGET.has(next.action) && !next.targetCourseId) {
        const fallback = selectedTargetOptions[0]
        next.targetCourseId = fallback?.courseId
        next.targetOrientationId = fallback?.orientationId
      }
      if (!ACTIONS_WITH_TARGET.has(next.action)) {
        delete next.targetCourseId
        delete next.targetOrientationId
      }
      return { ...decisions, [studentId]: next }
    })
  }

  async function submitStartWizard() {
    if (!startTarget || !startPlan) return
    clearFlash()
    if (selectedStartCourses.length === 0) {
      setErr('Elegí al menos un curso activo para iniciar el ciclo.')
      return
    }
    const invalidStudent = startPlan.students.find((student) => {
      const decision = studentDecisions[student.studentId]
      const value = targetValue(decision?.targetCourseId, decision?.targetOrientationId)
      return !decision || (ACTIONS_WITH_TARGET.has(decision.action) && !selectedTargetOptions.some((option) => option.value === value))
    })
    if (invalidStudent) {
      setErr('Revisá los estudiantes que pasan o repiten: todos necesitan un curso u orientación activa de destino.')
      setStartStep('students')
      return
    }
    setStarting(true)
    try {
      const payload = {
        sourceSchoolYearId: startSourceId || undefined,
        courseIds: selectedStartCourses.map((course) => course.id),
        orientationSelections: selectedStartCourses.flatMap((course) =>
          course.orientations
            .filter((orientation) => selectedOrientationKeys.has(orientationKey(course.id, orientation.orientationId)))
            .map((orientation) => ({ courseId: course.id, orientationId: orientation.orientationId })),
        ),
        studentDecisions: startPlan.students.map((student) => ({
          studentId: student.studentId,
          ...studentDecisions[student.studentId],
        })),
      }
      const result = await api<{ courses: number; orientations: number; movedStudents: number; closedStudents: number }>(
        `/admin/school-years/${startTarget.id}/start`,
        { method: 'POST', body: JSON.stringify(payload) },
      )
      setMsg(`Ciclo iniciado: ${result.courses} cursos, ${result.orientations} orientaciones, ${result.movedStudents} estudiantes inscriptos y ${result.closedStudents} cierres registrados.`)
      closeStartWizard()
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo iniciar el ciclo')
    } finally {
      setStarting(false)
    }
  }

  async function doDeleteSchoolYear() {
    if (!deleteTarget) return
    clearFlash()
    setDeleting(true)
    try {
      await api(`/admin/school-years/${deleteTarget.id}`, { method: 'DELETE' })
      setMsg(`Ciclo ${deleteTarget.code} borrado.`)
      setDeleteTarget(null)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo borrar el ciclo')
    } finally {
      setDeleting(false)
    }
  }

  async function doClose(id: string) {
    clearFlash()
    setBusyId(id)
    try {
      await api(`/admin/school-years/${id}/close`, { method: 'POST' })
      setMsg('Ciclo cerrado.')
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo cerrar')
    } finally {
      setBusyId(null)
    }
  }

  function openEdit(y: SchoolYearApiRow) {
    clearFlash()
    setEditing(y)
    setEditLabel(y.label)
    setEditStart(toInputDate(y.startsOn))
  }

  async function saveEdit() {
    if (!editing) return
    clearFlash()
    setSavingEdit(true)
    try {
      const body: Record<string, string | null> = { label: editLabel.trim() }
      body.startsOn = editStart ? new Date(`${editStart}T00:00:00.000Z`).toISOString() : null
      await api(`/admin/school-years/${editing.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      })
      setMsg('Ciclo actualizado.')
      setEditing(null)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setSavingEdit(false)
    }
  }

  async function submitCreate() {
    clearFlash()
    if (!canCreateSchoolYear) {
      setErr('Ya hay un ciclo lectivo activo. Cerralo manualmente antes de crear otro.')
      return
    }
    const code = Number.parseInt(createCode, 10)
    if (!createLabel.trim() || Number.isNaN(code)) {
      setErr('Completá el código (año) y la etiqueta.')
      return
    }
    setCreating(true)
    try {
      const body: Record<string, unknown> = {
        code,
        label: createLabel.trim(),
        status: 'PLANNED',
      }
      if (createStart) body.startsOn = new Date(`${createStart}T00:00:00.000Z`).toISOString()
      await api('/admin/school-years', { method: 'POST', body: JSON.stringify(body) })
      setMsg('Ciclo creado en estado planificado.')
      setCreateLabel('')
      setCreateStart('')
      setCreateOpen(false)
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo crear')
    } finally {
      setCreating(false)
    }
  }

  async function submitCopy() {
    if (!copyTarget || !copySourceId || copySourceId === copyTarget.id) {
      setErr('Elegí un ciclo origen distinto al destino.')
      return
    }
    if ((copyTarget.coursesCount ?? 0) > 0) {
      setErr('El ciclo destino ya tiene ofertas de cursos.')
      return
    }
    clearFlash()
    setCopying(true)
    try {
      await api(`/admin/school-years/${copyTarget.id}/copy-courses-from/${copySourceId}`, { method: 'POST' })
      setMsg('Oferta de cursos replicada al ciclo destino.')
      setCopyTarget(null)
      setCopySourceId('')
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo replicar')
    } finally {
      setCopying(false)
    }
  }

  async function loadCompare() {
    setCmpErr('')
    setCmpData(null)
    if (!cmpA || !cmpB || cmpA === cmpB) {
      setCmpErr('Elegí dos ciclos distintos.')
      return
    }
    setCmpLoading(true)
    try {
      const r = await api<ComparePayload>(
        `/admin/school-years/compare-metrics?a=${encodeURIComponent(cmpA)}&b=${encodeURIComponent(cmpB)}`,
      )
      setCmpData(r)
    } catch (e) {
      setCmpErr(e instanceof Error ? e.message : 'No se pudo comparar')
    } finally {
      setCmpLoading(false)
    }
  }

  const copySourceOptions = copyTarget ? sortedYears.filter((y) => y.id !== copyTarget.id) : []

  return (
    <RoleGuard permission="school-years.manage">
      <main className="responsive-page max-w-[1600px] space-y-4">
        <header className="space-y-2 border-b border-gray-200 pb-4">
          <div className="flex flex-wrap items-center gap-2 text-emerald-800">
            <CalendarRange className="h-6 w-6" aria-hidden />
            <h1 className="text-2xl font-bold text-gray-950">Ciclos lectivos</h1>
          </div>
          <p className="max-w-3xl text-sm text-gray-600">
            Alta y edición de ciclos, inicio manual del año lectivo, cierre manual y replicación de oferta cuando el ciclo destino tiene{' '}
            <strong>0 ofertas</strong> (la columna «Cursos» muestra cuántos cursos están ofertados en ese ciclo). Abajo podés
            comparar métricas entre dos ciclos. El selector global del encabezado admin sigue filtrando listados en el resto
            del sistema.
          </p>
        </header>

        {(msg || err) && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              err ? 'border-red-200 bg-red-50 text-red-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}
          >
            {err || msg}
            <button type="button" className="ml-3 underline" onClick={clearFlash}>
              Cerrar
            </button>
          </div>
        )}

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-4 py-3 sm:px-5">
            <h2 className="text-lg font-semibold text-gray-900">Listado de ciclos</h2>
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2 text-sm"
              onClick={() => void reload()}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Recargar
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] table-fixed text-left text-sm">
              <colgroup>
                <col className="w-[9%]" />
                <col className="w-[27%]" />
                <col className="w-[12%]" />
                <col className="w-[18%]" />
                <col className="w-[9%]" />
                <col className="w-[25%]" />
              </colgroup>
              <thead className="border-b border-gray-100 bg-gray-50/80 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5 sm:px-5">Año</th>
                  <th className="px-4 py-2.5 sm:px-5">Etiqueta</th>
                  <th className="px-4 py-2.5 sm:px-5">Inicio</th>
                  <th className="px-4 py-2.5 sm:px-5">Estado</th>
                  <th className="px-4 py-2.5 text-right tabular-nums sm:px-5">Cursos</th>
                  <th className="px-4 py-2.5 text-right sm:px-5">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedYears.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-5 text-center text-sm text-gray-500 sm:px-5">
                      No hay ciclos cargados.
                    </td>
                  </tr>
                ) : (
                sortedYears.map((y) => (
                  <tr key={y.id} className="hover:bg-gray-50/80">
                    <td className="whitespace-nowrap px-4 py-2.5 font-medium text-gray-900 sm:px-5">{y.code}</td>
                    <td className="truncate px-4 py-2.5 text-gray-800 sm:px-5">{y.label}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600 sm:px-5">{toInputDate(y.startsOn) || '—'}</td>
                    <td className="px-4 py-2.5 sm:px-5">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          y.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-900'
                            : y.status === 'CLOSED'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-amber-50 text-amber-900 ring-1 ring-amber-200/60'
                        }`}
                      >
                        {STATUS_LABEL[y.status] ?? y.status}
                        {y.id === activeId ? ' · institucional' : ''}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right text-slate-800 tabular-nums sm:px-5">
                      {y.coursesCount ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right sm:px-5">
                      <div className="flex flex-nowrap items-center justify-end gap-1">
                        <button
                          type="button"
                          className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                          onClick={() => openEdit(y)}
                        >
                          <span className="inline-flex items-center gap-1">
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                            Editar
                          </span>
                        </button>
                        {y.status !== 'ACTIVE' && y.status !== 'CLOSED' && (
                          <button
                            type="button"
                            className="shrink-0 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            disabled={busyId === y.id || Boolean(startTarget)}
                            onClick={() => void openStartWizard(y)}
                          >
                            <span className="inline-flex items-center gap-1">
                              {busyId === y.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" aria-hidden />}
                              Iniciar
                            </span>
                          </button>
                        )}
                        {y.status !== 'CLOSED' && (
                          <button
                            type="button"
                            className="shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                            disabled={busyId === y.id}
                            onClick={() => void doClose(y.id)}
                          >
                            Cerrar
                          </button>
                        )}
                        {y.status !== 'CLOSED' && (
                          <button
                            type="button"
                            disabled={(y.coursesCount ?? 0) > 0}
                            title={
                              (y.coursesCount ?? 0) > 0
                                ? `Este ciclo ya tiene ${y.coursesCount} oferta(s). La replicación solo está permitida con oferta vacía.`
                                : 'Replicar oferta de cursos desde otro ciclo'
                            }
                            className="shrink-0 rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                            onClick={() => {
                              setCopyTarget(y)
                              setCopySourceId(sortedYears.find((o) => o.id !== y.id)?.id ?? '')
                            }}
                          >
                            <span className="inline-flex items-center gap-1">
                              <Copy className="h-3.5 w-3.5" aria-hidden />
                              Replicar oferta
                            </span>
                          </button>
                        )}
                        <button
                          type="button"
                          className="shrink-0 rounded-lg border border-red-200 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                          disabled={deleting}
                          onClick={() => {
                            clearFlash()
                            setDeleteTarget(y)
                          }}
                        >
                          <span className="inline-flex items-center gap-1">
                            <Trash2 className="h-3.5 w-3.5" aria-hidden />
                            Borrar
                          </span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left disabled:cursor-not-allowed disabled:opacity-60 sm:px-5"
            onClick={() => {
              if (canCreateSchoolYear) setCreateOpen((v) => !v)
            }}
            disabled={!canCreateSchoolYear}
            aria-expanded={createOpen}
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Nuevo ciclo lectivo</h2>
              <p className="text-sm text-gray-500">
                {canCreateSchoolYear
                  ? 'Se crea en estado planificado; luego podés iniciarlo manualmente o replicar ofertas.'
                  : 'No disponible porque ya hay un ciclo lectivo activo.'}
              </p>
            </div>
            <ChevronDown className={`h-5 w-5 shrink-0 text-gray-500 transition ${createOpen ? 'rotate-180' : ''}`} aria-hidden />
          </button>
          {createOpen && (
            <div className="space-y-4 border-t border-gray-100 px-4 pb-5 pt-2 sm:px-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Código (año)</label>
                  <input
                    className="input-field text-sm"
                    type="number"
                    value={createCode}
                    onChange={(e) => setCreateCode(e.target.value)}
                    min={1980}
                    max={2100}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Etiqueta</label>
                  <input
                    className="input-field text-sm"
                    value={createLabel}
                    onChange={(e) => setCreateLabel(e.target.value)}
                    placeholder="Ej. Ciclo lectivo 2027"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Inicio (opc.)</label>
                  <input className="input-field text-sm" type="date" value={createStart} onChange={(e) => setCreateStart(e.target.value)} />
                </div>
              </div>
              <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={creating} onClick={() => void submitCreate()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                Crear ciclo
              </button>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-5">
          <h2 className="text-lg font-semibold text-gray-900">Comparar dos ciclos</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Totales de estudiantes por estado de matrícula y cantidad de cursos ofertados. Útil para ver diferencias
            entre años antes de planificar el siguiente.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Ciclo A</label>
              <select className="select-field min-w-0 text-sm lg:min-w-[220px]" value={cmpA} onChange={(e) => setCmpA(e.target.value)}>
                <option value="">—</option>
                {sortedYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.code} — {y.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Ciclo B</label>
              <select className="select-field min-w-0 text-sm lg:min-w-[220px]" value={cmpB} onChange={(e) => setCmpB(e.target.value)}>
                <option value="">—</option>
                {sortedYears.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.code} — {y.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={cmpLoading} onClick={() => void loadCompare()}>
              {cmpLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Comparar
            </button>
          </div>
          {cmpErr && <p className="mt-3 text-sm text-red-600">{cmpErr}</p>}
          {cmpData && (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[cmpData.a, cmpData.b].map((side) => (
                <div key={side.id} className="rounded-xl border border-gray-100 bg-gray-50/50 p-4">
                  <h3 className="font-semibold text-gray-900">
                    {side.code} — {side.label}
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Estudiantes: <strong>{side.studentsTotal}</strong> · Cursos: <strong>{side.coursesCount}</strong>
                  </p>
                  <ul className="mt-3 space-y-1.5 text-sm">
                    {Object.entries(side.studentsByStatus).map(([k, v]) => (
                      <li key={k} className="flex justify-between gap-2 border-b border-gray-100/80 py-1 last:border-0">
                        <span>{ENROLL_LABEL[k] ?? k}</span>
                        <span className="font-medium tabular-nums">{v}</span>
                      </li>
                    ))}
                    {Object.keys(side.studentsByStatus).length === 0 && (
                      <li className="text-gray-500">Sin estudiantes con estado agrupado.</li>
                    )}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {editing && (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center"
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) setEditing(null) }}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(null) }}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5"
              role="dialog"
              aria-modal="true"
            >
              <h3 className="text-lg font-semibold text-gray-900">Editar ciclo {editing.code}</h3>
              <p className="text-xs text-gray-500">El código (año) no se modifica desde acá.</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Etiqueta</label>
                  <input className="input-field text-sm" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Inicio</label>
                  <input className="input-field text-sm" type="date" value={editStart} onChange={(e) => setEditStart(e.target.value)} />
                </div>
              </div>
              <div className="mt-6 flex flex-col justify-end gap-2 sm:flex-row sm:flex-wrap">
                <button type="button" className="btn-secondary text-sm" onClick={() => setEditing(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary text-sm" disabled={savingEdit} onClick={() => void saveEdit()}>
                  {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center"
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null) }}
            onKeyDown={(e) => { if (e.key === 'Escape') setDeleteTarget(null) }}
          >
            <div
              className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5"
              role="dialog"
              aria-modal="true"
            >
              <h3 className="text-lg font-semibold text-gray-900">Borrar ciclo {deleteTarget.code}</h3>
              <p className="mt-1 text-sm text-gray-600">
                Se eliminará el ciclo «{deleteTarget.label}». Si tiene estudiantes, eventos u otros datos vinculados, el sistema lo va a rechazar.
              </p>
              <div className="mt-6 flex flex-col justify-end gap-2 sm:flex-row">
                <button type="button" className="btn-secondary text-sm" onClick={() => setDeleteTarget(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                  disabled={deleting}
                  onClick={() => void doDeleteSchoolYear()}
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" aria-hidden />}
                  Borrar
                </button>
              </div>
            </div>
          </div>
        )}

        {startTarget && (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-3 sm:items-center sm:p-4"
            role="presentation"
            onClick={(e) => {
              if (e.target === e.currentTarget && !starting) closeStartWizard()
            }}
            onKeyDown={(e) => { if (e.key === 'Escape' && !starting) closeStartWizard() }}
          >
            <div
              className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
              role="dialog"
              aria-modal="true"
            >
              <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">Iniciar ciclo {startTarget.code}</h3>
                    <p className="text-sm text-gray-500">
                      {startPlan?.source ? `Origen: ${startPlan.source.code} — ${startPlan.source.label}` : 'Sin ciclo origen'}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs font-semibold">
                    {START_STEPS.map(({ key, label, Icon }) => (
                      <button
                        key={key}
                        type="button"
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 ${
                          startStep === key
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                            : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                        onClick={() => setStartStep(key)}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden />
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {startPlan && startPlan.sourceYears.length > 0 && (
                  <div className="mt-3 max-w-sm">
                    <label className="mb-1 block text-xs font-medium text-gray-600">Ciclo origen</label>
                    <select
                      className="select-field w-full text-sm"
                      value={startSourceId}
                      disabled={startLoading || starting}
                      onChange={(e) => {
                        const nextSourceId = e.target.value
                        setStartSourceId(nextSourceId)
                        void loadStartPlan(startTarget, nextSourceId || undefined)
                      }}
                    >
                      {startPlan.sourceYears.map((year) => (
                        <option key={year.id} value={year.id}>
                          {year.code} — {year.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
                {startLoading && (
                  <div className="flex min-h-[260px] items-center justify-center text-sm text-gray-600">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    Cargando preparación…
                  </div>
                )}

                {!startLoading && startPlan && startStep === 'courses' && (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <BookOpen className="h-4 w-4 text-emerald-700" aria-hidden />
                        {selectedStartCourses.length} de {startPlan.courses.length} cursos activos
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="btn-secondary text-sm"
                          onClick={() => {
                            const ids = new Set(startPlan.courses.filter((course) => course.sourceOffered).map((course) => course.id))
                            const orientationKeys = new Set(
                              startPlan.courses.flatMap((course) =>
                                course.orientations
                                  .filter((orientation) => ids.has(course.id) && orientation.sourceOffered)
                                  .map((orientation) => orientationKey(course.id, orientation.orientationId)),
                              ),
                            )
                            setSelectedCourseIds(ids)
                            setSelectedOrientationKeys(orientationKeys)
                            setStudentDecisions(buildDefaultDecisions(startPlan, ids, orientationKeys))
                          }}
                        >
                          Usar origen
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-sm"
                          onClick={() => {
                            const ids = new Set(startPlan.courses.map((course) => course.id))
                            const orientationKeys = new Set(
                              startPlan.courses.flatMap((course) =>
                                course.orientations.map((orientation) => orientationKey(course.id, orientation.orientationId)),
                              ),
                            )
                            setSelectedCourseIds(ids)
                            setSelectedOrientationKeys(orientationKeys)
                            setStudentDecisions(buildDefaultDecisions(startPlan, ids, orientationKeys))
                          }}
                        >
                          Activar todos
                        </button>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {startPlan.courses.map((course) => {
                        const checked = selectedCourseIds.has(course.id)
                        return (
                          <label
                            key={course.id}
                            className={`flex min-h-[72px] cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                              checked ? 'border-emerald-200 bg-emerald-50/70' : 'border-gray-200 bg-white hover:bg-gray-50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="mt-1 h-4 w-4 accent-emerald-700"
                              checked={checked}
                              onChange={(e) => setCourseSelected(course.id, e.target.checked)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-gray-900">{courseLabel(course)}</span>
                              <span className="mt-1 flex flex-wrap gap-1 text-xs text-gray-500">
                                {course.level && <span>{course.level}</span>}
                                {course.sourceOffered && <span>Origen activo</span>}
                                {course.targetOffered && <span>Ya activo destino</span>}
                              </span>
                              {course.orientations.length > 0 && (
                                <span className="mt-3 grid gap-1">
                                  {course.orientations.map((orientation) => {
                                    const orientationChecked = selectedOrientationKeys.has(orientationKey(course.id, orientation.orientationId))
                                    return (
                                      <span key={orientation.orientationId} className="flex items-center gap-2 rounded-md bg-white/70 px-2 py-1">
                                        <input
                                          type="checkbox"
                                          className="h-3.5 w-3.5 accent-emerald-700"
                                          checked={orientationChecked}
                                          onClick={(e) => e.stopPropagation()}
                                          onChange={(e) => setOrientationSelected(course.id, orientation.orientationId, e.target.checked)}
                                        />
                                        <span className="min-w-0 truncate text-xs font-medium text-gray-700">
                                          {orientation.code ? `${orientation.code} · ${orientation.name}` : orientation.name}
                                        </span>
                                        {orientation.sourceOffered && <span className="ml-auto shrink-0 text-[11px] text-gray-500">Origen</span>}
                                      </span>
                                    )
                                  })}
                                </span>
                              )}
                            </span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )}

                {!startLoading && startPlan && startStep === 'students' && (
                  <div className="space-y-4">
                    {startStudentGroups.length > 0 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        <button
                          type="button"
                          className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium ${
                            !studentCourseFilter ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gray-200 text-gray-700'
                          }`}
                          onClick={() => setStudentCourseFilter('')}
                        >
                          Todos ({startPlan.students.length})
                        </button>
                        {startStudentGroups.map((group) => (
                          <button
                            key={group.id}
                            type="button"
                            className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium ${
                              studentCourseFilter === group.id ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-gray-200 text-gray-700'
                            }`}
                            onClick={() => setStudentCourseFilter(group.id)}
                          >
                            {group.label} ({group.students.length})
                          </button>
                        ))}
                      </div>
                    )}
                    {startPlan.students.length === 0 ? (
                      <div className="rounded-lg border border-gray-200 p-5 text-sm text-gray-600">
                        No hay estudiantes activos en el ciclo origen.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {visibleStartStudents.map((student) => {
                          const decision = studentDecisions[student.studentId] ?? { action: 'PROMOTE' as StartAction }
                          return (
                            <div key={student.studentId} className="rounded-lg border border-gray-200 p-3">
                              <div className="grid gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(340px,1.4fr)_minmax(200px,0.9fr)] lg:items-center">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-gray-900">
                                    {student.lastName}, {student.firstName}
                                  </p>
                                  <p className="truncate text-xs text-gray-500">
                                    {student.documentId ?? 'Sin documento'} · {student.sourceCourseName}
                                    {student.sourceOrientationName ? ` - ${student.sourceOrientationName}` : ''}
                                  </p>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {(Object.keys(START_ACTION_LABEL) as StartAction[]).map((action) => (
                                    <button
                                      key={action}
                                      type="button"
                                      className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold ${
                                        decision.action === action
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                                      }`}
                                      onClick={() => patchStudentDecision(student.studentId, { action })}
                                    >
                                      {START_ACTION_LABEL[action]}
                                    </button>
                                  ))}
                                </div>
                                {ACTIONS_WITH_TARGET.has(decision.action) ? (
                                  <select
                                    className="select-field w-full text-sm"
                                    value={targetValue(decision.targetCourseId, decision.targetOrientationId)}
                                    onChange={(e) => patchStudentDecision(student.studentId, parseTargetValue(e.target.value))}
                                  >
                                    <option value="">Curso destino</option>
                                    {selectedTargetOptions.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    className="input-field w-full text-sm"
                                    value={decision.notes ?? ''}
                                    onChange={(e) => patchStudentDecision(student.studentId, { notes: e.target.value })}
                                    placeholder="Nota opcional"
                                  />
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {!startLoading && startPlan && startStep === 'review' && (
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
                    <div className="rounded-lg border border-gray-200 p-4">
                      <BookOpen className="h-5 w-5 text-emerald-700" aria-hidden />
                      <p className="mt-2 text-sm text-gray-500">Cursos activos</p>
                      <p className="text-2xl font-semibold text-gray-900">{selectedStartCourses.length}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <CheckCircle2 className="h-5 w-5 text-emerald-700" aria-hidden />
                      <p className="mt-2 text-sm text-gray-500">Orientaciones</p>
                      <p className="text-2xl font-semibold text-gray-900">{selectedOrientationKeys.size}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <ArrowRight className="h-5 w-5 text-emerald-700" aria-hidden />
                      <p className="mt-2 text-sm text-gray-500">Pasan</p>
                      <p className="text-2xl font-semibold text-gray-900">{startDecisionSummary.PROMOTE}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <RefreshCw className="h-5 w-5 text-amber-700" aria-hidden />
                      <p className="mt-2 text-sm text-gray-500">Repiten</p>
                      <p className="text-2xl font-semibold text-gray-900">{startDecisionSummary.REPEAT}</p>
                    </div>
                    <div className="rounded-lg border border-gray-200 p-4">
                      <CheckCircle2 className="h-5 w-5 text-slate-700" aria-hidden />
                      <p className="mt-2 text-sm text-gray-500">Cierran matrícula</p>
                      <p className="text-2xl font-semibold text-gray-900">
                        {startDecisionSummary.GRADUATED + startDecisionSummary.WITHDRAWN + startDecisionSummary.TRANSFERRED}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col justify-between gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                <div className="text-xs text-gray-500">
                  {startPlan
                    ? `${selectedStartCourses.length} cursos · ${selectedOrientationKeys.size} orientaciones · ${startPlan.students.length} estudiantes`
                    : 'Preparando ciclo'}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button type="button" className="btn-secondary text-sm" disabled={starting} onClick={closeStartWizard}>
                    Cancelar
                  </button>
                  {startStep !== 'courses' && (
                    <button
                      type="button"
                      className="btn-secondary text-sm"
                      disabled={starting}
                      onClick={() => setStartStep(startStep === 'review' ? 'students' : 'courses')}
                    >
                      Volver
                    </button>
                  )}
                  {startStep !== 'review' ? (
                    <button
                      type="button"
                      className="btn-primary inline-flex items-center gap-2 text-sm"
                      disabled={startLoading || selectedStartCourses.length === 0}
                      onClick={() => setStartStep(startStep === 'courses' ? 'students' : 'review')}
                    >
                      Continuar
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary inline-flex items-center gap-2 text-sm"
                      disabled={starting || startLoading || selectedStartCourses.length === 0}
                      onClick={() => void submitStartWizard()}
                    >
                      {starting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Rocket className="h-4 w-4" aria-hidden />}
                      Iniciar ciclo
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {copyTarget && (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center"
            role="presentation"
            onClick={(e) => { if (e.target === e.currentTarget) setCopyTarget(null) }}
            onKeyDown={(e) => { if (e.key === 'Escape') setCopyTarget(null) }}
          >
            <div
              className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl sm:p-5"
              role="dialog"
              aria-modal="true"
            >
              <h3 className="text-lg font-semibold text-gray-900">Replicar oferta hacia {copyTarget.code}</h3>
              <p className="mt-1 text-sm text-gray-600">
                El destino debe tener <strong>0 ofertas</strong> (ahora: {copyTarget.coursesCount ?? 0}). Se activan los
                mismos cursos del ciclo origen usando el catálogo estable.
              </p>
              <div className="mt-4">
                <label className="mb-1 block text-xs font-medium text-gray-600">Ciclo origen</label>
                <select className="select-field w-full text-sm" value={copySourceId} onChange={(e) => setCopySourceId(e.target.value)}>
                  <option value="">— Elegí origen —</option>
                  {copySourceOptions.map((y) => (
                    <option key={y.id} value={y.id}>
                      {y.code} — {y.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mt-6 flex flex-col justify-end gap-2 sm:flex-row">
                <button type="button" className="btn-secondary text-sm" onClick={() => setCopyTarget(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary text-sm" disabled={copying} onClick={() => void submitCopy()}>
                  {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Replicar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
