import { ymdInUruguay } from '../events/event-versioning.js'

export type ExpandedOccurrence = {
  eventId: string
  ymd: string
  startAt: Date
  endAt: Date
  title: string
  subject: string | null
  course: string | null
  orientation: string | null
  teacher: { id: string; name: string | null; username: string | null } | null
}

export type PendingRow = ExpandedOccurrence & { daysLate: number; sessionId: string | null }

/** Días completos entre el fin de la clase y hoy; sirve para ordenar el reclamo. */
export function daysLateOf(endAt: Date, now: Date): number {
  const diff = now.getTime() - endAt.getTime()
  return diff <= 0 ? 0 : Math.floor(diff / 86_400_000)
}

/**
 * Ocurrencias de clase ya terminadas cuya lista nadie pasó.
 *
 * Excluye deliberadamente:
 * - clases que todavía no terminaron (no están "sin pasar", están en curso);
 * - días no laborables (no hubo clase que listar);
 * - ocurrencias con sesión TAKEN.
 * Incluye las sesiones en PENDING: se abrió la planilla y nunca se confirmó.
 */
export function selectPendingOccurrences(params: {
  occurrences: readonly ExpandedOccurrence[]
  sessions: ReadonlyMap<string, { id: string; status: string }>
  nonWorkingYmds: ReadonlySet<string>
  now: Date
}): PendingRow[] {
  const rows: PendingRow[] = []
  for (const occurrence of params.occurrences) {
    if (occurrence.endAt.getTime() > params.now.getTime()) continue
    if (params.nonWorkingYmds.has(occurrence.ymd)) continue

    const session = params.sessions.get(sessionKey(occurrence.eventId, occurrence.ymd))
    if (session?.status === 'TAKEN') continue

    rows.push({
      ...occurrence,
      sessionId: session?.id ?? null,
      daysLate: daysLateOf(occurrence.endAt, params.now),
    })
  }
  return rows.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
}

export function sessionKey(eventId: string, ymd: string): string {
  return `${eventId}|${ymd}`
}

/** Limita el rango consultable: expandir recurrencias es O(eventos × días). */
export const PENDING_MAX_RANGE_DAYS = 62

export function clampPendingRange(from: string, to: string): { from: string; to: string; clamped: boolean } {
  const start = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)
  const spanDays = Math.floor((end.getTime() - start.getTime()) / 86_400_000)
  if (spanDays <= PENDING_MAX_RANGE_DAYS) return { from, to, clamped: false }
  const clampedEnd = new Date(start.getTime() + PENDING_MAX_RANGE_DAYS * 86_400_000)
  return { from, to: ymdInUruguay(clampedEnd), clamped: true }
}
