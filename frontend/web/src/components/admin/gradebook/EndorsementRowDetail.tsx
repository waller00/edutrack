'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import EndorsementBadge from '@/components/gradebook/EndorsementBadge'
import GradeBookAccessLog from './GradeBookAccessLog'
import {
  canActOnSection,
  ENDORSEMENT_SECTION_LABELS,
  ENDORSEMENT_STATUS_LABELS,
  formatEndorsementDate,
  REVIEW_SECTIONS,
  sectionState,
  type EndorsementAbilities,
  type EndorsementHistoryEntry,
  type EndorsementRow,
  type EndorsementSection,
  type EndorsementSectionState,
} from '@/lib/gradebook/endorsements'

type HistoryResponse = {
  history: Array<Omit<EndorsementHistoryEntry, 'actorName'> & { actor?: { name: string | null } | null }>
}

const SMALL_BUTTON =
  'rounded border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50'
const PRIMARY_BUTTON =
  'rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50'

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function SectionLine({
  state,
  abilities,
  busy,
  onObserve,
  onCorrect,
}: {
  state: EndorsementSectionState
  abilities: EndorsementAbilities
  busy: boolean
  onObserve: () => void
  onCorrect: () => void
}) {
  const label = ENDORSEMENT_SECTION_LABELS[state.section]
  const canAct = canActOnSection(state.status, abilities)
  return (
    <li className="flex flex-wrap items-start gap-2 text-sm">
      <span className="w-28 shrink-0 font-medium text-gray-700">{label}</span>
      <EndorsementBadge status={state.status} />
      {state.observations && <span className="min-w-0 flex-1 text-gray-700">{state.observations}</span>}
      <span className="ml-auto flex gap-1">
        {abilities.canObserve && canAct && (
          <button type="button" disabled={busy} onClick={onObserve} className={SMALL_BUTTON} aria-label={`Observar ${label}`}>
            Observar
          </button>
        )}
        {state.status === 'OBSERVED' && abilities.canCorrect && (
          <button type="button" disabled={busy} onClick={onCorrect} className={SMALL_BUTTON} aria-label={`Dar por corregido: ${label}`}>
            Dar por corregido
          </button>
        )}
      </span>
    </li>
  )
}

function HistoryList({ history }: { history: EndorsementHistoryEntry[] | null }) {
  if (history === null) {
    return (
      <p className="flex items-center gap-2 text-xs text-gray-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Cargando historial…
      </p>
    )
  }
  if (history.length === 0) return <p className="text-xs text-gray-500">Sin movimientos todavía.</p>
  return (
    <ol className="space-y-1 text-xs text-gray-600">
      {[...history].reverse().map((entry, index) => (
        <li key={`${entry.occurredAt}-${index}`}>
          {formatEndorsementDate(entry.occurredAt)} · {ENDORSEMENT_SECTION_LABELS[entry.section]} ·{' '}
          {ENDORSEMENT_STATUS_LABELS[entry.status]}
          {entry.actorName && ` · ${entry.actorName}`}
          {entry.observations && <span className="block pl-3 text-gray-700">{entry.observations}</span>}
        </li>
      ))}
    </ol>
  )
}

/**
 * Detalle de un período en la grilla de visado: cada sección con su estado y qué se puede hacer,
 * la reapertura y el historial completo.
 *
 * Es lo que cierra el circuito de corrección: observar → reabrir → el docente corrige y vuelve a
 * cerrar → dar por corregido → visar. Sin "Dar por corregido" un período observado no se podía
 * visar nunca, y sin "Reabrir" el docente no podía tocar un período cerrado.
 */
