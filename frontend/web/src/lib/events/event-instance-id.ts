/**
 * Identidad de una ocurrencia devuelta por `/events/my-events`.
 *
 * Al expandir la recurrencia el backend emite instancias sintéticas con
 * `id = "<uuid del evento>_<YYYY-MM-DD>"` y el uuid real en `originalEventId`
 * (ver `generateRecurringInstances` en backend/src/events/events-query.ts).
 * Ese id compuesto sirve como clave de React, pero NO es un identificador válido para la
 * API: los endpoints validan `eventId` con `z.string().uuid()` y buscan el evento por id,
 * y `Attendance.eventId` guarda siempre el uuid de la serie, nunca el compuesto.
 */
export type EventOccurrenceLike = {
  id: string
  originalEventId?: string | null
}

/** `YYYY-MM-DD` al final de un id compuesto. */
const INSTANCE_ID_SUFFIX = /_\d{4}-\d{2}-\d{2}$/

/**
 * uuid real del evento, sirva la ocurrencia de una serie o un evento único.
 *
 * Se prefiere `originalEventId` porque es lo que el backend emite explícitamente; el corte
 * del sufijo queda como red de seguridad para respuestas que no lo traigan.
 */
export function resolveRealEventId(event: EventOccurrenceLike): string {
  if (event.originalEventId) return event.originalEventId
  return event.id.replace(INSTANCE_ID_SUFFIX, '')
}

/** True si el id es una instancia sintética de una serie recurrente. */
export function isExpandedInstanceId(id: string): boolean {
  return INSTANCE_ID_SUFFIX.test(id)
}
