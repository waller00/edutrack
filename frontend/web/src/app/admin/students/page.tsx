'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { isValidUruguayanCI } from '@/lib/forms/uruguay-forms'
import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, ChevronLeft, ChevronRight, GraduationCap, Loader2, Plus, Trash2, X } from 'lucide-react'

const PAGE_SIZE = 20
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const CURRENT_YEAR = new Date().getFullYear()

type CourseOpt = { id: string; name: string; code: string | null; isActive?: boolean; offeringIsActive?: boolean | null }
type TuitionMonthState = 'paid' | 'pending' | 'none'

type TuitionRow = {
  year: number
  month: number
  paid: boolean
  paidAt: string | null
  amountCents: number | null
  notes: string | null
}

type StudentListRow = {
  id: string
  studentId?: string
  enrollmentId?: string
  firstName: string
  lastName: string
  documentId: string | null
  schoolYearId?: string | null
  schoolYearCode?: number | null
  courseId: string | null
  course: { id: string; name: string; code: string | null } | null
  enrollmentStatus: string
  withdrawnAt: string | null
  withdrawalAcademicYear: number | null
  healthCardExpiresAt: string | null
  createdAt: string
  tuitionMonthsPreview: { year: number; month: number; paid: boolean }[]
}

type StudentDetail = {
  id: string
  firstName: string
  lastName: string
  documentId: string | null
  courseId: string | null
  course: { id: string; name: string; code: string | null } | null
  contactPhone: string | null
  tutorPhone: string | null
  username: string | null
  email: string | null
  address: string | null
  healthCardExpiresAt: string | null
  liceoAccessNotes: string | null
  enrollmentStatus: string
  withdrawnAt: string | null
  withdrawalAcademicYear: number | null
  internalNotes: string | null
  createdAt: string
  updatedAt: string
  tuitionMonths: {
    id: string
    year: number
    month: number
    paid: boolean
    paidAt: string | null
    amountCents: number | null
    notes: string | null
  }[]
}

/** Estado del modal (sin exigir fechas de auditoría hasta cargar detalle). */
type StudentFormState = Omit<StudentDetail, 'course' | 'createdAt' | 'updatedAt'> & {
  createdAt?: string
  updatedAt?: string
}

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Activo',
  WITHDRAWN: 'Abandonó',
  GRADUATED: 'Egresó',
  TRANSFERRED: 'Transferido',
}

function ymd(d: string | null | undefined): string {
  if (!d) return ''
  return d.slice(0, 10)
}

function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}

/** Sugerencia local de usuario `nombre.apellido`; el backend valida/genera la definitiva. */
function suggestUsername(firstName: string, lastName: string): string {
  const part = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9\s.-]/g, '')
      .trim()
      .split(/[\s.-]+/)
      .filter(Boolean)
  const first = part(firstName)[0]
  const last = part(lastName)[0]
  if (!first || !last) return ''
  return `${first}.${last}`.slice(0, 30)
}

function emptyDraft(): Omit<StudentFormState, 'id'> {
  return {
    firstName: '',
    lastName: '',
    documentId: null,
    courseId: null,
    contactPhone: null,
    tutorPhone: null,
    username: null,
    email: null,
    address: null,
    healthCardExpiresAt: null,
    liceoAccessNotes: null,
    enrollmentStatus: 'ACTIVE',
    withdrawnAt: null,
    withdrawalAcademicYear: null,
    internalNotes: null,
    tuitionMonths: [],
  }
}

