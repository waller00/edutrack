import type { GradeBookHeader, RosterStudent } from './types'

/**
 * Nombre completo de una libreta: "Matemática · 3 EMS — Ciencia y Tecnología".
 *
 * La orientación es lo que distingue dos libretas de la misma asignatura y curso, así que nunca
 * se omite cuando existe: sin ella el docente de 3.º EMS ve varias filas idénticas.
 */
export function gradeBookTitle(header: Pick<GradeBookHeader, 'subject' | 'course' | 'orientation'>): string {
  const base = `${header.subject.name} · ${header.course.name}`
  return header.orientation ? `${base} — ${header.orientation}` : base
}

/** "Apellido, Nombre", como se lee la lista en clase. */
export function studentFullName(student: Pick<RosterStudent, 'firstName' | 'lastName'>): string {
  return `${student.lastName}, ${student.firstName}`.trim()
}

/**
 * Agrupa las libretas por curso para el listado del docente.
 *
 * Un docente típico dicta la misma asignatura en varios cursos; agrupar por curso es lo que hace
 * la lista navegable en lugar de una tira plana de veinte filas.
 */
export function groupByCourse(books: GradeBookHeader[]): Array<{ course: string; books: GradeBookHeader[] }> {
  const groups = new Map<string, GradeBookHeader[]>()
  for (const book of books) {
    const key = book.course.name
    const bucket = groups.get(key)
    if (bucket) bucket.push(book)
    else groups.set(key, [book])
  }
  return [...groups.entries()].map(([course, grouped]) => ({ course, books: grouped }))
}
