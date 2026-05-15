'use client'

import RoleGuard from '@/components/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api'
import { useCallback, useEffect, useState } from 'react'
import { CalendarCheck, ChevronLeft, ChevronRight, GraduationCap, Loader2, Plus, Trash2, X } from 'lucide-react'

const PAGE_SIZE = 20
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const CURRENT_YEAR = new Date().getFullYear()

type CourseOpt = { id: string; name: string; code: string | null; isActive?: boolean }

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
  firstName: string
  lastName: string
  documentId: string | null
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
  contactEmail: string | null
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

function emptyDraft(): Omit<StudentFormState, 'id'> {
  return {
    firstName: '',
    lastName: '',
    documentId: null,
    courseId: null,
    contactPhone: null,
    tutorPhone: null,
    contactEmail: null,
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
      const c = await api<CourseOpt[]>(withSchoolYear('/courses?all=1', schoolYearQuery))
      setCourses(Array.isArray(c) ? c : [])
    } catch {
      setCourses([])
    }
  }, [schoolYearQuery])

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

  function applyFilters() {
    setQ(draftQ)
  }

  function openCreate() {
    setMsg('')
    setEditId(null)
    setForm({ id: '', ...emptyDraft() })
    setModal('create')
  }

  async function openEdit(row: StudentListRow) {
    setMsg('')
    setEditId(row.id)
    setModal('edit')
    try {
      const d = await api<StudentDetail>(`/admin/students/${row.id}`)
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
        contactEmail: form.contactEmail?.trim() || undefined,
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
      return {
        ...f,
        tuitionMonths: f.tuitionMonths.map((t) =>
          t.year === year && t.month === month
            ? { ...t, paid: !t.paid, paidAt: !t.paid ? new Date().toISOString() : null }
            : t,
        ),
      }
    })
  }

  function monthsForYear(rows: { year: number; month: number; paid: boolean }[], year: number) {
    const paid = new Set(rows.filter((t) => t.year === year && t.paid).map((t) => t.month))
    return MONTHS.map((m) => ({ month: m, paid: paid.has(m) }))
  }

  const totalPages = Math.max(1, Math.ceil(list.total / list.pageSize))

  return (
    <RoleGuard permission="students.manage">
      <main className="mx-auto max-w-7xl p-6 space-y-6">
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-medium uppercase text-gray-500">Total</p>
              <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
            </div>
            {(['ACTIVE', 'WITHDRAWN', 'GRADUATED', 'TRANSFERRED'] as const).map((k) => (
              <div key={k} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-xs font-medium uppercase text-gray-500">{STATUS_LABEL[k]}</p>
                <p className="text-2xl font-bold text-gray-900">{summary.byStatus[k] ?? 0}</p>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1">
              <label className="block text-xs font-medium text-gray-600 mb-1">Buscar</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={draftQ}
                onChange={(e) => setDraftQ(e.target.value)}
                placeholder="Nombre, apellido o documento"
                onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              />
            </div>
            <div className="min-w-[160px]">
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
            <div className="min-w-[140px]">
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
            <div className="w-24">
              <label className="block text-xs font-medium text-gray-600 mb-1">Año</label>
              <input
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                value={tuitionYear}
                onChange={(e) => setTuitionYear(e.target.value)}
                placeholder="2025"
              />
            </div>
            <div className="w-24">
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
            <div className="min-w-[120px]">
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

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-2 pr-3 font-medium">Estudiante</th>
                  <th className="py-2 pr-3 font-medium">Curso</th>
                  <th className="py-2 pr-3 font-medium">Estado</th>
                  <th className="py-2 pr-3 font-medium">Mensualidades {tuitionYear || CURRENT_YEAR}</th>
                  <th className="py-2 pr-3 font-medium w-28" />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-gray-500">
                      <Loader2 className="inline h-6 w-6 animate-spin text-emerald-600" aria-hidden />
                    </td>
                  </tr>
                ) : list.data.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-500">
                      No hay registros con estos filtros.
                    </td>
                  </tr>
                ) : (
                  list.data.map((row) => (
                    <tr key={row.id} className="border-b border-gray-100 hover:bg-slate-50/80">
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="text-left font-medium text-emerald-700 hover:underline"
                          onClick={() => void openEdit(row)}
                        >
                          {row.lastName}, {row.firstName}
                        </button>
                        {row.documentId && <div className="text-xs text-gray-500">{row.documentId}</div>}
                      </td>
                      <td className="py-2 pr-3 text-gray-700">{row.course?.name ?? '—'}</td>
                      <td className="py-2 pr-3">{STATUS_LABEL[row.enrollmentStatus] ?? row.enrollmentStatus}</td>
                      <td className="py-2 pr-3">
                        <div className="flex min-w-[360px] flex-wrap gap-1.5" aria-label="Mensualidades">
                          {monthsForYear(row.tuitionMonthsPreview, Number(tuitionYear) || CURRENT_YEAR).map((m) => (
                            <span
                              key={m.month}
                              className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold ${
                                m.paid
                                  ? 'border-emerald-300 bg-emerald-100 text-emerald-800'
                                  : 'border-gray-300 bg-white text-gray-500'
                              }`}
                              title={`Mes ${m.month}: ${m.paid ? 'pagado' : 'pendiente'}`}
                            >
                              {m.month}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="text-red-600 hover:text-red-800 p-1"
                          title="Eliminar"
                          onClick={() => void remove(row.id)}
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

          <div className="flex items-center justify-between gap-3 pt-2">
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

        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 overflow-y-auto">
            <div className="my-8 w-full max-w-2xl rounded-2xl border border-gray-200 bg-white shadow-xl">
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
                    <label className="block text-xs font-medium text-gray-600 mb-1">Documento (opcional)</label>
                    <input
                      className="w-full rounded-lg border border-gray-200 px-3 py-2"
                      value={form.documentId ?? ''}
                      onChange={(e) => patchForm('documentId', e.target.value || null)}
                    />
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
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Email contacto</label>
                  <input
                    className="w-full rounded-lg border border-gray-200 px-3 py-2"
                    value={form.contactEmail ?? ''}
                    onChange={(e) => patchForm('contactEmail', e.target.value || null)}
                  />
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
                        className={`h-10 rounded-full border text-sm font-semibold transition ${
                          m.paid
                            ? 'border-emerald-300 bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-emerald-300 hover:text-emerald-700'
                        }`}
                        onClick={() => toggleTuitionMonth(Number(tuitionYear) || CURRENT_YEAR, m.month)}
                        aria-pressed={m.paid}
                        title={`Mes ${m.month}: ${m.paid ? 'pagado' : 'pendiente'}`}
                      >
                        {m.month}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-gray-500">
                    {monthsForYear(form.tuitionMonths, Number(tuitionYear) || CURRENT_YEAR).filter((m) => m.paid).length} pagos ·{' '}
                    {12 - monthsForYear(form.tuitionMonths, Number(tuitionYear) || CURRENT_YEAR).filter((m) => m.paid).length}{' '}
                    pendientes
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
              <div className="flex justify-end gap-2 border-t border-gray-100 px-4 py-3">
                <button type="button" className="btn-secondary" onClick={closeModal}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn-primary inline-flex items-center gap-2"
                  disabled={saving || !form.firstName.trim() || !form.lastName.trim()}
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
