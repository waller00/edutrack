'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { GraduationCap, Plus } from 'lucide-react'
import RoleGuard from '@/components/auth/RoleGuard'
import PaginationControls from '@/components/common/PaginationControls'
import ConfirmDialog from '@/components/common/ConfirmDialog'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { api } from '@/lib/api/client'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { countActiveStudentFilters } from '@/lib/admin/students-display'
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

const CURRENT_YEAR = new Date().getFullYear()

const EMPTY_FILTERS: StudentFilters = {
  draftQ: '',
  courseId: '',
  orientationId: '',
  status: '',
  tuitionYear: String(CURRENT_YEAR),
  tuitionMonth: '',
  tuitionPaid: '',
}

type PendingAction =
  | { kind: 'delete'; row: StudentListRow }
  | { kind: 'moodle'; op: 'provision' | 'resend'; studentId: string; name: string }

export default function AdminStudentsPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const coursePickerQuery = syCtx?.schoolYearScopedQuery ?? schoolYearQuery
  const selectedSchoolYearId = syCtx ? syCtx.selectedId ?? syCtx.activeId : null
  const selectedSchoolYearCode = syCtx?.years.find((y) => y.id === selectedSchoolYearId)?.code ?? CURRENT_YEAR
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

  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [form, setForm] = useState<StudentFormState>(() => ({ id: '', ...emptyStudentDraft() }))
  /** Año que se edita en el modal: NO es el del filtro de la tabla, que antes compartían. */
  const [modalTuitionYear, setModalTuitionYear] = useState(CURRENT_YEAR)
  const [saving, setSaving] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [usernameTouched, setUsernameTouched] = useState(false)
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [msg, setMsg] = useState('')

  // La búsqueda se aplica sola tras una pausa; el resto de los filtros, al instante.
  const debouncedQ = useDebouncedValue(filters.draftQ, 350)

  useEffect(() => {
    // El año de cuotas del filtro sigue al ciclo elegido en la barra de administración.
    setFilters((f) => ({ ...f, tuitionYear: String(allYears ? CURRENT_YEAR : selectedSchoolYearCode) }))
  }, [selectedSchoolYearCode, allYears])

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
    setLoading(true)
    try {
      const query = buildStudentListQuery({
        page,
        q: debouncedQ,
        courseId: filters.courseId,
        orientationId: filters.orientationId,
        status: filters.status,
        tuitionYear: filters.tuitionYear,
        tuitionMonth: filters.tuitionMonth,
        tuitionPaid: filters.tuitionPaid,
        includeMoodle: true,
      })
      const r = await api<StudentListResponse>(withSchoolYear(`/admin/students?${query}`, schoolYearQuery))
      setList({
        total: r.total ?? 0,
        page: r.page ?? page,
        pageSize: r.pageSize ?? STUDENT_PAGE_SIZE,
        data: Array.isArray(r.data) ? r.data : [],
      })
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'No se pudieron cargar los estudiantes')
      setList({ total: 0, page: 1, pageSize: STUDENT_PAGE_SIZE, data: [] })
    } finally {
      setLoading(false)
    }
  }, [
    page,
    debouncedQ,
    filters.courseId,
    filters.orientationId,
    filters.status,
    filters.tuitionYear,
    filters.tuitionMonth,
    filters.tuitionPaid,
    schoolYearQuery,
  ])

  useEffect(() => {
    void loadSummary()
    void loadCourses()
  }, [loadSummary, loadCourses])

  useEffect(() => {
    void loadOrientations(filters.courseId).then(setFilterOrientations)
  }, [filters.courseId, loadOrientations])

  useEffect(() => {
    void loadOrientations(form.courseId ?? '').then(setModalOrientations)
  }, [form.courseId, loadOrientations])

  useEffect(() => {
    void loadList()
  }, [loadList])

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
    setModalTuitionYear(allYears ? CURRENT_YEAR : selectedSchoolYearCode)
    setForm({ id: '', ...emptyStudentDraft() })
    setModal('create')
  }

  async function openEdit(row: StudentListRow) {
    setMsg('')
    setUsernameTouched(true)
    setModalTuitionYear(allYears ? row.schoolYearCode ?? CURRENT_YEAR : selectedSchoolYearCode)
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
        healthCardExpiresAt: form.healthCardExpiresAt ? `${ymd(form.healthCardExpiresAt)}T12:00:00.000Z` : null,
        liceoAccessNotes: form.liceoAccessNotes?.trim() || null,
        enrollmentStatus: form.enrollmentStatus,
        withdrawnAt: form.withdrawnAt ? `${ymd(form.withdrawnAt)}T12:00:00.000Z` : null,
        withdrawalAcademicYear: form.withdrawalAcademicYear ?? null,
        internalNotes: form.internalNotes?.trim() || null,
        tuitionMonths: form.tuitionMonths.map((t) => ({
          year: t.year,
          month: t.month,
          paid: t.paid,
          paidAt: t.paidAt || null,
          amountCents: t.amountCents ?? null,
          notes: t.notes ?? null,
        })),
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
        tuitionMonth: filters.tuitionMonth,
        tuitionPaid: filters.tuitionPaid,
      }),
    [filters],
  )

  const listProps = {
    rows: list.data,
    loading,
    allYears,
    tuitionYear: filters.tuitionYear,
    fallbackYear: CURRENT_YEAR,
    resendingId,
    onOpen: (row: StudentListRow) => void openEdit(row),
    onDelete: (row: StudentListRow) => setPendingAction({ kind: 'delete', row }),
    onResendMoodle: (row: StudentListRow) =>
      setPendingAction({
        kind: 'moodle',
        op: row.moodle?.linked ? 'resend' : 'provision',
        studentId: row.studentId,
        name: `${row.firstName} ${row.lastName}`,
      }),
  }

  return (
    <RoleGuard permission="students.manage">
      <main className="responsive-page max-w-[1600px] space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
              <GraduationCap className="h-7 w-7 text-emerald-600" aria-hidden />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Solo administradores</p>
              <h1 className="text-2xl font-bold text-gray-950">Estudiantes</h1>
              <p className="max-w-3xl text-sm text-gray-600">
                Matrícula, contacto, cuotas y acceso al aula virtual.
              </p>
            </div>
          </div>
          <button type="button" onClick={openCreate} className="btn-primary shrink-0">
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo estudiante
          </button>
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
                setFilters({ ...EMPTY_FILTERS, tuitionYear: filters.tuitionYear })
                setPage(1)
              }}
            />

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
            tuitionYear={modalTuitionYear}
            saving={saving}
            moodlePending={resendingId === form.id}
            message={msg}
            onTuitionYearChange={setModalTuitionYear}
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
                ? `Se eliminará el registro de ${pendingAction.row.lastName}, ${pendingAction.row.firstName} junto con sus matrículas y cuotas. Esta acción no se puede deshacer.`
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
