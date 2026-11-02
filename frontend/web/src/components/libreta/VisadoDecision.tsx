'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { api } from '@/lib/api/client'
import GradeBookAccessLog from '@/components/admin/gradebook/GradeBookAccessLog'
import {
  canActOnSection,
  ENDORSEMENT_SECTION_LABELS,
  ENDORSEMENT_STATUS_LABELS,
  formatEndorsementDate,
  observedLabels,
  REVIEW_SECTIONS,
  reviewState,
  sectionState,
  type EndorsementAbilities,
  type EndorsementHistoryEntry,
  type EndorsementRow,
  type EndorsementSection,
  type EndorsementSectionState,
} from '@/lib/gradebook/endorsements'

export type DecisionRow = EndorsementRow & { reopenReason: string | null; history: EndorsementHistoryEntry[] }

const SECONDARY_BUTTON =
  'inline-flex items-center gap-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50'
const PRIMARY_BUTTON =
  'inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50'

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

function HistoryList({ history }: { history: readonly EndorsementHistoryEntry[] }) {
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

/** Qué falta para poder decidir, cuando hoy no se puede visar. */
function waitingText(row: DecisionRow): string | null {
  const state = reviewState(row)
  if (state.kind === 'REOPENED') {
    const reason = row.reopenReason ? `: ${row.reopenReason}` : ''
    return `Está reabierta para que el docente corrija${reason}. Cuando la vuelva a cerrar, se revisa de nuevo.`
  }
  if (state.kind === 'RECLOSED') return 'El docente la volvió a cerrar: mirá si corrigió lo observado y, si está bien, dalo por corregido.'
  if (state.kind === 'OBSERVED') return 'Para visarla, lo observado tiene que quedar corregido.'
  return null
}

/** El estado de la reunión en palabras, con la fecha del visado si lo hay. */
/**
 * El encabezado de la decisión. En qué etapa está la reunión ya lo dice la línea de etapas de
 * arriba (las mismas que ve el docente): acá no se repite.
 */
function DecisionStatus({ row }: { row: DecisionRow }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <h3 id="visado-decision" className="text-sm font-semibold text-gray-900">
        2. Tu decisión
      </h3>
      {row.closedLate && <span className="text-xs text-amber-800">▲ Cerrada fuera de plazo</span>}
    </div>
  )
}

