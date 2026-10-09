'use client'

import { useState } from 'react'
import { BookOpen, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import { withSchoolYear } from '@/lib/admin/school-year-query'
import SettingsDetails from '@/components/admin/settings/SettingsDetails'
import ScopedCycleNote from './ScopedCycleNote'

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
export function provisionResult(summary: ProvisionSummary): {
  done: string[]
  warnings: string[]
} {
  const done: string[] = []
  done.push(
    summary.created > 0
      ? `Se ${summary.created === 1 ? 'creó' : 'crearon'} ${plural(summary.created, 'libreta nueva', 'libretas nuevas')}.`
      : 'No faltaba ninguna libreta.',
  )
  if (summary.updated > 0)
    done.push(
      `${plural(summary.updated, 'libreta cambió', 'libretas cambiaron')} de titular.`,
    )
  if (summary.unchanged > 0)
    done.push(
      `${plural(summary.unchanged, 'ya estaba al día', 'ya estaban al día')}.`,
    )

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
export default function GradeBooksTab({
  onError,
}: {
  onError: (message: string) => void
}) {
  const schoolYear = useOptionalAdminSchoolYear()
  const query = schoolYear?.schoolYearScopedQuery ?? ''
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState<ProvisionSummary | null>(null)
  const [summaryQuery, setSummaryQuery] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setSummary(null)
    try {
      const res = await api<{ data: ProvisionSummary }>(
        withSchoolYear('/admin/academic-config/gradebooks/provision', query),
        {
          method: 'POST',
        },
      )
      setSummary(res.data)
      setSummaryQuery(query)
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : 'No se pudieron generar las libretas',
      )
    } finally {
      setRunning(false)
    }
  }

  const result =
    summary && summaryQuery === query ? provisionResult(summary) : null

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
        <header className="flex items-start gap-3">
          <BookOpen
            className="mt-1 h-5 w-5 shrink-0 text-emerald-600"
            aria-hidden
          />
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Generación de libretas
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Se actualizan automáticamente cada hora. Si cambiaste el horario,
              podés actualizarlas ahora.
            </p>
          </div>
        </header>
        <ScopedCycleNote />
        <button
          type="button"
          disabled={running || schoolYear?.loading}
          onClick={() => void run()}
          className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {running && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Generar libretas ahora
        </button>
      </section>

      {result && (
        <div
          role="status"
          className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
        >
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
      <SettingsDetails title="Cómo se generan las libretas">
        <p className="text-sm text-slate-600">
          Se crea una libreta por asignatura y grupo a partir de las clases del
          horario. Queda a nombre del docente de la clase más reciente.
        </p>
        <p className="text-sm text-slate-600">
          La generación conserva el contenido existente y no duplica libretas.
          Las clases sin asignatura o curso y los cursos que no se ofertan en el
          ciclo se omiten.
        </p>
      </SettingsDetails>
    </div>
  )
}
