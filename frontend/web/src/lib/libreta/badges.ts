/**
 * Distintivos del alumno en la grilla del Libro del Profesor.
 *
 * SIGED los usa como marcas cortas de color (ADEC, EXEN, PEI…). Acá cada uno lleva **texto y
 * título explicativo** además del color: una sigla de cuatro letras en rojo no le dice nada a
 * quien la ve por primera vez, y RNF 7.2 no admite que el color sea la única señal.
 */

export type StudentBadge = { code: string; label: string; className: string }

export const BADGE_CATALOG: Record<string, StudentBadge> = {
  ADEC: { code: 'ADEC', label: 'Adecuación curricular: cursa con ajustes razonables', className: 'bg-red-600 text-white' },
  EXEN: { code: 'EXEN', label: 'Exonerado de la asignatura', className: 'bg-purple-600 text-white' },
  PEI: { code: 'PEI', label: 'Plan educativo individual', className: 'bg-cyan-500 text-white' },
  INC: { code: 'INC', label: 'Inclusión educativa', className: 'bg-yellow-400 text-yellow-950' },
  GEN: { code: 'Gen', label: 'Repite el grado', className: 'bg-gray-500 text-white' },
  PEND: { code: 'PEND', label: 'Tiene asignaturas pendientes de años anteriores', className: 'bg-orange-500 text-white' },
}

export function badgeFor(code: string): StudentBadge {
  return BADGE_CATALOG[code.toUpperCase()] ?? { code, label: code, className: 'bg-gray-200 text-gray-800' }
}

/** Color del contador de inasistencias. El número siempre se muestra: el color es refuerzo. */
export function absenceTone(count: number): string {
  if (count >= 20) return 'text-red-700'
  if (count >= 10) return 'text-amber-700'
  return 'text-gray-500'
}
