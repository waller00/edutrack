/**
 * Secciones del Libro del Profesor.
 *
 * El orden es el de la libreta de papel: primero lo que se planifica, después lo que se dicta,
 * después lo que se evalúa y al final lo que se cierra y se visa. Cada entrada dice para qué
 * sirve, porque "Precierre" o "Visados" no se explican solos.
 */

export type LibretaSectionId =
  | 'planificacion'
  | 'desarrollo'
  | 'evaluaciones'
  | 'inasistencias'
  | 'cierre'
  | 'visados'
  | 'mensajes'

export type LibretaSection = {
  id: LibretaSectionId
  label: string
  /** Qué se hace en esta sección, en una línea. Se muestra debajo del título. */
  hint: string
  /** Abreviatura para el menú contraído: con el menú angosto la sección se sigue reconociendo. */
  abbr: string
}

export const LIBRETA_SECTIONS: readonly LibretaSection[] = [
  { id: 'planificacion', label: 'Planificación', abbr: 'Plan', hint: 'Qué pensás dar en el año y cómo lo replanificaste.' },
  { id: 'desarrollo', label: 'Desarrollo del curso', abbr: 'Des', hint: 'Registro clase a clase: qué se trabajó y cuántas horas se dictaron.' },
  { id: 'evaluaciones', label: 'Calificaciones (Or · Otras · Ev · C · R)', abbr: 'Cal', hint: 'Carta por alumno como la planilla: notas sueltas por tramo, C y R, e informe de cada entrega.' },
  { id: 'inasistencias', label: 'Inasistencias', abbr: 'Ina', hint: 'Faltas y llegadas tarde acumuladas del grupo.' },
  { id: 'cierre', label: 'Cierre de períodos', abbr: 'Cie', hint: 'C, R, informe y conducta, por alumno o de todo el grupo, y cierre de cada entrega.' },
  { id: 'visados', label: 'Visados', abbr: 'Vis', hint: 'Qué observó adscripción o dirección y qué períodos están visados.' },
  { id: 'mensajes', label: 'Observaciones y mensajes', abbr: 'Msj', hint: 'Intercambio con adscripción, dirección e inspección.' },
]

export function sectionById(id: string): LibretaSection | undefined {
  return LIBRETA_SECTIONS.find((section) => section.id === id)
}

export function sectionHref(gradeBookId: string, id: LibretaSectionId): string {
  return `/libreta/${gradeBookId}/${id}`
}