/** Lo observado que sigue sin corregir, cada cosa con su "Ya está corregido". */
function LiveObservations({
  items,
  canCorrect,
  busy,
  onCorrect,
}: {
  items: readonly EndorsementSectionState[]
  canCorrect: boolean
  busy: boolean
  onCorrect: (section: EndorsementSection) => void
}) {
  if (items.length === 0) return null
  return (
    <ul className="space-y-2" aria-label="Observaciones sin corregir">
      {items.map((item) => {
        const label = ENDORSEMENT_SECTION_LABELS[item.section]
        return (
          <li
            key={item.section}
            className="flex flex-wrap items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{label}</span>
              {item.observations && <span className="block whitespace-pre-wrap">{item.observations}</span>}
            </span>
            {canCorrect && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onCorrect(item.section)}
                aria-label={`Ya está corregido: ${label}`}
                className={SECONDARY_BUTTON}
              >
                Ya está corregido
              </button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Sobre qué parte es la observación y qué hay que corregir: lo ve el docente. */
function ObservationForm({
  sections,
  busy,
  onSubmit,
  onCancel,
  onInvalid,
}: {
  sections: readonly EndorsementSection[]
  busy: boolean
  onSubmit: (section: EndorsementSection, text: string) => void
  onCancel: () => void
  onInvalid: (message: string) => void
}) {
  const [section, setSection] = useState<EndorsementSection | ''>('')
  const [text, setText] = useState('')

  function submit() {
    if (!section) return onInvalid('Elegí sobre qué es la observación.')
    if (!text.trim()) return onInvalid('Escribí qué hay que corregir.')
    onSubmit(section, text.trim())
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-gray-600">¿Sobre qué?</span>
        <select className="select-field" value={section} onChange={(e) => setSection(e.target.value as EndorsementSection | '')}>
          <option value="">Elegí una parte</option>
          {sections.map((s) => (
            <option key={s} value={s}>
              {ENDORSEMENT_SECTION_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-gray-600">Qué hay que corregir (lo ve el docente)</span>
        <textarea
          className="input-field min-h-[64px] w-full"
          maxLength={2000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={busy} onClick={submit} className={PRIMARY_BUTTON}>
          Guardar observación
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Reabrir para que el docente corrija: con motivo, que le llega en el aviso. */
function ReopenForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState('')
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-gray-600">Motivo de la reapertura (lo ve el docente)</span>
        <textarea
          className="input-field min-h-[56px] w-full"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="text-xs text-gray-500">
        El docente vuelve a poder corregir conducta, rendimiento, juicios e informe del grupo, y recibe un aviso. Si es
        una entrega, se reabren también sus tramos. Las notas de evaluaciones fuera del plazo de edición las corrige
        administración.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || reason.trim().length < 3}
          onClick={() => onSubmit(reason.trim())}
          className={PRIMARY_BUTTON}
        >
          Reabrir
        </button>
        <button type="button" onClick={onCancel} className={SECONDARY_BUTTON}>
          Cancelar
        </button>
      </div>
    </div>
  )
}

type Form = 'observe' | 'reopen' | null

/**
 * "Tu decisión" en la revisión de una reunión: después de mirar lo que cerró el docente, Dirección
 * la visa, o Adscripción o Dirección le hacen una observación. Una observación viva se da por
 * corregida acá mismo, y Administración puede reabrir el período para que el docente corrija.
 *
 * Cada botón aparece sólo para quien tiene la atribución (las reglas son las de `assertCanTransition`
 * en el backend, que las exige igual). Todo pide el período cerrado. El historial queda abajo,
 * plegado: el estado vigente de cada parte es su último movimiento, y una observación posterior a
 * un visado no lo borra, lo sucede.
 */
export default function VisadoDecision({
  row,
  abilities,
  onChanged,
}: {
  row: DecisionRow
  abilities: EndorsementAbilities
  /** Después de cada acción, con el texto a mostrar: la sección recarga. */
  onChanged: (message: string) => void | Promise<void>
}) {
  const [form, setForm] = useState<Form>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const closed = row.periodStatus === 'CLOSED'
  const observable = REVIEW_SECTIONS.filter((s) => canActOnSection(sectionState(row, s).status, abilities))
  const live = REVIEW_SECTIONS.map((s) => sectionState(row, s)).filter((s) => s.status === 'OBSERVED')
  const waiting = waitingText(row)
  const canEndorse = closed && abilities.canEndorse && row.overallStatus !== 'ENDORSED'
  const canObserve = closed && abilities.canObserve && observable.length > 0
  const canReopen = closed && abilities.canReopen

  async function run(action: () => Promise<unknown>, done: string, failed: string) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setForm(null)
      await onChanged(done)
    } catch (err) {
      setError(errorText(err, failed))
    } finally {
      setBusy(false)
    }
  }

  function register(section: EndorsementSection, status: 'OBSERVED' | 'CORRECTED' | 'ENDORSED', observations?: string) {
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

  function endorse() {
    void run(() => register('ALL', 'ENDORSED'), `Se visó ${row.period.name}. El docente recibió el aviso.`, 'No se pudo visar')
  }

  function observe(section: EndorsementSection, text: string) {
    void run(
      () => register(section, 'OBSERVED', text),
      `Se observó ${ENDORSEMENT_SECTION_LABELS[section]}. El docente recibió el aviso.`,
      'No se pudo registrar la observación',
    )
  }

  function markCorrected(section: EndorsementSection) {
    void run(
      () => register(section, 'CORRECTED'),
      `${ENDORSEMENT_SECTION_LABELS[section]}: se dio por corregido.`,
      'No se pudo marcar como corregido',
    )
  }

  function reopen(reason: string) {
    void run(
      () =>
        api(`/gradebook/${row.gradeBookId}/periods/${row.period.id}/reopen`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        }),
      `Se reabrió ${row.period.name}. El docente recibió el aviso para corregir.`,
      'No se pudo reabrir el período',
    )
  }

  return (
    <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4" aria-labelledby="visado-decision" data-tour="visado.decision">
      <DecisionStatus row={row} />

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <LiveObservations items={live} canCorrect={closed && abilities.canCorrect} busy={busy} onCorrect={markCorrected} />
      {waiting && <p className="text-sm text-gray-600">{waiting}</p>}

      <div className="flex flex-wrap items-center gap-2 empty:hidden">
        {canEndorse && (
          <button
            type="button"
            disabled={busy || !row.canFinalize}
            title={row.canFinalize ? undefined : `Falta corregir: ${observedLabels(row)}`}
            onClick={endorse}
            className={PRIMARY_BUTTON}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            Visar {row.period.name}
          </button>
        )}
        {canObserve && form !== 'observe' && (
          <button type="button" disabled={busy} onClick={() => setForm('observe')} className={SECONDARY_BUTTON}>
            <AlertTriangle className="h-4 w-4" aria-hidden />
            Hacer una observación
          </button>
        )}
        {canReopen && form !== 'reopen' && (
          <button type="button" disabled={busy} onClick={() => setForm('reopen')} className={SECONDARY_BUTTON}>
            Reabrir para que corrija
          </button>
        )}
      </div>

      {form === 'observe' && (
        <ObservationForm
          sections={observable}
          busy={busy}
          onSubmit={observe}
          onCancel={() => setForm(null)}
          onInvalid={setError}
        />
      )}
      {form === 'reopen' && <ReopenForm busy={busy} onSubmit={reopen} onCancel={() => setForm(null)} />}

      <div className="space-y-2 border-t border-gray-100 pt-3">
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-gray-500">
            Historial del visado
          </summary>
          <div className="mt-1">
            <HistoryList history={row.history} />
          </div>
        </details>
        <GradeBookAccessLog gradeBookId={row.gradeBookId} />
      </div>
    </section>
  )
}
