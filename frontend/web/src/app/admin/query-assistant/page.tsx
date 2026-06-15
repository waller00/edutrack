'use client'

import RoleGuard from '@/components/auth/RoleGuard'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { api } from '@/lib/api/client'
import { rowsToTsv } from '@/lib/admin/query-assistant-export'
import { CalendarDays, Check, ChevronDown, Copy, HelpCircle, Loader2, MessageCircle, Send, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

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

/** Clave estable por contenido de la fila (evita usar el índice como key). */
function rowKey(row: AssistantResponse['rows'][number], columns: Column[]): string {
  return columns.map((c) => String(row[c.key] ?? '')).join('¦')
}

function ResultView({
  result,
  copied,
  onCopy,
}: Readonly<{ result: AssistantResponse; copied: boolean; onCopy: () => void }>) {
  const hasTable = result.columns.length > 0 && result.rows.length > 0
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-white px-4 py-3 text-sm text-emerald-950 shadow-sm">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <p className="font-semibold text-emerald-900">{intentTitle(result.intent)}</p>
          {result.intent !== 'UNKNOWN' && (
            <span className="text-[11px] font-normal uppercase tracking-wide text-emerald-600/80">({result.intent})</span>
          )}
        </div>
        <p className="mt-1.5 leading-relaxed text-emerald-800/95">{result.summary}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {result.rows.length > 0 ? (
            <p className="text-xs text-emerald-700/80">
              {result.rows.length} fila{result.rows.length === 1 ? '' : 's'} en esta respuesta.
            </p>
          ) : (
            <span />
          )}
          {hasTable ? (
            <button
              type="button"
              onClick={onCopy}
              className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-800 transition hover:bg-emerald-50"
            >
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
              {copied ? 'Copiado' : 'Copiar tabla'}
            </button>
          ) : null}
        </div>
      </div>

      {hasTable ? (
        <div className="hidden overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm sm:block">
          <table className="min-w-[640px] text-left text-sm">
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
              {result.rows.map((row) => (
                <tr key={rowKey(row, result.columns)} className="hover:bg-slate-50/50">
                  {result.columns.map((c) => (
                    <td key={c.key} className="max-w-md px-4 py-2.5 align-top text-gray-800 break-words hyphens-auto">
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

      {hasTable ? (
        <div className="space-y-3 sm:hidden">
          {result.rows.map((row) => (
            <div key={rowKey(row, result.columns)} className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <dl className="space-y-1.5 text-sm">
                {result.columns.map((c) => (
                  <div key={c.key} className="flex gap-2">
                    <dt className="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500">{c.label}:</dt>
                    <dd className="min-w-0 break-words text-gray-800">{row[c.key] ?? '—'}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function AdminQueryAssistantPage() {
  const syCtx = useOptionalAdminSchoolYear()
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AssistantResponse | null>(null)
  const [copied, setCopied] = useState(false)
  const [selectedSchoolYearId, setSelectedSchoolYearId] = useState<string | null>(null)
  const [allYears, setAllYears] = useState(false)

  useEffect(() => {
    if (!syCtx || syCtx.loading) return
    setSelectedSchoolYearId(syCtx.activeId ?? syCtx.years[0]?.id ?? null)
    setAllYears(false)
  }, [syCtx?.activeId, syCtx?.loading, syCtx?.years])

  const submit = useCallback(async () => {
    const q = question.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const r = await api<AssistantResponse>('/admin/query-assistant', {
        method: 'POST',
        body: JSON.stringify({
          question: q,
          ...(allYears ? { allYears: true } : {}),
          ...(!allYears && selectedSchoolYearId
            ? { schoolYearId: selectedSchoolYearId }
            : {}),
        }),
      })
      setResult(r)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Error al consultar'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [allYears, question, selectedSchoolYearId])

  function applyExample(text: string) {
    setQuestion(text)
    setResult(null)
    setError(null)
  }

  async function copyResult() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(rowsToTsv(result.columns, result.rows))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('No se pudo copiar al portapapeles.')
    }
  }

  return (
    <RoleGuard permission="query-assistant.use">
      <main className="responsive-page max-w-4xl space-y-6">
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
            <p className="mt-2 text-xs font-medium text-emerald-700">
              {syCtx?.allYears
                ? 'El selector global puede estar en todos los ciclos; este asistente arranca filtrado por el ciclo actual.'
                : 'Consultando el ciclo lectivo actual por defecto.'}
            </p>
          </div>
        </div>

        {syCtx && (
          <section className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-start gap-3">
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                  <CalendarDays className="h-5 w-5" aria-hidden />
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Filtro de ciclo lectivo</h2>
                  <p className="mt-1 text-xs text-gray-500">
                    El asistente consulta este ciclo salvo que marques todos los ciclos.
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <label htmlFor="qa-school-year" className="sr-only">
                  Ciclo lectivo
                </label>
                <select
                  id="qa-school-year"
                  className="w-full min-w-0 rounded-lg border border-gray-200 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto sm:min-w-[240px]"
                  disabled={syCtx.loading || allYears}
                  value={selectedSchoolYearId ?? syCtx.activeId ?? ''}
                  onChange={(e) => {
                    setAllYears(false)
                    setSelectedSchoolYearId(e.target.value || null)
                    setResult(null)
                    setError(null)
                  }}
                >
                  {syCtx.loading ? (
                    <option value="">Cargando ciclos...</option>
                  ) : (
                    syCtx.years.map((year) => (
                      <option key={year.id} value={year.id}>
                        {year.code} — {year.label}
                        {year.status === 'ACTIVE' ? ' (actual)' : ''}
                      </option>
                    ))
                  )}
                </select>
                <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={allYears}
                    onChange={(e) => {
                      setAllYears(e.target.checked)
                      setResult(null)
                      setError(null)
                    }}
                  />
                  Todos los ciclos
                </label>
              </div>
            </div>
          </section>
        )}

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
                Entiende palabras parecidas: «profesor», «docente», «profe», «atrasos», «tardanzas»,
                «retiro temprano», «salida anticipada», «marcas» o «fichadas».
              </li>
              <li>
                Por defecto consulta el ciclo lectivo seleccionado arriba; cambiá a «todos los ciclos» solo para
                búsquedas históricas.
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

        {result && <ResultView result={result} copied={copied} onCopy={() => void copyResult()} />}
      </main>
    </RoleGuard>
  )
}