export default function AdminStudentsPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const schoolYearQuery = syCtx?.schoolYearQuery ?? ''
  const coursePickerQuery = syCtx?.schoolYearScopedQuery ?? schoolYearQuery
  const selectedSchoolYearId = syCtx ? syCtx.selectedId ?? syCtx.activeId : null
  const selectedSchoolYear = syCtx?.years.find((y) => y.id === selectedSchoolYearId) ?? null
  const selectedSchoolYearCode = selectedSchoolYear?.code ?? CURRENT_YEAR

  const [summary, setSummary] = useState<{ total: number; byStatus: Record<string, number> } | null>(null)
  const [courses, setCourses] = useState<CourseOpt[]>([])
  const [list, setList] = useState<{ total: number; page: number; pageSize: number; data: StudentListRow[] }>({
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    data: [],
  })
  const [q, setQ] = useState('')
  const [draftQ, setDraftQ] = useState('')
  const [courseId, setCourseId] = useState('')
  const [status, setStatus] = useState('')
  const [tuitionYear, setTuitionYear] = useState(String(CURRENT_YEAR))
  const [tuitionMonth, setTuitionMonth] = useState('')
  const [tuitionPaid, setTuitionPaid] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<'create' | 'edit' | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<StudentFormState>(() => ({
    id: '',
    ...emptyDraft(),
  }))
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [usernameTouched, setUsernameTouched] = useState(false)

  // Mientras el admin no edite el usuario a mano, en el alta se sugiere nombre.apellido.
  useEffect(() => {
    if (modal !== 'create' || usernameTouched) return
    setForm((f) => ({ ...f, username: suggestUsername(f.firstName, f.lastName) || null }))
  }, [modal, usernameTouched, form.firstName, form.lastName])

  const loadSummary = useCallback(async () => {
    try {
      const s = await api<{ total: number; byStatus: Record<string, number> }>(
        withSchoolYear('/admin/students/summary', schoolYearQuery),
      )
      setSummary(s)
    } catch {
      setSummary(null)
    }
  }, [schoolYearQuery])

  const loadCourses = useCallback(async () => {
    try {
      const c = await api<CourseOpt[]>(withSchoolYear('/courses', coursePickerQuery))
      setCourses(Array.isArray(c) ? c : [])
    } catch {
      setCourses([])
    }
  }, [coursePickerQuery])

  const loadList = useCallback(
    async (page: number) => {
      setLoading(true)
      try {
        const sp = new URLSearchParams()
        sp.set('page', String(page))
        sp.set('pageSize', String(PAGE_SIZE))
        if (tuitionYear.trim() && /^\d{4}$/.test(tuitionYear.trim())) sp.set('tuitionPreviewYear', tuitionYear.trim())
        if (q.trim()) sp.set('q', q.trim())
        if (courseId) sp.set('courseId', courseId)
        if (status) sp.set('status', status)
        if ((tuitionMonth || tuitionPaid) && tuitionYear.trim() && /^\d{4}$/.test(tuitionYear.trim())) {
          sp.set('tuitionYear', tuitionYear.trim())
          if (tuitionMonth) sp.set('tuitionMonth', tuitionMonth)
          if (tuitionPaid === 'true' || tuitionPaid === 'false') sp.set('tuitionPaid', tuitionPaid)
        }
        const r = await api<{ total: number; page: number; pageSize: number; data: StudentListRow[] }>(
          withSchoolYear(`/admin/students?${sp.toString()}`, schoolYearQuery),
        )
        setList({
          total: r.total ?? 0,
          page: r.page ?? page,
          pageSize: r.pageSize ?? PAGE_SIZE,
          data: Array.isArray(r.data) ? r.data : [],
        })
      } finally {
        setLoading(false)
      }
    },
    [q, courseId, status, tuitionYear, tuitionMonth, tuitionPaid, schoolYearQuery],
  )

  useEffect(() => {
    void loadSummary()
    void loadCourses()
  }, [loadSummary, loadCourses])

  useEffect(() => {
    void loadList(1)
  }, [loadList])

  useEffect(() => {
    setTuitionYear(String(syCtx?.allYears ? CURRENT_YEAR : selectedSchoolYearCode))
  }, [selectedSchoolYearCode, syCtx?.allYears])

  function applyFilters() {
    setQ(draftQ)
  }

  function openCreate() {
    setMsg('')
    setEditId(null)
    setUsernameTouched(false)
    setForm({ id: '', ...emptyDraft() })
    setModal('create')
  }

  async function openEdit(row: StudentListRow) {
    setMsg('')
    // En modo allYears row.id es compuesto (studentId:enrollmentId); el PUT
    // necesita el studentId real, no el compuesto.
    setEditId(row.studentId ?? row.id)
    setUsernameTouched(true)
    setModal('edit')
    try {
      const d = await api<StudentDetail>(withSchoolYear(`/admin/students/${row.studentId ?? row.id}`, schoolYearQuery))
      const { course: _c, ...rest } = d
      void _c
      setForm({
        ...rest,
        tuitionMonths: d.tuitionMonths.map((t) => ({
          id: t.id,
          year: t.year,
          month: t.month,
          paid: t.paid,
          paidAt: t.paidAt,
          amountCents: t.amountCents,
          notes: t.notes,
        })),
      })
    } catch (e) {
      setModal(null)
      setMsg(e instanceof Error ? e.message : 'No se pudo cargar el estudiante')
    }
  }

  function closeModal() {
    setModal(null)
    setEditId(null)
  }

  function patchForm<K extends keyof StudentFormState>(key: K, value: StudentFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  function tuitionToPayload(): TuitionRow[] {
    return form.tuitionMonths.map((t) => ({
      year: t.year,
      month: t.month,
      paid: t.paid,
      paidAt: t.paidAt || null,
      amountCents: t.amountCents ?? null,
      notes: t.notes ?? null,
    }))
  }

  async function save() {
    setSaving(true)
    setMsg('')
    try {
      const body: Record<string, unknown> = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        documentId: form.documentId?.trim() || undefined,
        courseId: form.courseId || undefined,
        contactPhone: form.contactPhone?.trim() || undefined,
        tutorPhone: form.tutorPhone?.trim() || undefined,
        username: form.username?.trim() || undefined,
        email: form.email?.trim() || undefined,
        address: form.address?.trim() || undefined,
        healthCardExpiresAt: form.healthCardExpiresAt ? `${ymd(form.healthCardExpiresAt)}T12:00:00.000Z` : undefined,
        liceoAccessNotes: form.liceoAccessNotes?.trim() || undefined,
        enrollmentStatus: form.enrollmentStatus,
        withdrawnAt: form.withdrawnAt ? `${ymd(form.withdrawnAt)}T12:00:00.000Z` : undefined,
        withdrawalAcademicYear: form.withdrawalAcademicYear ?? undefined,
        internalNotes: form.internalNotes?.trim() || undefined,
        tuitionMonths: tuitionToPayload(),
      }
      if (syCtx && !syCtx.allYears) {
        const yid = syCtx.selectedId ?? syCtx.activeId
        if (yid) body.schoolYearId = yid
      }
      if (modal === 'create') {
        await api<StudentDetail>('/admin/students', { method: 'POST', body: JSON.stringify(body) })
      } else if (editId) {
        await api<StudentDetail>(`/admin/students/${editId}`, { method: 'PUT', body: JSON.stringify(body) })
      }
      closeModal()
      await loadSummary()
      await loadList(list.page)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('¿Eliminar este registro de estudiante? Esta acción no se puede deshacer.')) return
    try {
      await api(`/admin/students/${id}`, { method: 'DELETE' })
      await loadSummary()
      await loadList(list.page)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Error al eliminar')
    }
  }

  function updateTuition(i: number, patch: Partial<(typeof form.tuitionMonths)[0]>) {
    setForm((f) => {
      const tuitionMonths = [...f.tuitionMonths]
      tuitionMonths[i] = { ...tuitionMonths[i], ...patch }
      return { ...f, tuitionMonths }
    })
  }

  function toggleTuitionMonth(year: number, month: number) {
    setForm((f) => {
      const existing = f.tuitionMonths.find((t) => t.year === year && t.month === month)
      if (!existing) {
        return {
          ...f,
          tuitionMonths: [
            ...f.tuitionMonths,
            { id: '', year, month, paid: true, paidAt: new Date().toISOString(), amountCents: null, notes: null },
          ],
        }
      }
      if (!existing.paid) {
        return {
          ...f,
          tuitionMonths: f.tuitionMonths.filter((t) => !(t.year === year && t.month === month)),
        }
      }
      return {
        ...f,
        tuitionMonths: f.tuitionMonths.map((t) =>
          t.year === year && t.month === month
            ? { ...t, paid: false, paidAt: null, amountCents: null }
            : t,
        ),
      }
    })
  }

  function monthsForYear(rows: { year: number; month: number; paid: boolean }[], year: number) {
    const byMonth = new Map(rows.filter((t) => t.year === year).map((t) => [t.month, t.paid]))
    return MONTHS.map((m) => {
      const paid = byMonth.get(m)
      const status: TuitionMonthState = paid === true ? 'paid' : paid === false ? 'pending' : 'none'
      return { month: m, paid: paid === true, status }
    })
  }

  function tuitionMonthClass(status: TuitionMonthState) {
    if (status === 'paid') return 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
    if (status === 'pending') return 'border-amber-300 bg-amber-100 text-amber-800 hover:bg-amber-200'
    return 'border-gray-300 bg-white text-gray-500 hover:border-emerald-300 hover:text-emerald-700'
  }

  function tuitionMonthLabel(status: TuitionMonthState) {
    if (status === 'paid') return 'pagado'
    if (status === 'pending') return 'pendiente'
    return 'sin estado'
  }

  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize))
  const documentIdTrimmed = form.documentId?.trim() ?? ''
  const documentIdInvalid = documentIdTrimmed !== '' && !isValidUruguayanCI(documentIdTrimmed)

  return (
    <RoleGuard permission="students.manage">
      <main className="responsive-page max-w-[1600px] space-y-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase text-emerald-700">Solo administradores</p>
            <h1 className="text-2xl font-bold text-gray-950 flex items-center gap-2">
              <GraduationCap className="h-8 w-8 text-emerald-600 shrink-0" aria-hidden />
              Estudiantes (gestión)
            </h1>
            <p className="max-w-3xl text-sm text-gray-600">
              Registros administrativos sin cuenta en el sistema: curso, contacto, cuotas por año y estado de matrícula para
              seguimiento y tasas de abandono.
            </p>
          </div>
          <button type="button" onClick={openCreate} className="btn-primary inline-flex items-center gap-2 shrink-0">
            <Plus className="h-4 w-4" aria-hidden />
            Nuevo estudiante
          </button>
        </div>

        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
              <p className="text-xs font-medium uppercase text-gray-500">Total</p>
              <p className="text-xl font-bold text-gray-900">{summary.total}</p>
            </div>
            {(['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'TRANSFERRED'] as const).map((k) => (
              <div key={k} className="rounded-lg border border-gray-100 bg-white px-3 py-2.5 shadow-sm">
                <p className="text-xs font-medium uppercase text-gray-500">{STATUS_LABEL[k]}</p>
                <p className="text-xl font-bold text-gray-900">{summary.byStatus[k] ?? 0}</p>
              </div>
            ))}
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-end">
            <div className="min-w-0 lg:min-w-[180px] lg:flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                placeholder="Nombre, apellido o documento"
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              />
            </div>
            <div className="min-w-0 lg:min-w-[160px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Curso</label>
              <select
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
              >
                <option value="">Todos</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.code ? ` (${c.code})` : ''}
                    {c.isActive === false ? ' — inactivo' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 lg:min-w-[140px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Estado</label>
              <select
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">Todos</option>
                <option value="ACTIVE">Activo</option>
                <option value="WITHDRAWN">Abandonó</option>
                <option value="GRADUATED">Egresó</option>
                <option value="TRANSFERRED">Transferido</option>
              </select>
            </div>
            <div className="w-full lg:w-24">
              <label className="block text-xs font-medium text-gray-600 mb-1">Año</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={tuitionYear}
                onChange={(e) => setTuitionYear(e.target.value)}
                placeholder="2025"
              />
            </div>
            <div className="w-full lg:w-24">
              <label className="block text-xs font-medium text-gray-600 mb-1">Mes</label>
              <select
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={tuitionMonth}
                onChange={(e) => setTuitionMonth(e.target.value)}
              >
                <option value="">Todos</option>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 lg:min-w-[120px]">
              <label className="block text-xs font-medium text-gray-600 mb-1">Pago</label>
              <select
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={tuitionPaid}
                onChange={(e) => setTuitionPaid(e.target.value)}
              >
                <option value="">—</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            </div>
            <button type="button" className="btn-secondary text-sm" onClick={applyFilters}>
              Aplicar
            </button>
          </div>

          {msg && !modal && <p className="text-sm text-red-600">{msg}</p>}

          <div className="-mx-4 overflow-x-auto border-t border-gray-100 sm:-mx-5">
            <table className="w-full min-w-[960px] table-fixed text-sm">
              <colgroup>
                <col className={syCtx?.allYears ? 'w-[20%]' : 'w-[24%]'} />
                {syCtx?.allYears ? <col className="w-[9%]" /> : null}
                <col className="w-[14%]" />
                <col className="w-[11%]" />
                <col className={syCtx?.allYears ? 'w-[44%]' : 'w-[47%]'} />
                <col className="w-[4%]" />
              </colgroup>
              <thead className="bg-gray-50/80">
                <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5 font-medium">Estudiante</th>
                  {syCtx?.allYears ? <th className="px-4 py-2.5 font-medium">Ciclo</th> : null}
                  <th className="px-4 py-2.5 font-medium">Curso</th>
                  <th className="px-4 py-2.5 font-medium">Estado</th>
                  <th className="px-4 py-2.5 font-medium">
                    Mensualidades {syCtx?.allYears ? 'del ciclo' : tuitionYear || CURRENT_YEAR}
                  </th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={syCtx?.allYears ? 6 : 5} className="px-4 py-5 text-center text-gray-500">
                      <Loader2 className="inline h-6 w-6 animate-spin text-emerald-600" aria-hidden />
                    </td>
                  </tr>
                ) : list.data.length === 0 ? (
                  <tr>
                    <td colSpan={syCtx?.allYears ? 6 : 5} className="px-4 py-5 text-center text-gray-500">
                      No hay registros con estos filtros.
                    </td>
                  </tr>
                ) : (
                  list.data.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-slate-50/80">
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          className="text-left font-medium text-emerald-700 hover:underline"
                          onClick={() => void openEdit(row)}
                        >
                          {row.lastName}, {row.firstName}
                        </button>
                        {row.documentId && <div className="text-xs text-gray-500">{row.documentId}</div>}
                      </td>
                      {syCtx?.allYears ? (
                        <td className="px-4 py-2.5 text-gray-600">{row.schoolYearCode ?? '—'}</td>
                      ) : null}
                      <td className="px-4 py-2.5 text-gray-700">{row.course?.name ?? '—'}</td>
                      <td className="px-4 py-2.5">{STATUS_LABEL[row.enrollmentStatus] ?? (row.enrollmentStatus || '—')}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1" aria-label="Mensualidades">
                          {monthsForYear(
                            row.tuitionMonthsPreview,
                            syCtx?.allYears && row.schoolYearCode ? row.schoolYearCode : Number(tuitionYear) || CURRENT_YEAR,
                          ).map((m) => (
                            <span
                              key={m.month}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                                m.status === 'paid'
                                  ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                  : m.status === 'pending'
                                    ? 'border-amber-300 bg-amber-100 text-amber-800'
                                    : 'border-gray-300 bg-white text-gray-500'
                              }`}
                              title={`Mes ${m.month}: ${tuitionMonthLabel(m.status)}`}
                            >
                              {m.month}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <button
                          type="button"
                          className="inline-grid h-8 w-8 place-items-center rounded-lg text-red-600 hover:bg-red-50 hover:text-red-800"
                          title="Eliminar"
                          onClick={() => void remove(row.studentId ?? row.id)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 sm:px-5">
            <p className="text-xs text-gray-500">
              {list.total} registro{list.total === 1 ? '' : 's'} · página {list.page} de {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary p-2"
                disabled={list.page <= 1 || loading}
                onClick={() => void loadList(list.page - 1)}
                aria-label="Anterior"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="btn-secondary p-2"
                disabled={list.page >= totalPages || loading}
                onClick={() => void loadList(list.page + 1)}
                aria-label="Siguiente"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
          </div>
        </div>

        {modal && (
          <div className="responsive-modal bg-black/40">
            <div className="my-0 w-full max-w-2xl rounded-t-2xl border border-gray-200 bg-white shadow-xl sm:my-8 sm:rounded-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                <h2 className="text-lg font-semibold text-gray-900">
                  {modal === 'create' ? 'Nuevo estudiante' : 'Editar estudiante'}
                </h2>
                <button type="button" className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" onClick={closeModal}>
                  <X className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <div className="max-h-[70vh] overflow-y-auto px-4 py-4 space-y-4 text-sm">
                {msg && <p className="text-sm text-red-600">{msg}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nombre *</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.firstName}
                      onChange={(e) => patchForm('firstName', e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Apellido *</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.lastName}
                      onChange={(e) => patchForm('lastName', e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Cédula (opcional)</label>
                    <input
                      className={`w-full rounded-lg border px-3 py-2 ${documentIdInvalid ? 'border-red-400' : 'border-gray-200'}`}
                      value={form.documentId ?? ''}
                      onChange={(e) => patchForm('documentId', e.target.value || null)}
                      inputMode="numeric"
                      placeholder="1.234.567-8"
                      aria-invalid={documentIdInvalid}
                    />
                    {documentIdInvalid && (
                      <p className="mt-1 text-xs text-red-600">Cédula inválida: verificá el número y el dígito verificador</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Curso (opcional)</label>
                    <select
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.courseId ?? ''}
                      onChange={(e) => patchForm('courseId', e.target.value || null)}
                    >
                      <option value="">—</option>
                      {courses.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono contacto</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.contactPhone ?? ''}
                      onChange={(e) => patchForm('contactPhone', e.target.value || null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Teléfono tutor</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.tutorPhone ?? ''}
                      onChange={(e) => patchForm('tutorPhone', e.target.value || null)}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
                    <input
                      type="email"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.email ?? ''}
                      onChange={(e) => patchForm('email', e.target.value || null)}
                    />
                    <p className="mt-1 text-[11px] text-gray-500">
                      Con email se crea su cuenta del aula virtual (Moodle) y le llega la bienvenida.
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Usuario (Moodle)</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.username ?? ''}
                      onChange={(e) => {
                        setUsernameTouched(true)
                        patchForm('username', e.target.value || null)
                      }}
                      placeholder="nombre.apellido"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Dirección</label>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                    value={form.address ?? ''}
                    onChange={(e) => patchForm('address', e.target.value || null)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Vencimiento carnet de salud</label>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={ymd(form.healthCardExpiresAt)}
                      onChange={(e) => patchForm('healthCardExpiresAt', e.target.value ? `${e.target.value}T00:00:00.000Z` : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Estado matrícula</label>
                    <select
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.enrollmentStatus}
                      onChange={(e) => patchForm('enrollmentStatus', e.target.value)}
                    >
                      <option value="ACTIVE">Activo</option>
                      <option value="WITHDRAWN">Abandonó</option>
                      <option value="GRADUATED">Egresó</option>
                      <option value="TRANSFERRED">Transferido</option>
                    </select>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fecha abandono/egreso</label>
                    <input
                      type="date"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={ymd(form.withdrawnAt)}
                      onChange={(e) => patchForm('withdrawnAt', e.target.value ? `${e.target.value}T00:00:00.000Z` : null)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Año ciclo (informes)</label>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      placeholder="ej. 2025"
                      value={form.withdrawalAcademicYear ?? ''}
                      onChange={(e) =>
                        patchForm(
                          'withdrawalAcademicYear',
                          e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
                        )
                      }
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notas portal liceo / claves</label>
                  <textarea
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 min-h-[72px]"
                    value={form.liceoAccessNotes ?? ''}
                    onChange={(e) => patchForm('liceoAccessNotes', e.target.value || null)}
                    placeholder="Opcional. Tratá este campo como información sensible."
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notas internas</label>
                  <textarea
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 min-h-[56px]"
                    value={form.internalNotes ?? ''}
                    onChange={(e) => patchForm('internalNotes', e.target.value || null)}
                  />
                </div>

                <div className="border-t border-gray-100 pt-3 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-2 font-medium text-gray-900">
                      <CalendarCheck className="h-4 w-4 text-emerald-600" aria-hidden />
                      Mensualidades
                    </span>
                    <label className="flex items-center gap-2 text-xs text-gray-600">
                      Año
                      <input
                        type="number"
                        className="w-24 rounded-lg border border-gray-200 px-2 py-1 text-sm"
                        value={tuitionYear || CURRENT_YEAR}
                        onChange={(e) => setTuitionYear(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
                    {monthsForYear(form.tuitionMonths, Number(tuitionYear) || CURRENT_YEAR).map((m) => (
                      <button
                        key={m.month}
                        type="button"
                        className={`h-10 rounded-full border text-sm font-semibold transition ${tuitionMonthClass(m.status)}`}
                        onClick={() => toggleTuitionMonth(Number(tuitionYear) || CURRENT_YEAR, m.month)}
                        aria-pressed={m.status !== 'none'}
                        title={`Mes ${m.month}: ${tuitionMonthLabel(m.status)}`}
                      >
                        {m.month}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    {(() => {
                      const months = monthsForYear(form.tuitionMonths, Number(tuitionYear) || CURRENT_YEAR)
                      const paid = months.filter((m) => m.status === 'paid').length
                      const pending = months.filter((m) => m.status === 'pending').length
                      const none = months.length - paid - pending
                      return `${paid} pagos · ${pending} pendientes · ${none} sin estado`
                    })()}
                  </p>
                  {form.tuitionMonths
                    .filter((t) => t.year === (Number(tuitionYear) || CURRENT_YEAR) && t.paid)
                    .sort((a, b) => a.month - b.month)
                    .map((t) => {
                      const i = form.tuitionMonths.findIndex((x) => x.year === t.year && x.month === t.month)
                      return (
                        <div key={`${t.year}-${t.month}`} className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-[72px_140px_120px_1fr]">
                          <div>
                            <label className="block text-[10px] uppercase text-gray-500">Mes</label>
                            <span className="block rounded border border-gray-200 bg-white px-2 py-1 font-semibold">{t.month}</span>
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase text-gray-500">Fecha pago</label>
                            <input
                              type="date"
                              className="w-full rounded border border-gray-200 px-2 py-1"
                              value={ymd(t.paidAt)}
                              onChange={(e) =>
                                updateTuition(i, { paidAt: e.target.value ? `${e.target.value}T00:00:00.000Z` : null })
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase text-gray-500">Monto (¢)</label>
                            <input
                              type="number"
                              className="w-full rounded border border-gray-200 px-2 py-1"
                              value={t.amountCents ?? ''}
                              onChange={(e) =>
                                updateTuition(i, {
                                  amountCents: e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
                                })
                              }
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase text-gray-500">Notas</label>
                            <input
                              className="w-full rounded border border-gray-200 px-2 py-1"
                              value={t.notes ?? ''}
                              onChange={(e) => updateTuition(i, { notes: e.target.value || null })}
                            />
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
              <div className="flex flex-col justify-end gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row">
                <button type="button" className="btn-secondary" onClick={closeModal}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={saving || !form.firstName.trim() || !form.lastName.trim() || documentIdInvalid}
                  onClick={() => void save()}
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                  Guardar
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
