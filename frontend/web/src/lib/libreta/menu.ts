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
}

export const LIBRETA_SECTIONS: readonly LibretaSection[] = [
  { id: 'planificacion', label: 'Planificación', hint: 'Qué pensás dar en el año y cómo lo replanificaste.' },
  { id: 'desarrollo', label: 'Desarrollo del curso', hint: 'Registro clase a clase: qué se trabajó y cuántas horas se dictaron.' },
  { id: 'evaluaciones', label: 'Orales, escritos y otras actividades', hint: 'Cartas por alumno: cargar orales, escritos y otras actividades, y ver el detalle.' },
  { id: 'inasistencias', label: 'Inasistencias', hint: 'Faltas y llegadas tarde acumuladas del grupo.' },
  { id: 'cierre', label: 'Cierre de períodos', hint: 'Calificación general y juicio conceptual de cada estudiante.' },
  { id: 'visados', label: 'Visados', hint: 'Qué observó adscripción o dirección y qué períodos están visados.' },
  { id: 'mensajes', label: 'Observaciones y mensajes', hint: 'Intercambio con adscripción, dirección e inspección.' },
]

export function sectionById(id: string): LibretaSection | undefined {
  return LIBRETA_SECTIONS.find((section) => section.id === id)
}

export function sectionHref(gradeBookId: string, id: LibretaSectionId): string {
  return `/libreta/${gradeBookId}/${id}`
}
