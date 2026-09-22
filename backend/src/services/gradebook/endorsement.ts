/**
 * Visado de la libreta (RF-080 a RF-083).
 *
 * El historial es **append-only**: el estado vigente de cada sección es su última fila. Una
 * observación posterior a un visado no lo borra, lo sucede. Todo acá es lógica pura.
 */

export type Section = 'GRADES' | 'CLOSURE' | 'JUDGEMENTS' | 'ALL'
export type Status = 'PENDING' | 'OBSERVED' | 'CORRECTED' | 'ENDORSED'

/** Secciones que deben estar conformes para poder visar el período (RF-082). */
export const MANDATORY_SECTIONS: readonly Section[] = ['GRADES', 'CLOSURE', 'JUDGEMENTS']

export const SECTION_LABELS: Record<Section, string> = {
  GRADES: 'Calificaciones',
  CLOSURE: 'Cierre del período',
  JUDGEMENTS: 'Juicios conceptuales',
  ALL: 'Visado del período',
}

export const STATUS_LABELS: Record<Status, string> = {
  PENDING: 'Pendiente',
  OBSERVED: 'Observado',
  CORRECTED: 'Corregido',
  ENDORSED: 'Visado',
}

export class EndorsementError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export type EndorsementRow = {
  section: Section
  status: Status
  occurredAt: Date
}

/**
 * Estado vigente por sección: la fila más reciente de cada una.
 *
 * Las secciones sin ninguna fila no aparecen; el llamador las trata como `PENDING`, que es el
 * estado inicial implícito y no hace falta materializar.
 */
export function currentStates<T extends EndorsementRow>(rows: readonly T[]): Map<Section, T> {
  const latest = new Map<Section, T>()
  for (const row of rows) {
    const current = latest.get(row.section)
    if (!current || row.occurredAt.getTime() >= current.occurredAt.getTime()) {
      latest.set(row.section, row)
    }
  }
  return latest
}

export function statusOf(states: ReadonlyMap<Section, EndorsementRow>, section: Section): Status {
  return states.get(section)?.status ?? 'PENDING'
}

export type ActorScopes = {
  /** `gradebook.review`: observar y dar por corregido (adscripción, dirección). */
  canReview: boolean
  /** `gradebook.endorse`: visar (sólo dirección). */
  canEndorse: boolean
  /** `gradebook.inspect`: inspección. */
  canInspect: boolean
}

/**
 * ¿Puede quien pide registrar esta transición?
 *
 * La regla que sostiene la nota funcional del pliego —*"los visados de Dirección no deberán ser
 * modificables por Inspección"*— es la primera: **sobre una sección ya visada sólo puede escribir
 * quien tiene `gradebook.endorse`**. Como el historial es append-only y el estado vigente es la
 * última fila, sin esto una observación de Inspección (o de Adscripción) revertiría de hecho el
 * visado de Dirección sin tener la atribución para hacerlo.
 */
export function assertCanTransition(params: {
  currentStatus: Status
  nextStatus: Status
  scopes: ActorScopes
}): void {
  const { currentStatus, nextStatus, scopes } = params

  if (currentStatus === 'ENDORSED' && !scopes.canEndorse) {
    throw new EndorsementError(
      403,
      'ENDORSED_BY_DIRECTION',
      'La sección ya fue visada por Dirección: sólo Dirección puede modificar ese estado.',
    )
  }

  if (nextStatus === 'ENDORSED' && !scopes.canEndorse) {
    throw new EndorsementError(403, 'CANNOT_ENDORSE', 'Sólo Dirección puede visar una libreta.')
  }

  if (nextStatus === 'OBSERVED' && !scopes.canReview && !scopes.canInspect) {
    throw new EndorsementError(403, 'CANNOT_OBSERVE', 'No tenés atribución para observar esta libreta.')
  }

  if (nextStatus === 'CORRECTED' && !scopes.canReview && !scopes.canEndorse) {
    throw new EndorsementError(
      403,
      'CANNOT_CORRECT',
      'Marcar una observación como corregida corresponde a adscripción o dirección.',
    )
  }

  if (nextStatus === 'PENDING') {
    throw new EndorsementError(400, 'INVALID_TRANSITION', 'No se puede volver a "pendiente" a mano.')
  }
}

/**
 * ¿Están conformes las secciones obligatorias para el visado final? (RF-082)
 *
 * Conforme significa **no observado**: una sección sin revisar (`PENDING`) no bloquea —puede que
 * no hubiera nada que objetar—, pero una observación viva sí, hasta que se marque corregida.
 */
export function blockingSections(states: ReadonlyMap<Section, EndorsementRow>): Section[] {
  return MANDATORY_SECTIONS.filter((section) => statusOf(states, section) === 'OBSERVED')
}

export function canFinalize(states: ReadonlyMap<Section, EndorsementRow>): boolean {
  return blockingSections(states).length === 0
}

/** Antigüedad en días de un pendiente, para la grilla de dirección (§5.9). */
export function pendingAgeDays(since: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000))
}

/**
 * Un período abierto no se visa: visar significa dar por buena una calificación cerrada, y el
 * docente todavía puede cambiarla.
 */
export function assertPeriodClosed(periodStatus: 'OPEN' | 'CLOSED' | 'REOPENED'): void {
  if (periodStatus !== 'CLOSED') {
    throw new EndorsementError(
      409,
      'PERIOD_NOT_CLOSED',
      'El período no está cerrado: no hay nada firme para visar todavía.',
    )
  }
}
