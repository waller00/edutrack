import { formatEndorsementDate, reviewState, sectionState, type EndorsementRow } from './endorsements'

/**
 * En qué está una reunión de una libreta, dicho igual para el docente y para quien la revisa.
 *
 * Son cuatro etapas: Cargar → Cerrar → Revisión → Visada. Antes el docente veía
 * "abierta/cerrada" y Dirección "Para revisar/Observada/Visada", y nadie veía el recorrido entero:
 * el docente no sabía que su entrega estaba en revisión ni que se la habían observado.
 *
 * Del lado de quien revisa, las frases son las de `reviewState`, las mismas de la lista de Control.
 */

export type MeetingStageId = 'LOAD' | 'CLOSE' | 'REVIEW' | 'ENDORSED'
export type MeetingAudience = 'teacher' | 'reviewer'

export const MEETING_STAGES: readonly { id: MeetingStageId; label: string }[] = [
  { id: 'LOAD', label: 'Cargar' },
  { id: 'CLOSE', label: 'Cerrar' },
  { id: 'REVIEW', label: 'Revisión' },
  { id: 'ENDORSED', label: 'Visada' },
]

type Tone = 'neutral' | 'ready' | 'warn' | 'info' | 'done'

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'border-gray-200 bg-gray-50 text-gray-700',
  ready: 'border-teal-200 bg-teal-50 text-teal-800',
  warn: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  done: 'border-emerald-200 bg-emerald-50 text-emerald-800',
}

export type MeetingStage = {
  stage: MeetingStageId
  /** Palabra corta para la fila de la reunión, con su símbolo: nunca sólo color (RNF 7.2). */
  label: string
  symbol: string
  className: string
  /** Qué pasa y qué sigue, en una frase. */
  hint: string
}

export type MeetingStageInput = {
  periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED'
  /** Cuántas cosas faltan para cerrar; `null` si no se sabe (no se pidió la planilla). */
  missing: number | null
  closedAt?: string | null
  reopenReason?: string | null
  /** La fila de visado de esa reunión, si la hay. */
  endorsement?: Pick<
    EndorsementRow,
    'overallStatus' | 'periodStatus' | 'blockingSections' | 'reclosedAfterObservation' | 'sections'
  > | null
}

function make(stage: MeetingStageId, label: string, symbol: string, tone: Tone, hint: string): MeetingStage {
  return { stage, label, symbol, className: TONE_CLASSES[tone], hint }
}

/** Lo que lee quien revisa: la frase de la lista de Control, con la fecha del visado si la hay. */
function reviewerHint(input: MeetingStageInput, fallback: string, endorsedAt: string): string {
  if (!input.endorsement) return fallback
  const state = reviewState({ ...input.endorsement, periodStatus: input.periodStatus })
  if (state.kind === 'ENDORSED' && endorsedAt) return `Visada el ${endorsedAt}`
  return state.label
}

export function meetingStage(input: MeetingStageInput, audience: MeetingAudience): MeetingStage {
  const teacher = audience === 'teacher'
  const { periodStatus, missing, endorsement } = input
  const endorsedAt = endorsement ? formatEndorsementDate(sectionState(endorsement, 'ALL').occurredAt) : ''
  const forReviewer = (fallback: string) => reviewerHint(input, fallback, endorsedAt)

  // Reabierta va antes que visada: si se reabrió una visada, lo que vale es que se está corrigiendo.
  if (periodStatus === 'REOPENED') {
    const reason = input.reopenReason?.trim()
    return make(
      missing === 0 ? 'CLOSE' : 'LOAD',
      'Reabierta',
      '↻',
      'warn',
      teacher
        ? `Reabierta para corregir${reason ? `: ${reason}` : ''}. Cuando termines, volvé a cerrarla.`
        : forReviewer('Reabierta: el docente está corrigiendo'),
    )
  }

  if (endorsement?.overallStatus === 'ENDORSED') {
    return make('ENDORSED', 'Visada', '✓', 'done', endorsedAt ? `Visada el ${endorsedAt}` : 'Visada')
  }

  if (periodStatus === 'CLOSED') {
    const observed = (endorsement?.blockingSections.length ?? 0) > 0
    if (observed && endorsement?.reclosedAfterObservation) {
      return make(
        'REVIEW',
        'En revisión',
        '↻',
        'info',
        teacher ? 'La volviste a cerrar: la revisan de nuevo.' : forReviewer('Volvió a cerrarse: revisá la corrección'),
      )
    }
    if (observed) {
      return make(
        'REVIEW',
        'Observada',
        '▲',
        'warn',
        teacher
          ? 'Te hicieron observaciones. Si hay que corregir algo, administración te la reabre.'
          : forReviewer('Observada: espera al docente'),
      )
    }
    const closedAt = formatEndorsementDate(input.closedAt ?? null)
    return make(
      'REVIEW',
      'En revisión',
      '…',
      'info',
      teacher ? `Cerrada${closedAt ? ` el ${closedAt}` : ''}: la revisa Dirección.` : forReviewer('Para revisar'),
    )
  }

  if (missing === 0) {
    return make(
      'CLOSE',
      'Lista para cerrar',
      '●',
      'ready',
      teacher ? 'Todo cargado: falta cerrarla.' : 'Abierta: el docente no la cerró',
    )
  }
  return make(
    'LOAD',
    'Abierta',
    '○',
    'neutral',
    teacher
      ? missing == null
        ? 'Abierta: cargá la C, la R y los juicios, y después cerrala.'
        : 'Falta cargar lo de abajo para poder cerrarla.'
      : 'Abierta: el docente está cargando',
  )
}
