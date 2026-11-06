/**
 * Juicios de la reunión de profesores (`TeacherMeetingRecord`): el general del grupo y el de cada
 * alumno. Cambiar un juicio no borra el anterior: lo sucede, y el vigente es el más reciente.
 */

import type { JudgementState } from './meeting-board'

export type MeetingDecision = {
  id: string
  decision: string
  createdAt: string
  student: { id: string; firstName: string; lastName: string } | null
  createdBy: { id: string; name: string | null } | null
}

/** La decisión vigente de cada alumno —y la del grupo— es la más reciente. */
export function currentDecisionIds(rows: readonly MeetingDecision[]): Set<string> {
  const newest = new Map<string, MeetingDecision>()
  for (const row of rows) {
    const key = row.student?.id ?? 'grupo'
    const current = newest.get(key)
    if (!current || row.createdAt > current.createdAt) newest.set(key, row)
  }
  return new Set([...newest.values()].map((row) => row.id))
}

/** El juicio vigente de cada alumno y el del grupo (clave `null`). */
export function currentByKey(rows: readonly MeetingDecision[]): Map<string | null, MeetingDecision> {
  const current = currentDecisionIds(rows)
  return new Map(rows.filter((row) => current.has(row.id)).map((row) => [row.student?.id ?? null, row]))
}

/** Quiénes tienen juicio vigente y si está el del grupo: lo que muestran la tabla y el resumen. */
export function judgementState(current: ReadonlyMap<string | null, MeetingDecision>): NonNullable<JudgementState> {
  return {
    studentIds: new Set([...current.keys()].filter((key): key is string => key !== null)),
    group: current.has(null),
  }
}

export function meetingRecordsPath(courseOfferingId: string, courseOrientationId: string | null | undefined, periodId: string) {
  const params = new URLSearchParams({ courseOfferingId, periodId })
  if (courseOrientationId) params.set('courseOrientationId', courseOrientationId)
  return `/admin/gradebook/meeting-records?${params}`
}
