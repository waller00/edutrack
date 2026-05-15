'use client'

import RoleGuard from '@/components/RoleGuard'
import { useAdminSchoolYear, type SchoolYearApiRow } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api'
import { useCallback, useMemo, useState } from 'react'
import { CalendarRange, ChevronDown, Loader2, Pencil, Plus, RefreshCw, Copy } from 'lucide-react'

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

function toInputDate(iso: string | null): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

export default function AdminSchoolYearsPage() {
  const { years, activeId, reload } = useAdminSchoolYear()
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createCode, setCreateCode] = useState(String(new Date().getFullYear() + 1))
  const [createLabel, setCreateLabel] = useState('')
  const [createStart, setCreateStart] = useState('')
  const [createEnd, setCreateEnd] = useState('')
  const [creating, setCreating] = useState(false)

  const [editing, setEditing] = useState<SchoolYearApiRow | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  const [copyTarget, setCopyTarget] = useState<SchoolYearApiRow | null>(null)
  const [copySourceId, setCopySourceId] = useState('')
  const [copying, setCopying] = useState(false)

  const [cmpA, setCmpA] = useState('')
  const [cmpB, setCmpB] = useState('')
  const [cmpData, setCmpData] = useState<ComparePayload | null>(null)
  const [cmpLoading, setCmpLoading] = useState(false)
  const [cmpErr, setCmpErr] = useState('')

  const sortedYears = useMemo(() => [...years].sort((a, b) => b.code - a.code), [years])

  const clearFlash = useCallback(() => {
    setMsg('')
    setErr('')
  }, [])

  async function doActivate(id: string) {
    clearFlash()
    setBusyId(id)
    try {
      await api(`/admin/school-years/${id}/activate`, { method: 'POST' })
      setMsg('Ciclo activado. Los demás activos pasaron a cerrados según la política del sistema.')
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo activar')
    } finally {
      setBusyId(null)
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
    setEditEnd(toInputDate(y.endsOn))
  }

  async function saveEdit() {
    if (!editing) return
    clearFlash()
    setSavingEdit(true)
    try {
      const body: Record<string, string | null> = { label: editLabel.trim() }
      body.startsOn = editStart ? new Date(`${editStart}T00:00:00.000Z`).toISOString() : null
      body.endsOn = editEnd ? new Date(`${editEnd}T00:00:00.000Z`).toISOString() : null
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
      if (createEnd) body.endsOn = new Date(`${createEnd}T00:00:00.000Z`).toISOString()
      await api('/admin/school-years', { method: 'POST', body: JSON.stringify(body) })
      setMsg('Ciclo creado en estado planificado.')
      setCreateLabel('')
      setCreateStart('')
      setCreateEnd('')
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
      setErr('El ciclo destino ya tiene cursos catalogados.')
      return
    }
    clearFlash()
    setCopying(true)
    try {
      await api(`/admin/school-years/${copyTarget.id}/copy-courses-from/${copySourceId}`, { method: 'POST' })
      setMsg('Cursos y asignaturas copiados al ciclo destino.')
      setCopyTarget(null)
      setCopySourceId('')
      await reload()
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo copiar')
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
      <main className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
        <header className="space-y-2 border-b border-gray-200 pb-6">
          <div className="flex flex-wrap items-center gap-2 text-emerald-800">
            <CalendarRange className="h-6 w-6" aria-hidden />
            <h1 className="text-2xl font-bold text-gray-950">Ciclos lectivos</h1>
          </div>
          <p className="max-w-3xl text-sm text-gray-600">
            Alta y edición de ciclos, activación del año en curso, cierre y copia de catálogo cuando el ciclo destino tiene{' '}
            <strong>0 cursos</strong> (la columna «Cursos» y el botón Copiar se actualizan con el conteo real). Abajo podés
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
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-gray-100 bg-gray-50/80 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3 sm:px-5">Año</th>
                  <th className="px-4 py-3 sm:px-5">Etiqueta</th>
                  <th className="px-4 py-3 sm:px-5">Inicio</th>
                  <th className="px-4 py-3 sm:px-5">Fin</th>
                  <th className="px-4 py-3 sm:px-5">Estado</th>
                  <th className="px-4 py-3 text-right tabular-nums sm:px-5">Cursos</th>
                  <th className="px-4 py-3 text-right sm:px-5">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sortedYears.map((y) => (
                  <tr key={y.id} className="hover:bg-gray-50/80">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900 sm:px-5">{y.code}</td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-gray-800 sm:max-w-xs sm:px-5">{y.label}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600 sm:px-5">{toInputDate(y.startsOn) || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-600 sm:px-5">{toInputDate(y.endsOn) || '—'}</td>
                    <td className="px-4 py-3 sm:px-5">
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
                    <td className="whitespace-nowrap px-4 py-3 text-right text-slate-800 tabular-nums sm:px-5">
                      {y.coursesCount ?? 0}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right sm:px-5">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          className="rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
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
                            className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                            disabled={busyId === y.id}
                            onClick={() => void doActivate(y.id)}
                          >
                            {busyId === y.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Activar'}
                          </button>
                        )}
                        {y.status === 'PLANNED' && (
                          <button
                            type="button"
                            className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
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
                                ? `Este ciclo ya tiene ${y.coursesCount} curso(s). La copia solo está permitida con catálogo vacío.`
                                : 'Copiar cursos y asignaturas desde otro ciclo'
                            }
                            className="rounded-lg border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent"
                            onClick={() => {
                              setCopyTarget(y)
                              setCopySourceId(sortedYears.find((o) => o.id !== y.id)?.id ?? '')
                            }}
                          >
                            <span className="inline-flex items-center gap-1">
                              <Copy className="h-3.5 w-3.5" aria-hidden />
                              Copiar cursos
                            </span>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sortedYears.length === 0 && <p className="px-5 py-8 text-center text-sm text-gray-500">No hay ciclos cargados.</p>}
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
            onClick={() => setCreateOpen((v) => !v)}
            aria-expanded={createOpen}
          >
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Nuevo ciclo lectivo</h2>
              <p className="text-sm text-gray-500">Se crea en estado planificado; luego podés activarlo o copiar cursos.</p>
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
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Fin (opc.)</label>
                  <input className="input-field text-sm" type="date" value={createEnd} onChange={(e) => setCreateEnd(e.target.value)} />
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
          <p className="mt-1 text-sm text-gray-600">
            Totales de estudiantes por estado de matrícula y cantidad de cursos catalogados. Útil para ver diferencias
            entre años antes de planificar el siguiente.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Ciclo A</label>
              <select className="select-field min-w-[220px] text-sm" value={cmpA} onChange={(e) => setCmpA(e.target.value)}>
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
              <select className="select-field min-w-[220px] text-sm" value={cmpB} onChange={(e) => setCmpB(e.target.value)}>
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
            <div className="mt-6 grid gap-4 md:grid-cols-2">
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
            onClick={() => setEditing(null)}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
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
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Fin</label>
                  <input className="input-field text-sm" type="date" value={editEnd} onChange={(e) => setEditEnd(e.target.value)} />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
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

        {copyTarget && (
          <div
            className="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-4 sm:items-center"
            role="presentation"
            onClick={() => setCopyTarget(null)}
          >
            <div
              className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-semibold text-gray-900">Copiar cursos hacia {copyTarget.code}</h3>
              <p className="mt-1 text-sm text-gray-600">
                El destino debe tener <strong>0 cursos</strong> (ahora: {copyTarget.coursesCount ?? 0}). Se copian cursos y
                asignaturas desde el ciclo origen.
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
              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className="btn-secondary text-sm" onClick={() => setCopyTarget(null)}>
                  Cancelar
                </button>
                <button type="button" className="btn-primary text-sm" disabled={copying} onClick={() => void submitCopy()}>
                  {copying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Copiar'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
