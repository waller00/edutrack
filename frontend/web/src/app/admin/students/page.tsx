'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GraduationCap, Plus, Receipt } from 'lucide-react'
import Link from 'next/link'
import RoleGuard from '@/components/auth/RoleGuard'
import PaginationControls from '@/components/common/PaginationControls'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { api } from '@/lib/api/client'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { countActiveStudentFilters, getMoodleStatusView } from '@/lib/admin/students-display'
import { buildStudentListQuery, STUDENT_PAGE_SIZE } from '@/lib/admin/students-filters'
import StudentsSummaryCards from '@/components/admin/students/StudentsSummaryCards'
import StudentsFilterBar, { type StudentFilters } from '@/components/admin/students/StudentsFilterBar'
import StudentsTable from '@/components/admin/students/StudentsTable'
import StudentsCardList from '@/components/admin/students/StudentsCardList'
import StudentFormModal from '@/components/admin/students/StudentFormModal'
import {
  emptyStudentDraft,
  suggestUsername,
  ymd,
  type CourseOpt,
  type MoodleAccountStatus,
  type OrientationOpt,
  type StudentDetail,
  type StudentFormState,
  type StudentListResponse,
  type StudentListRow,
  type StudentSummary,
} from '@/components/admin/students/student-types'

const EMPTY_FILTERS: StudentFilters = {
  draftQ: '',
  courseId: '',
  orientationId: '',
  status: '',
}

type PendingAction =
  | { kind: 'delete'; row: StudentListRow }
  | { kind: 'moodle'; op: 'provision' | 'resend'; studentId: string; name: string }

