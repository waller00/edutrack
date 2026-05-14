'use client'

import RoleGuard from '@/components/RoleGuard'
import { api } from '@/lib/api'
import { ChevronDown, HelpCircle, Loader2, MessageCircle, Send, Sparkles } from 'lucide-react'
import { useCallback, useState } from 'react'

type Column = { key: string; label: string }

type AssistantResponse = {
  intent: string
  summary: string
  columns: Column[]
  rows: Record<string, string | number | null>[]
}

const INTENT_TITLE: Record<string, string> = {
  HOURS_WORKED_SUMMARY: 'Horas trabajadas',
  ATTENDANCE_INCIDENTS_SUMMARY: 'Incidencias de asistencia',
  MEDICAL_LEAVES_SUMMARY: 'Licencias y permisos',
  ASSIGNED_EVENTS_SUMMARY: 'Eventos asignados',
  BIOMETRIC_ISSUES_SUMMARY: 'Marcas biométricas',
  ATTENDANCE_LATE_SUMMARY: 'Tardanzas',
  USERS_ADMIN_SNAPSHOT: 'Usuarios',
  AUDIT_LOG_SUMMARY: 'Auditoría',
  SQL_QUERY: 'Consulta SQL',
  UNKNOWN: 'Consulta no reconocida',
}

const EXAMPLE_PROMPTS: { label: string; text: string }[] = [
  { label: 'Horas', text: 'Horas trabajadas en octubre' },
  { label: 'Horas docente', text: 'Horas del docente Martínez en mayo' },
  { label: 'Licencias', text: 'Licencias activas en marzo' },
  { label: 'Incidencias', text: 'Incidencias abiertas de mayo' },
  { label: 'Ausencias', text: '¿Quién faltó más en abril?' },
  { label: 'Usuarios', text: 'Lista de usuarios' },
  { label: 'Tardanzas', text: 'Tardanzas en septiembre' },
  { label: 'Tardanzas docente', text: 'Tardanzas docente Ana en agosto' },
  { label: 'Eventos', text: 'Eventos asignados a docentes en junio' },
  { label: 'Auditoría', text: 'Auditoría de logins este mes' },
]

function intentTitle(intent: string): string {
  return INTENT_TITLE[intent] ?? intent.replace(/_/g, ' ')
}

export default function AdminQueryAssistantPage() {
  const [question, setQuestion] = useState('Horas trabajadas en octubre')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AssistantResponse | null>(null)

  const submit = useCallback(async () => {
    const q = question.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await api<AssistantResponse>('/admin/query-assistant', {
        method: 'POST',
        body: JSON.stringify({ question: q }),
      })
      setResult(r)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al consultar'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [question])

  function applyExample(text: string) {
    setQuestion(text)
    setResult(null)
    setError(null)
  }

  return (
    <RoleGuard allow={['ADMIN']}>
      <main className="mx-auto max-w-4xl p-6 space-y-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100">
            <MessageCircle className="h-6 w-6 text-emerald-700" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold text-gray-900">Asistente de consultas</h1>
            <p className="mt-1 text-sm text-gray-600">
              Escribí en español lo que necesitás revisar; el sistema interpreta la pregunta y arma una tabla con datos
              reales (solo lectura).
            </p>
          </div>
        </div>

        <details className="group rounded-xl border border-slate-200 bg-slate-50/80 open:bg-white open:shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-slate-800 [&::-webkit-details-marker]:hidden">
            <HelpCircle className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            Consejos y temas que podés preguntar
            <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-slate-100 px-4 pb-4 pt-2 text-sm text-slate-600">
            <ul className="list-inside list-disc space-y-1.5">
              <li>
                <strong>Horas</strong>, <strong>licencias</strong>, <strong>incidencias</strong>,{' '}
                <strong>eventos asignados</strong>, <strong>marcas biométricas</strong> con error,{' '}
                <strong>tardanzas</strong>, <strong>usuarios</strong> (activos, pendientes, inactivos, documento por
                vencer) y <strong>auditoría</strong>.
              </li>
              <li>
                Incluí <strong>mes</strong> (y año si no es el actual): «licencias de marzo», «horas en junio 2025».
              </li>
              <li>
                Si la tabla sale vacía, puede que no haya registros en ese período; probá otro mes o revisá la carga en
                el resto del panel admin.
              </li>
              <li>Los resultados pueden truncarse si hay muchas filas (límite del servidor).</li>
            </ul>
          </div>
        </details>

        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <label className="block text-sm font-medium text-gray-700" htmlFor="qa-question">
            Tu pregunta
          </label>
          <textarea
            id="qa-question"
            className="input-modern min-h-[88px] w-full resize-y text-sm"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                void submit()
              }
            }}
            placeholder="Ej.: Quiero ver las licencias de marzo"
            disabled={loading}
            rows={3}
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500">Ejemplos:</span>
            {EXAMPLE_PROMPTS.map((ex) => (
              <button
                key={ex.label}
                type="button"
                disabled={loading}
                onClick={() => applyExample(ex.text)}
                className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50/80 px-2.5 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3 opacity-70" aria-hidden />
                {ex.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400">Atajo: Ctrl+Enter o ⌘+Enter para consultar.</p>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading || !question.trim()}
            className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {loading ? 'Consultando…' : 'Consultar'}
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white px-4 py-3 text-sm text-emerald-950 shadow-sm">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <p className="font-semibold text-emerald-900">{intentTitle(result.intent)}</p>
                {result.intent !== 'UNKNOWN' && (
                  <span className="text-[11px] font-normal uppercase tracking-wide text-emerald-600/80">
                    ({result.intent})
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-emerald-800/95 leading-relaxed">{result.summary}</p>
              {result.rows.length > 0 && (
                <p className="mt-2 text-xs text-emerald-700/80">
                  {result.rows.length} fila{result.rows.length === 1 ? '' : 's'} en esta respuesta.
                </p>
              )}
            </div>
            {result.columns.length > 0 && result.rows.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 bg-slate-50">
                      {result.columns.map((c) => (
                        <th key={c.key} className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {result.rows.map((row, i) => (
                      <tr key={i} className="hover:bg-slate-50/50">
                        {result.columns.map((c) => (
                          <td
                            key={c.key}
                            className="max-w-md px-4 py-2.5 align-top text-gray-800 break-words hyphens-auto"
                          >
                            {row[c.key] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-3 text-sm text-gray-600">
                No hay filas para mostrar en este informe (sin datos en el período o filtros muy restrictivos).
              </p>
            )}
          </div>
        )}
      </main>
    </RoleGuard>
  )
}
