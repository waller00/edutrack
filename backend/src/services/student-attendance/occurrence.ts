import { expandRecurringEvent } from '../../events/events-query.js'
import { effectiveWindowIncludesYmd, ymdInUruguay } from '../events/event-versioning.js'
import { occurrenceYmdOf, resolveOccurrenceInstant, shiftYmd } from '../events/occurrence-instant.js'

export type OccurrenceErrorCode =
  | 'NOT_A_CLASS'
  | 'EVENT_CANCELLED'
  | 'NO_OCCURRENCE'
  | 'OCCURRENCE_SUSPENDED'
  | 'OUT_OF_EFFECTIVE_WINDOW'
  | 'IS_EXCEPTION_CHILD'

export type OccurrenceOk = { ok: true; startAt: Date; endAt: Date; code: null }
export type OccurrenceFailure = { ok: false; startAt: null; endAt: null; code: OccurrenceErrorCode }
/**
 * El proyecto compila con `strict: false`, así que el estrechamiento por discriminante no es
 * fiable: ambas variantes declaran todos los campos y se usa `isOccurrenceOk` para distinguir.
 */
export type OccurrenceResult = OccurrenceOk | OccurrenceFailure

export function isOccurrenceOk(result: OccurrenceResult): result is OccurrenceOk {
  return result.ok === true
}

function ok(startAt: Date, endAt: Date): OccurrenceOk {
  return { ok: true, startAt, endAt, code: null }
}

function fail(code: OccurrenceErrorCode): OccurrenceFailure {
  return { ok: false, startAt: null, endAt: null, code }
}

type EventLike = {
  id: string
  type?: string | null
  status?: string | null
  parentEventId?: string | null
  isRecurring?: boolean | null
  recurrenceType?: string | null
  startDate?: Date | string | null
  startTime?: Date | string | null
  endTime?: Date | string | null
  effectiveFrom?: Date | string | null
  effectiveUntil?: Date | string | null
  childEvents?: unknown[]
}

/** `revisionOf` agrupa todas las versiones de una misma clase; es la clave de reportes. */
export function eventFamilyIdOf(event: { id: string; revisionOf?: string | null }): string {
  return event.revisionOf ?? event.id
}

function classifyNonRecurring(event: EventLike, ymd: string): OccurrenceResult {
  const startAt = new Date((event.startTime ?? event.startDate) as Date)
  if (ymdInUruguay(startAt) !== ymd) return fail('NO_OCCURRENCE')
  return ok(startAt, event.endTime ? new Date(event.endTime as Date) : startAt)
}

/**
 * Distingue *suspendida* de *inexistente* expandiendo dos veces: la serie limpia dice si el
 * día pertenece al patrón, y la serie con excepciones dice si sigue vigente. Sin esto una
 * suspensión puntual sería indistinguible de un día que nunca tuvo clase, porque
 * `applyRecurrenceExceptions` descarta por completo las ocurrencias con hijo CANCELLED.
 */
function classifyRecurring(event: EventLike, ymd: string): OccurrenceResult {
  const bare = resolveOccurrenceInstant(event, ymd)
  if (!bare) return fail('NO_OCCURRENCE')

  const withExceptions = expandRecurringEvent(event, shiftYmd(ymd, -1), shiftYmd(ymd, 1)) as any[]
  const live = withExceptions.find((occ) => occurrenceYmdOf(new Date(occ.startDate)) === ymd)
  if (!live) return fail('OCCURRENCE_SUSPENDED')

  // Un hijo reprogramado (no cancelado) ya trae el horario corregido.
  return ok(new Date(live.startTime ?? live.startDate), new Date(live.endTime ?? live.startDate))
}

/**
 * Valida que `ymd` sea un día de clase real de este evento y devuelve sus instantes.
 * Puro: no toca la base ni el reloj. Los días no laborables se chequean aparte.
 */
export function classifyOccurrence(event: EventLike, ymd: string): OccurrenceResult {
  if (event.type !== 'CLASE') return fail('NOT_A_CLASS')
  // Una excepción puntual (childEvent) nunca puede anclar una sesión: la identidad de la
  // ocurrencia es (serie padre, día civil).
  if (event.parentEventId) return fail('IS_EXCEPTION_CHILD')
  if (event.status === 'CANCELLED') return fail('EVENT_CANCELLED')
  const effectiveFrom = event.effectiveFrom ? new Date(event.effectiveFrom) : null
  const effectiveUntil = event.effectiveUntil ? new Date(event.effectiveUntil) : null
  if (!effectiveWindowIncludesYmd(effectiveFrom, effectiveUntil, ymd)) {
    return fail('OUT_OF_EFFECTIVE_WINDOW')
  }

  const isRecurring = Boolean(event.isRecurring) && event.recurrenceType !== 'NONE'
  return isRecurring ? classifyRecurring(event, ymd) : classifyNonRecurring(event, ymd)
}

/** Mensajes de usuario por código; el HTTP status lo decide la ruta. */
export const OCCURRENCE_ERROR_MESSAGE: Record<OccurrenceErrorCode, string> = {
  NOT_A_CLASS: 'Solo se puede pasar lista en eventos de tipo clase.',
  EVENT_CANCELLED: 'La clase está cancelada.',
  NO_OCCURRENCE: 'La clase no se dicta ese día.',
  OCCURRENCE_SUSPENDED: 'La clase está suspendida ese día.',
  OUT_OF_EFFECTIVE_WINDOW: 'Esa fecha corresponde a otra versión del horario.',
  IS_EXCEPTION_CHILD: 'Usá el evento de la serie, no la excepción del día.',
}