export default function EndorsementRowDetail({
  row,
  abilities,
  onChanged,
}: {
  row: EndorsementRow
  abilities: EndorsementAbilities
  /** Se llama después de cada acción, con el texto a mostrar; la grilla recarga. */
  onChanged: (message: string) => void | Promise<void>
}) {
  const [history, setHistory] = useState<EndorsementHistoryEntry[] | null>(null)
  const [observing, setObserving] = useState<EndorsementSection | null>(null)
  const [observation, setObservation] = useState('')
  const [reopening, setReopening] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    try {
      const res = await api<HistoryResponse>(`/admin/gradebook/endorsements/${row.gradeBookPeriodId}`)
      setHistory(res.history.map(({ actor, ...entry }) => ({ ...entry, actorName: actor?.name ?? null })))
    } catch {
      setHistory([])
    }
  }, [row.gradeBookPeriodId])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  async function run(action: () => Promise<unknown>, done: string, failed: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setObserving(null)
      setObservation('')
      setReopening(false)
      setReason('')
      await onChanged(done)
      await loadHistory()
    } catch (err) {
      setError(errorText(err, failed))
    } finally {
      setBusy(false)
    }
  }

  function register(section: EndorsementSection, status: 'OBSERVED' | 'CORRECTED', observations?: string) {
    return api('/admin/gradebook/endorsements', {
      method: 'POST',
      body: JSON.stringify({
        gradeBookPeriodId: row.gradeBookPeriodId,
        section,
        status,
        ...(observations ? { observations } : {}),
      }),
    })
  }

  function saveObservation() {
    if (!observing) return
    const text = observation.trim()
    if (!text) {
      setError('Escribí qué hay que corregir.')
      return
    }
    const label = ENDORSEMENT_SECTION_LABELS[observing]
    void run(() => register(observing, 'OBSERVED', text), `Se observó ${label}. El docente recibió el aviso.`, 'No se pudo registrar la observación')
  }

  function markCorrected(section: EndorsementSection) {
    const label = ENDORSEMENT_SECTION_LABELS[section]
    void run(() => register(section, 'CORRECTED'), `${label}: se dio por corregido.`, 'No se pudo marcar como corregido')
  }

  function reopen() {
    void run(
      () =>
        api(`/gradebook/${row.gradeBookId}/periods/${row.period.id}/reopen`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      `Se reabrió ${row.period.name} de ${row.subject.name}. El docente recibió el aviso para corregir.`,
      'No se pudo reabrir el período',
    )
  }

  return (
    <div className="space-y-3 bg-slate-50 px-4 py-3">
      {error && (
        <p role="alert" className="rounded bg-red-50 px-2 py-1 text-sm text-red-800">
          {error}
        </p>
      )}

      <ul className="space-y-2">
        {REVIEW_SECTIONS.map((section) => (
          <SectionLine
            key={section}
            state={sectionState(row, section)}
            abilities={abilities}
            busy={busy}
            onObserve={() => {
              setObserving(section)
              setObservation('')
            }}
            onCorrect={() => markCorrected(section)}
          />
        ))}
      </ul>

      {observing && (
        <div className="space-y-2 rounded border border-amber-200 bg-white p-2">
          <label className="block text-xs text-gray-600" htmlFor={`obs-${row.gradeBookPeriodId}`}>
            Qué hay que corregir en {ENDORSEMENT_SECTION_LABELS[observing]}
          </label>
          <textarea
            id={`obs-${row.gradeBookPeriodId}`}
            className="input-field min-h-[64px] w-full"
            maxLength={2000}
            value={observation}
            onChange={(e) => setObservation(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={saveObservation} className={PRIMARY_BUTTON}>
              Guardar observación
            </button>
            <button type="button" onClick={() => setObserving(null)} className={SMALL_BUTTON}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {abilities.canReopen && row.periodStatus === 'CLOSED' && (
        <div className="space-y-2 border-t border-gray-200 pt-2">
          {reopening ? (
            <>
              <label className="block text-xs text-gray-600" htmlFor={`reopen-${row.gradeBookPeriodId}`}>
                Motivo de la reapertura (lo ve el docente)
              </label>
              <textarea
                id={`reopen-${row.gradeBookPeriodId}`}
                className="input-field min-h-[56px] w-full"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-xs text-gray-500">
                El docente vuelve a poder corregir conducta, rendimiento, juicios e informe del grupo, y recibe un aviso. Si es una entrega, se reabren
                también sus tramos. Las notas de evaluaciones fuera del plazo de edición las corrige administración.
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={busy || reason.trim().length < 3} onClick={reopen} className={PRIMARY_BUTTON}>
                  Reabrir
                </button>
                <button type="button" onClick={() => setReopening(false)} className={SMALL_BUTTON}>
                  Cancelar
                </button>
              </div>
            </>
          ) : (
            <button type="button" onClick={() => setReopening(true)} className={SMALL_BUTTON}>
              Reabrir período para corregir
            </button>
          )}
        </div>
      )}

      <div className="border-t border-gray-200 pt-2">
        <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">Historial</h4>
        <HistoryList history={history} />
      </div>

      <div className="border-t border-gray-200 pt-2">
        <GradeBookAccessLog gradeBookId={row.gradeBookId} />
      </div>
    </div>
  )
}