export default function AdminStudentsPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const coursePickerQuery = syCtx?.schoolYearScopedQuery ?? schoolYearQuery
  const selectedSchoolYearId = syCtx ? syCtx.selectedId ?? syCtx.activeId : null
  const allYears = Boolean(syCtx?.allYears)

  const [summary, setSummary] = useState<StudentSummary | null>(null)
  const [courses, setCourses] = useState<CourseOpt[]>([])
  const [filterOrientations, setFilterOrientations] = useState<OrientationOpt[]>([])
  const [modalOrientations, setModalOrientations] = useState<OrientationOpt[]>([])
  const [list, setList] = useState<StudentListResponse>({
    total: 0,
    page: 1,
    pageSize: STUDENT_PAGE_SIZE,
    data: [],
  })
  const [filters, setFilters] = useState<StudentFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const listRequestId = useRef(0)

  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [form, setForm] = useState<StudentFormState>(() => ({ id: '', ...emptyStudentDraft() }))
  const [saving, setSaving] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [msg, setMsg] = useState('')

  // La búsqueda se aplica sola tras una pausa; el resto de los filtros, al instante.
  const debouncedQ = useDebouncedValue(filters.draftQ, 350)

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await api<StudentSummary>(withSchoolYear('/admin/students/summary', schoolYearQuery)))
    } catch (e) {
      setSummary(null)
      setMsg(e instanceof Error ? e.message : 'No se pudo cargar el resumen')
    }
  }, [schoolYearQuery])

  const loadCourses = useCallback(async () => {
    try {
      const rows = await api<CourseOpt[]>(withSchoolYear('/courses', coursePickerQuery))
      setCourses(Array.isArray(rows) ? rows : [])
    } catch (e) {
      setCourses([])
      setMsg(e instanceof Error ? e.message : 'No se pudieron cargar los cursos')
    }
  }, [coursePickerQuery])

  const loadOrientations = useCallback(
    async (courseId: string): Promise<OrientationOpt[]> => {
      if (!courseId) return []
      try {
        const rows = await api<OrientationOpt[]>(
          withSchoolYear(`/courses/${courseId}/orientations`, coursePickerQuery),
        )
        return Array.isArray(rows) ? rows : []
      } catch {
        return []
      }
    },
    [coursePickerQuery],
  )

  const loadList = useCallback(async () => {
    const requestId = ++listRequestId.current
    setLoading(true)
    try {
      const query = buildStudentListQuery({
        page,
        q: debouncedQ,
        courseId: filters.courseId,
        orientationId: filters.orientationId,
        status: filters.status,
        tuitionYear: '',
        tuitionMonth: '',
        tuitionPaid: '',
        includeMoodle: true,
      })
      const r = await api<StudentListResponse>(withSchoolYear(`/admin/students?${query}`, schoolYearQuery))
      if (requestId !== listRequestId.current) return
      setList({
        total: r.total ?? 0,
        page: r.page ?? page,
        pageSize: r.pageSize ?? STUDENT_PAGE_SIZE,
        data: Array.isArray(r.data) ? r.data : [],
      })
    } catch (e) {
      if (requestId !== listRequestId.current) return
      setMsg(e instanceof Error ? e.message : 'No se pudieron cargar los estudiantes')
      setList({ total: 0, page: 1, pageSize: STUDENT_PAGE_SIZE, data: [] })
    } finally {
      if (requestId === listRequestId.current) setLoading(false)
    }
  }, [
    page,
    debouncedQ,
    filters.courseId,
    filters.orientationId,
    filters.status,
    schoolYearQuery,
  ])

  useEffect(() => {
    void loadSummary()
    void loadCourses()
  }, [loadSummary, loadCourses])

  useEffect(() => {
    let current = true
    setFilterOrientations([])
    void loadOrientations(filters.courseId).then((rows) => { if (current) setFilterOrientations(rows) })
    return () => { current = false }
  }, [filters.courseId, loadOrientations])

  useEffect(() => {
    let current = true
    setModalOrientations([])
    void loadOrientations(form.courseId ?? '').then((rows) => { if (current) setModalOrientations(rows) })
    return () => { current = false }
  }, [form.courseId, loadOrientations])

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => { setPage(1) }, [schoolYearQuery])

  // Cambiar un filtro siempre vuelve a la primera página: si no, se ve "no hay registros".
  function patchFilters(patch: Partial<StudentFilters>) {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(1)
  }

  // Mientras el admin no edite el usuario a mano, en el alta se sugiere nombre.apellido.
  useEffect(() => {
    if (modal !== 'create' || usernameTouched) return
    setForm((f) => ({ ...f, username: suggestUsername(f.firstName, f.lastName) || null }))
  }, [modal, usernameTouched, form.firstName, form.lastName])

  function openCreate() {
    setMsg('')
    setUsernameTouched(false)
    setForm({ id: '', ...emptyStudentDraft() })
    setModal('create')
  }

  async function openEdit(row: StudentListRow) {
    setMsg('')
    setUsernameTouched(true)
    setModal('edit')
    try {
      const detail = await api<StudentDetail>(
        withSchoolYear(`/admin/students/${row.studentId}`, schoolYearQuery),
      )
      const { course: _course, ...rest } = detail
      void _course
      setForm({ ...rest, tuitionMonths: detail.tuitionMonths ?? [] })
    } catch (e) {
      setModal(null)
      setMsg(e instanceof Error ? e.message : 'No se pudo cargar el estudiante')
    }
  }

  function patchForm<K extends keyof StudentFormState>(key: K, value: StudentFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      const body: Record<string, unknown> = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        // Campos borrables: se manda null (no undefined) para que al vaciarlos se limpien.
        documentId: form.documentId?.trim() || null,
        courseId: form.courseId || undefined,
        orientationId: form.orientationId ?? null,
        contactPhone: form.contactPhone?.trim() || null,
        tutorPhone: form.tutorPhone?.trim() || null,
        username: form.username?.trim(),
        email: form.email?.trim(),
        address: form.address?.trim() || null,
        birthDate: form.birthDate ? `${ymd(form.birthDate)}T12:00:00.000Z` : null,
        admittedFrom: form.admittedFrom?.trim() || null,
        healthCardExpiresAt: form.healthCardExpiresAt ? `${ymd(form.healthCardExpiresAt)}T12:00:00.000Z` : null,
        liceoAccessNotes: form.liceoAccessNotes?.trim() || null,
        enrollmentStatus: form.enrollmentStatus,
        academicResult: form.academicResult || null,
        apeReferred: form.apeReferred ?? false,
        withdrawnAt: form.withdrawnAt ? `${ymd(form.withdrawnAt)}T12:00:00.000Z` : null,
        withdrawalAcademicYear: form.withdrawalAcademicYear ?? null,
        internalNotes: form.internalNotes?.trim() || null,
      }
      if (syCtx && !syCtx.allYears && selectedSchoolYearId) body.schoolYearId = selectedSchoolYearId

      if (modal === 'create') {
        await api<StudentDetail>('/admin/students', { method: 'POST', body: JSON.stringify(body) })
      } else if (form.id) {
        await api<StudentDetail>(`/admin/students/${form.id}`, { method: 'PUT', body: JSON.stringify(body) })
      }
      setModal(null)
      setMsg('✅ Estudiante guardado')
      await Promise.all([loadSummary(), loadList()])
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function runPendingAction() {
    if (!pendingAction) return
    const action = pendingAction
    setPendingAction(null)
    try {
      if (action.kind === 'delete') {
        await api(`/admin/students/${action.row.studentId}`, { method: 'DELETE' })
        setMsg('✅ Estudiante eliminado')
        await Promise.all([loadSummary(), loadList()])
        return
      }
      setResendingId(action.studentId)
      // Crear y reenviar son endpoints distintos a propósito: crear es idempotente y no pisa la
      // contraseña; reenviar la regenera y se niega si el alumno ya entró.
      const path =
        action.op === 'provision'
          ? `/admin/students/${action.studentId}/moodle-account`
          : `/admin/students/${action.studentId}/moodle-welcome/resend`
      const response = await api<{ message: string; moodle: MoodleAccountStatus }>(path, { method: 'POST' })
      setMsg(`✅ ${response.message || 'Listo'}`)
      setForm((current) => (current.id === action.studentId ? { ...current, moodle: response.moodle } : current))
      await loadList()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudo completar la acción')
    } finally {
      setResendingId(null)
    }
  }

  const activeFilterCount = useMemo(
    () =>
      countActiveStudentFilters({
        q: filters.draftQ,
        courseId: filters.courseId,
        orientationId: filters.orientationId,
        status: filters.status,
        tuitionMonth: '',
        tuitionPaid: '',
      }),
    [filters],
  )

  const listProps = {
    rows: list.data,
    loading,
    allYears,
    resendingId,
    onOpen: (row: StudentListRow) => void openEdit(row),
    onDelete: (row: StudentListRow) => setPendingAction({ kind: 'delete', row }),
    onResendMoodle: (row: StudentListRow) => {
      const view = getMoodleStatusView(row.moodle?.state, row.moodle)
      if (view.action === 'none') return
      setPendingAction({
        kind: 'moodle',
        op: view.action,
        studentId: row.studentId,
        name: `${row.firstName} ${row.lastName}`,
      })
    },
  }

  return (
    <RoleGuard permission="students.manage" permissionScope="all">
      <main className="responsive-page max-w-[1600px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 sm:flex">
              <GraduationCap className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl font-bold text-gray-950">Estudiantes</h1>
              <p className="max-w-3xl text-sm text-gray-600">
                Matrícula, contacto y acceso al aula virtual.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/tuition" className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-600 hover:bg-gray-100">
              <Receipt className="h-4 w-4" aria-hidden />
              Mensualidades
            </Link>
            <button type="button" onClick={openCreate} className="btn-primary shrink-0">
              <Plus className="h-4 w-4" aria-hidden />
              Nuevo estudiante
            </button>
          </div>
        </header>

        <StudentsSummaryCards summary={summary} loading={loading} />

        {msg && !modal ? (
          <p className={`rounded-lg px-3 py-2 text-sm ${getAdminFlashMessageClass(msg)}`} role="status">
            {msg}
          </p>
        ) : null}

        <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="space-y-4 p-4 sm:p-5">
            <StudentsFilterBar
              filters={filters}
              courses={courses}
              orientations={filterOrientations}
              activeFilterCount={activeFilterCount}
              onChange={patchFilters}
              onClear={() => {
                setFilters(EMPTY_FILTERS)
                setPage(1)
              }}
            />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label="Filtrar estudiantes por estado" className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
                {([
                  { value: '', label: 'Todos' },
                  { value: 'ACTIVE', label: 'Activos' },
                  { value: 'WITHDRAWN', label: 'Abandonaron' },
                  { value: 'GRADUATED', label: 'Egresados' },
                  { value: 'TRANSFERRED', label: 'Transferidos' },
                ] as const).map(({ value, label }) => (
                  <button key={value} type="button" aria-pressed={filters.status === value} onClick={() => patchFilters({ status: value })} className={`min-h-9 rounded-md px-3 py-1.5 text-xs font-medium ${filters.status === value ? 'bg-white text-emerald-800 shadow-sm' : 'text-gray-600 hover:bg-white/70'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500" aria-live="polite">
                {loading ? 'Cargando estudiantes…' : `Mostrando ${list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1}–${Math.min(list.page * list.pageSize, list.total)} de ${list.total} ${allYears ? 'matrículas' : 'estudiantes'}`}
              </p>
            </div>

            <StudentsTable {...listProps} />
            <StudentsCardList {...listProps} />
          </div>

          <PaginationControls
            page={list.page}
            total={list.total}
            pageSize={list.pageSize}
            onPageChange={setPage}
          />
        </section>

        {modal ? (
          <StudentFormModal
            mode={modal}
            form={form}
            courses={courses}
            orientations={modalOrientations}
            saving={saving}
            moodlePending={resendingId === form.id}
            message={msg}
            onPatch={patchForm}
            onUsernameEdit={(value) => {
              setUsernameTouched(true)
              patchForm('username', value)
            }}
            onMoodleAction={(op) =>
              setPendingAction({
                kind: 'moodle',
                op,
                studentId: form.id,
                name: `${form.firstName} ${form.lastName}`,
              })
            }
            onSave={() => void save()}
            onClose={() => setModal(null)}
          />
        ) : null}

        {pendingAction ? (
          <ConfirmDialog
            title={
              pendingAction.kind === 'delete'
                ? 'Eliminar estudiante'
                : pendingAction.op === 'provision'
                  ? 'Crear cuenta en el aula virtual'
                  : 'Reenviar acceso al aula virtual'
            }
            message={
              pendingAction.kind === 'delete'
                ? `Se eliminará el registro de ${pendingAction.row.lastName}, ${pendingAction.row.firstName} junto con sus matrículas. Esta acción no se puede deshacer. Si ya tiene notas, asistencias o cuotas pagas no se elimina: se da de baja su matrícula.`
                : pendingAction.op === 'provision'
                  ? `Se creará la cuenta de ${pendingAction.name} en Moodle y se le enviará el acceso por correo.`
                  : `Se generará una nueva contraseña temporal y se le enviará por correo a ${pendingAction.name}.`
            }
            confirmLabel={
              pendingAction.kind === 'delete'
                ? 'Eliminar'
                : pendingAction.op === 'provision'
                  ? 'Crear cuenta'
                  : 'Reenviar'
            }
            tone={pendingAction.kind === 'delete' ? 'danger' : 'default'}
            onConfirm={() => void runPendingAction()}
            onCancel={() => setPendingAction(null)}
          />
        ) : null}
      </main>
    </RoleGuard>
  )
}
