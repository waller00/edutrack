'use client'

import { useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import { formatGrade } from '@/lib/gradebook/grade-scale'

type GradeChange = {
  id: string
  assessmentTitle: string | null
  assessmentDate: string | null
  previousValueHundredths: number | null
  newValueHundredths: number | null
  previousIsAbsent: boolean | null
  newIsAbsent: boolean | null
  deleted: boolean
  origin: string
  changedByName: string | null
  changedAt: string
}

type PeriodChange = {
  id: string
  periodName: string
  previousValueHundredths: number | null
  newValueHundredths: number | null
  previousMeetingValueHundredths: number | null
  newMeetingValueHundredths: number | null
  previousConductValueHundredths: number | null
  newConductValueHundredths: number | null
  judgementChanged: boolean
  origin: string
  changedByName: string | null
  changedAt: string
}

type HistoryData = { grades: GradeChange[]; periods: PeriodChange[] }

function stamp(iso: string, name: string | null, origin: string): string {
  const when = new Intl.DateTimeFormat('es-UY', {
    timeZone: 'America/Montevideo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso))
  const who = name ?? 'Sin autor'
  return origin === 'ADMIN_CORRECTION' ? `${when} · ${who} (corrección de administración)` : `${when} · ${who}`
}

function gradeText(value: number | null, absent: boolean | null): string {
  if (absent) return 'no rindió'
  return value == null ? 'sin nota' : formatGrade(value)
}

/** "C 8 → 7", sólo de lo que cambió en esa fila. */
export function periodChangeText(change: PeriodChange): string {
  const parts: string[] = []
  const pairs = [
    ['C', change.previousValueHundredths, change.newValueHundredths],
    ['R', change.previousMeetingValueHundredths, change.newMeetingValueHundredths],
  ] as const
  for (const [label, before, after] of pairs) {
    if (before != null) parts.push(`${label} ${formatGrade(before)} → ${after == null ? 'sin nota' : formatGrade(after)}`)
  }
  if (change.previousConductValueHundredths != null) parts.push('conducta cambiada')
  if (change.judgementChanged) parts.push('informe cambiado')
  return parts.join(' · ')
}

/**
 * Historial de un alumno en la libreta (§6.2): quién cambió o borró qué nota, y quién corrigió
 * C, R, conducta o informe. Se carga al abrirlo.
 */
export default function StudentHistory({ gradeBookId, studentId }: { gradeBookId: string; studentId: string }) {
  const [history, setHistory] = useState<HistoryData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    if (history || loading) return
    setLoading(true)
    try {
      setHistory(await api<HistoryData>(`/gradebook/${gradeBookId}/history?studentId=${encodeURIComponent(studentId)}`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar el historial')
    } finally {
      setLoading(false)
    }
  }

  const empty = history && history.grades.length === 0 && history.periods.length === 0

  return (
    <details
      className="rounded border border-slate-200 bg-white px-3 py-2 text-sm"
      onToggle={(e) => {
        if ((e.target as HTMLDetailsElement).open) void load()
      }}
    >
      <summary className="inline-flex cursor-pointer items-center gap-1.5 font-medium text-slate-700">
        <History className="h-4 w-4" aria-hidden />
        Historial de cambios
      </summary>
      <div className="mt-2 space-y-2">
        {loading && (
          <p className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Cargando…
          </p>
        )}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {empty && <p className="text-slate-500">Sin correcciones: lo que se cargó no se cambió.</p>}
        {history && history.periods.length > 0 && (
          <ul className="space-y-1">
            {history.periods.map((change) => (
              <li key={change.id}>
                <span className="font-medium text-slate-800">{change.periodName}:</span> {periodChangeText(change)}
                <span className="block text-xs text-slate-500">{stamp(change.changedAt, change.changedByName, change.origin)}</span>
              </li>
            ))}
          </ul>
        )}
        {history && history.grades.length > 0 && (
          <ul className="space-y-1">
            {history.grades.map((change) => (
              <li key={change.id}>
                <span className="font-medium text-slate-800">
                  {change.assessmentTitle ?? 'Evaluación'}
                  {change.assessmentDate ? ` (${change.assessmentDate})` : ''}:
                </span>{' '}
                {change.deleted
                  ? `nota ${gradeText(change.previousValueHundredths, change.previousIsAbsent)} borrada`
                  : `${gradeText(change.previousValueHundredths, change.previousIsAbsent)} → ${gradeText(change.newValueHundredths, change.newIsAbsent)}`}
                <span className="block text-xs text-slate-500">{stamp(change.changedAt, change.changedByName, change.origin)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
