'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useLibreta } from '@/contexts/LibretaContext'

type Entry = {
  id: string
  date: string
  hoursTaught: number
  hoursNotTaught: number
  description: string
  attachments: string | null
}

type Response = {
  data: Entry[]
  totals: { hoursTaught: number; hoursNotTaught: number }
  canEdit: boolean
}

function formatDay(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

/**
 * Desarrollo del curso: el registro clase a clase.
 *
 * Es el equivalente al cuaderno del docente. El total de horas dictadas se calcula del conjunto
 * completo y no del filtro: son horas del curso, no de la búsqueda.
 */
export default function DesarrolloSection() {
  const { gradeBookId } = useLibreta()
  const [state, setState] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [filters, setFilters] = useState({ from: '', to: '', q: '' })
  const [applied, setApplied] = useState(filters)
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    hoursTaught: 2,
    hoursNotTaught: 0,
    description: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (applied.from) params.set('from', applied.from)
      if (applied.to) params.set('to', applied.to)
      if (applied.q) params.set('q', applied.q)
      setState(await api<Response>(`/gradebook/${gradeBookId}/development?${params}`))
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo cargar el desarrollo' })
    } finally {
      setLoading(false)
    }
  }, [gradeBookId, applied])

  useEffect(() => {
    void load()
  }, [load])

  async function addEntry() {
    if (form.description.trim() === '') return
    setBusy(true)
    setMessage(null)
    try {
      await api(`/gradebook/${gradeBookId}/development`, { method: 'POST', body: JSON.stringify(form) })
      setForm({ ...form, description: '' })
      setMessage({ kind: 'ok', text: 'Clase registrada.' })
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo registrar' })
    } finally {
      setBusy(false)
    }
  }

  async function removeEntry(id: string) {
    setBusy(true)
    try {
      await api(`/gradebook/${gradeBookId}/development/${id}`, { method: 'DELETE' })
      await load()
    } catch (err) {
      setMessage({ kind: 'error', text: err instanceof Error ? err.message : 'No se pudo borrar' })
    } finally {
      setBusy(false)
    }
  }

  if (loading && !state) {
    return (
      <p className="flex items-center gap-2 py-8 text-sm text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Cargando desarrollo del curso…
      </p>
    )
  }

  const canEdit = state?.canEdit ?? false

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <p className="text-gray-600">Registro clase a clase de lo que se trabajó.</p>
        <p className="font-medium text-slate-700">
          Hs. dictadas: {state?.totals.hoursTaught ?? 0} · Hs. no dictadas: {state?.totals.hoursNotTaught ?? 0}
        </p>
      </div>

      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-green-50 text-green-800'}`}
        >
          {message.text}
        </p>
      )}

      {canEdit && (
        <form
          className="grid gap-2 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-[auto_auto_auto_1fr_auto]"
          onSubmit={(e) => { e.preventDefault(); void addEntry() }}
        >
          <label>
            <span className="mb-1 block text-xs text-gray-600">Fecha</span>
            <input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="mb-1 block text-xs text-gray-600">Hs. dictadas</span>
            <input type="number" min={0} max={24} value={form.hoursTaught} onChange={(e) => setForm({ ...form, hoursTaught: Number(e.target.value) })} className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="mb-1 block text-xs text-gray-600">Hs. no dictadas</span>
            <input type="number" min={0} max={24} value={form.hoursNotTaught} onChange={(e) => setForm({ ...form, hoursNotTaught: Number(e.target.value) })} className="w-24 rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <label>
            <span className="mb-1 block text-xs text-gray-600">¿Qué se trabajó en clase?</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Ley de Coulomb. Ejercicios del capítulo 10." className="w-full rounded border border-gray-300 px-2 py-1.5 text-sm" />
          </label>
          <div className="flex items-end">
            <button type="submit" disabled={busy || form.description.trim() === ''} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
              <Plus className="h-4 w-4" aria-hidden />
              Registrar
            </button>
          </div>
        </form>
      )}

      <form
        className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2"
        onSubmit={(e) => { e.preventDefault(); setApplied(filters) }}
      >
        <label><span className="mb-1 block text-xs text-gray-600">Desde</span>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" /></label>
        <label><span className="mb-1 block text-xs text-gray-600">Hasta</span>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className="rounded border border-gray-300 px-2 py-1 text-sm" /></label>
        <label className="flex-1 min-w-[180px]"><span className="mb-1 block text-xs text-gray-600">Buscar en el desarrollo</span>
          <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} className="w-full rounded border border-gray-300 px-2 py-1 text-sm" /></label>
        <button type="button" onClick={() => { const empty = { from: '', to: '', q: '' }; setFilters(empty); setApplied(empty) }} className="px-2 py-1 text-sm text-emerald-700 hover:underline">LIMPIAR</button>
        <button type="submit" className="rounded bg-slate-700 px-3 py-1 text-sm font-semibold text-white hover:bg-slate-800">BUSCAR</button>
      </form>

      {(state?.data.length ?? 0) === 0 ? (
        <p className="rounded-lg border border-gray-200 bg-white px-4 py-6 text-center text-sm text-gray-500">
          Todavía no hay clases registradas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-gray-100 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th scope="col" className="px-3 py-2 text-left font-medium">Fecha</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Dictadas</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">No dictadas</th>
                <th scope="col" className="px-3 py-2 text-left font-medium">Desarrollo</th>
                {canEdit && <th scope="col" className="px-3 py-2 text-left font-medium">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {state!.data.map((entry) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-3 py-1.5 text-gray-700">{formatDay(entry.date)}</td>
                  <td className="px-3 py-1.5 text-gray-700">{entry.hoursTaught}</td>
                  <td className="px-3 py-1.5 text-gray-700">{entry.hoursNotTaught}</td>
                  <td className="px-3 py-1.5 text-gray-900">{entry.description}</td>
                  {canEdit && (
                    <td className="px-3 py-1.5">
                      <button type="button" onClick={() => void removeEntry(entry.id)} disabled={busy} aria-label={`Borrar la clase del ${formatDay(entry.date)}`} className="text-red-600 hover:text-red-800 disabled:opacity-50">
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
