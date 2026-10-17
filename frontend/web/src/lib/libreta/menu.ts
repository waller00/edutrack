/**
 * Secciones del Libro del Profesor.
 *
 * El orden es el de la libreta de papel: primero lo que se planifica, después lo que se dicta,
 * después lo que se evalúa y al final lo que se cierra. Cada entrada dice para qué sirve, porque
 * "Precierre" o "Visado" no se explican solos.
 *
 * El menú depende de quién mira. El docente trabaja su libreta y lee lo que le dice Dirección
 * ("Mensajes del director"); quien supervisa (Dirección, adscripción) la recorre de sólo lectura
 * y tiene "Visado y seguimiento", donde visa y le escribe al docente. Las inasistencias no son una
 * sección: salen del pase de lista y se ven en la carta de cada alumno.
 */

export type LibretaSectionId = 'planificacion' | 'desarrollo' | 'evaluaciones' | 'cierre' | 'mensajes' | 'visado'

export type LibretaSection = {
  id: LibretaSectionId
  label: string
  /** Qué se hace en esta sección, en una línea. Se muestra debajo del título. */
  hint: string
  /** Abreviatura para el menú contraído: con el menú angosto la sección se sigue reconociendo. */
  abbr: string
}

const WORK_SECTIONS: readonly LibretaSection[] = [
  { id: 'planificacion', label: 'Planificación', abbr: 'Plan', hint: 'Qué pensás dar en el año y cómo lo replanificaste.' },
  { id: 'desarrollo', label: 'Desarrollo del curso', abbr: 'Des', hint: 'Registro clase a clase: qué se trabajó y cuántas horas se dictaron.' },
  {
    id: 'evaluaciones',
    label: 'Calificaciones (Or · Otras · Ev · C · R)',
    abbr: 'Cal',
    hint: 'Carta por alumno como la planilla: notas sueltas por tramo, C (conducta) y R (rendimiento), e informe de cada entrega.',
  },
  { id: 'cierre', label: 'Cierre de períodos', abbr: 'Cie', hint: 'Conducta, rendimiento, juicio e informe del grupo, y cierre de cada entrega.' },
]

const MESSAGES_SECTION: LibretaSection = {
  id: 'mensajes',
  label: 'Mensajes del director',
  abbr: 'Msj',
  hint: 'Lo que Dirección te observó o te pidió en esta libreta: notas que faltan, informes, juicios. Podés responderle.',
}

const ENDORSEMENT_SECTION: LibretaSection = {
  id: 'visado',
  label: 'Visado y seguimiento',
  abbr: 'Vis',
  hint: 'Visar calificaciones, seguir si se dio lo planificado y si está el informe del grupo, y escribirle al docente.',
}

/** Todas las secciones, para resolver una por id sin importar quién mira. */
export const LIBRETA_SECTIONS: readonly LibretaSection[] = [...WORK_SECTIONS, MESSAGES_SECTION, ENDORSEMENT_SECTION]

/**
 * Lo único que ve el suplente: sus notas. Planificación, desarrollo, conducta, rendimiento, cierre
 * y mensajes son del titular, y el suplente tiene un acceso provisorio (hasta una semana después
 * de su última clase cubierta).
 */
const SUBSTITUTE_SECTION: LibretaSection = {
  id: 'evaluaciones',
  label: 'Tus notas (suplencia)',
  abbr: 'Not',
  hint: 'Las notas que cargás mientras cubrís al titular. Lo que cargó el titular no se muestra.',
}

export type LibretaViewer = {
  /** Supervisa la libreta (observa o visa): Dirección, adscripción, inspección. */
  supervises: boolean
  /** La cubre como suplente: ve y carga sólo sus notas. */
  substitute?: boolean
}

/** Las secciones que ve quien mira la libreta, en orden. */
export function sectionsFor(viewer: LibretaViewer): readonly LibretaSection[] {
  if (viewer.substitute) return [SUBSTITUTE_SECTION]
  return viewer.supervises ? [...WORK_SECTIONS, ENDORSEMENT_SECTION] : [...WORK_SECTIONS, MESSAGES_SECTION]
}

export function sectionById(id: string): LibretaSection | undefined {
  return LIBRETA_SECTIONS.find((section) => section.id === id)
}

export function sectionHref(gradeBookId: string, id: LibretaSectionId): string {
  return `/libreta/${gradeBookId}/${id}`
}
