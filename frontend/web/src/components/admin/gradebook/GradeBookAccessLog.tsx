'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'

type Access = { id: string; userName: string | null; roleCode: string; ip: string | null; occurredAt: string }

function when(iso: string): string {
  return new Intl.DateTimeFormat('es-UY', { timeZone: 'America/Montevideo', dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(iso),
  )
}

/**
 * Quién abrió la libreta y cuándo (RF-100). El registro se escribía en cada apertura y no había
 * dónde leerlo. Se carga al desplegarlo: es de consulta ocasional.
 */
export default function GradeBookAccessLog({ gradeBookId }: { gradeBookId: string }) {
  const [rows, setRows] = useState<Access[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (rows || loading) return
    setLoading(true)
    try {
      const res = await api<{ data: Access[] }>(`/admin/gradebook/gradebooks/${gradeBookId}/access-log`)
      setRows(res.data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el registro de accesos')
    } finally {
      setLoading(false)
    }
  }

  return (
    <details
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) void load()
      }}
    >
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500">
        Accesos a la libreta
      </summary>
      <div className="mt-1 text-sm">
        {loading && (
          <p className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando…
          </p>
        )}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {rows && rows.length === 0 && <p className="text-gray-500">Nadie la abrió todavía.</p>}
        {rows && rows.length > 0 && (
          <ul className="space-y-0.5">
            {rows.map((row) => (
              <li key={row.id} className="text-gray-700">
                {when(row.occurredAt)} · {row.userName ?? 'Usuario borrado'}
                <span className="text-xs text-gray-500"> ({row.roleCode}{row.ip ? `, ${row.ip}` : ''})</span>
              </li>
            ))}
          </ul>
        )}
        {rows && rows.length === 100 && <p className="text-xs text-gray-500">Se muestran los últimos 100.</p>}
      </div>
    </details>
  )
}
