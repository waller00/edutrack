'use client'

import { useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'

export type ProvisionSummary = {
  created: number
  updated: number
  unchanged: number
  skippedEvents: number
  skippedNotOffered: number
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

/** Qué pasó al generar, en oraciones; lo que conviene revisar va aparte. */
export function provisionResult(summary: ProvisionSummary): { done: string[]; warnings: string[] } {
  const done: string[] = []
  done.push(
    summary.created > 0
      ? `Se ${summary.created === 1 ? 'creó' : 'crearon'} ${plural(summary.created, 'libreta nueva', 'libretas nuevas')}.`
      : 'No faltaba ninguna libreta.',
  )
  if (summary.updated > 0) done.push(`${plural(summary.updated, 'libreta cambió', 'libretas cambiaron')} de titular.`)
  if (summary.unchanged > 0) done.push(`${plural(summary.unchanged, 'ya estaba al día', 'ya estaban al día')}.`)

  const warnings: string[] = []
  if (summary.skippedEvents > 0) {
    warnings.push(
      `${plural(summary.skippedEvents, 'clase del horario no tiene', 'clases del horario no tienen')} asignatura o curso y no ` +
        'genera libreta: revisalas en Eventos.',
    )
  }
  if (summary.skippedNotOffered > 0) {
    warnings.push(
      `${plural(summary.skippedNotOffered, 'grupo es', 'grupos son')} de cursos que no se ofertan este ciclo y se omitieron.`,
    )
  }
  return { done, warnings }
}

/**
 * Generación de libretas (RF-020). Se generan solas cada hora a partir de los eventos de clase:
 * esto es para no esperar después de cargar o cambiar el horario.
 */
export default function GradeBooksTab({ onError }: { onError: (message: string) => void }) {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<ProvisionSummary | null>(null)

  async function run() {
    setRunning(true)
    setSummary(null)
    try {
      const res = await api<{ data: ProvisionSummary }>(withSchoolYear('/admin/academic-config/gradebooks/provision', query), {
        method: 'POST',
      })
      setSummary(res.data)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'No se pudieron generar las libretas')
    } finally {
      setRunning(false)
    }
  }

  const result = summary ? provisionResult(summary) : null

  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
        <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" aria-hidden />
        <span>
          Las libretas se arman solas a partir de los eventos de clase del horario: una por asignatura y grupo, a
          nombre del docente de la clase más reciente. Se actualizan cada hora; si acabás de cargar o cambiar el
          horario, generalas ahora. No se borra ni se duplica nada.
        </span>
      </p>

      <button
        type="button"
        disabled={running}
        onClick={() => void run()}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        Generar libretas ahora
      </button>

      {result && (
        <div role="status" className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {result.done.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {result.warnings.map((line) => (
            <p key={line} className="text-amber-800">
              <span aria-hidden>▲ </span>
              {line}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
