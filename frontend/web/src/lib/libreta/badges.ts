/**
 * Distintivos del alumno en la grilla del Libro del Profesor.
 *
 * SIGED los usa como marcas cortas de color (ADEC, EXEN, Gen…). Acá cada uno lleva **texto y
 * título explicativo** además del color: una sigla de cuatro letras en rojo no le dice nada a
 * quien la ve por primera vez, y RNF 7.2 no admite que el color sea la única señal.
 */

export type StudentBadgeCode = 'ADEC' | 'EXEN' | 'PEI' | 'INC' | 'GEN' | 'PEND'

export type StudentBadge = { code: string; label: string; className: string }

export const BADGE_CATALOG: Record<StudentBadgeCode, StudentBadge> = {
  ADEC: {
    code: 'ADEC',
    label: 'Adecuación curricular: cursa con ajustes razonables',
    className: 'bg-red-600 text-white',
  },
  EXEN: {
    code: 'EXEN',
    label: 'Exenciones o resoluciones administrativas vigentes',
    className: 'bg-purple-600 text-white',
  },
  PEI: {
    code: 'PEI',
    label: 'Plan educativo individual',
    className: 'bg-cyan-500 text-white',
  },
  INC: {
    code: 'INC',
    label: 'Inclusión educativa',
    className: 'bg-yellow-400 text-yellow-950',
  },
  GEN: {
    code: 'Gen',
    label: 'Observaciones generales cargadas por administración',
    className: 'bg-stone-600 text-white',
  },
  PEND: {
    code: 'PEND',
    label: 'Tiene asignaturas pendientes de años anteriores',
    className: 'bg-orange-500 text-white',
  },
}

export function badgeFor(code: string): StudentBadge {
  const key = code.toUpperCase() as StudentBadgeCode
  return BADGE_CATALOG[key] ?? { code, label: code, className: 'bg-gray-200 text-gray-800' }
}

/**
 * El contador de faltas de la lista del grupo, en texto neutro. Antes se pintaba de ámbar a las 10
 * y de rojo a las 20, una escala que no era ningún umbral del liceo ni se explicaba: las faltas
 * del docente se miran en su materia, y los umbrales del reglamento son de administración.
 */
export function absenceLabel(hundredths: number, formatted: string): string {
  return `${formatted} ${hundredths === 100 ? 'falta' : 'faltas'} en el liceo`
}
