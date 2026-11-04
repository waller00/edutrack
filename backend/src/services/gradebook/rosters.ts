import { loadRosterForScope, type RosterStudent } from '../student-attendance/roster.js'

/** El grupo de una libreta: oferta, orientación y ciclo. */
export type RosterScope = {
  schoolYearId: string
  courseOfferingId: string
  orientationId: string | null
  courseOrientationId: string | null
}

export const scopeKeyOf = (s: RosterScope) => `${s.courseOfferingId}|${s.orientationId ?? ''}|${s.courseOrientationId ?? ''}`

/**
 * Roster de cada grupo, una consulta por grupo y no por libreta: las doce materias de un grupo
 * comparten alumnos, y antes se pedían doce veces.
 */
export async function rostersByScope(scopes: readonly RosterScope[]): Promise<Map<string, RosterStudent[]>> {
  const unique = new Map(scopes.map((scope) => [scopeKeyOf(scope), scope]))
  const entries = await Promise.all(
    [...unique].map(async ([key, scope]) => [key, await loadRosterForScope(scope)] as const),
  )
  return new Map(entries)
}
