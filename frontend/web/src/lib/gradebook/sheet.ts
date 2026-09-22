import { parseToHundredths } from '@/lib/academic-config/grade-value'
import type { RosterStudent } from './types'

/**
 * Estado de la planilla de calificaciones, como lógica pura.
 *
 * Vive fuera del componente por la misma razón que `lib/rollcall/`: es donde están las reglas que
 * importan (qué cambió, qué se manda, cómo se mezcla lo del servidor con lo que el docente venía
 * escribiendo) y se puede probar sin renderizar nada.
 */

export type GradeCell = {
  studentId: string
  /** Lo que el docente ve y escribe ("7,5"). Vacío = sin calificar. */
  input: string
  isAbsent: boolean
  comment: string
  /** Valor que trajo el servidor, para saber si la celda está sucia. */
  savedInput: string
  savedIsAbsent: boolean
}

export type SheetDraft = {
  order: string[]
  cells: Record<string, GradeCell>
}

export type ServerGrade = {
  studentId: string
  valueHundredths: number | null
  isAbsent: boolean
  comment: string | null
}

function formatInput(valueHundredths: number | null, decimals: number): string {
  if (valueHundredths == null) return ''
  return (valueHundredths / 100).toFixed(Math.max(0, Math.min(2, decimals))).replace('.', ',')
}

export function buildDraft(
  students: readonly RosterStudent[],
  grades: readonly ServerGrade[],
  decimals: number,
): SheetDraft {
  const byStudent = new Map(grades.map((g) => [g.studentId, g]))
  const cells: Record<string, GradeCell> = {}
  for (const student of students) {
    const saved = byStudent.get(student.studentId)
    const input = formatInput(saved?.valueHundredths ?? null, decimals)
    cells[student.studentId] = {
      studentId: student.studentId,
      input,
      isAbsent: saved?.isAbsent ?? false,
      comment: saved?.comment ?? '',
      savedInput: input,
      savedIsAbsent: saved?.isAbsent ?? false,
    }
  }
  return { order: students.map((s) => s.studentId), cells }
}

export function setInput(draft: SheetDraft, studentId: string, input: string): SheetDraft {
  const cell = draft.cells[studentId]
  if (!cell) return draft
  // Escribir una nota levanta la ausencia: son estados excluyentes, igual que en el backend.
  const isAbsent = input.trim() === '' ? cell.isAbsent : false
  return { ...draft, cells: { ...draft.cells, [studentId]: { ...cell, input, isAbsent } } }
}

export function toggleAbsent(draft: SheetDraft, studentId: string): SheetDraft {
  const cell = draft.cells[studentId]
  if (!cell) return draft
  const isAbsent = !cell.isAbsent
  return {
    ...draft,
    cells: { ...draft.cells, [studentId]: { ...cell, isAbsent, input: isAbsent ? '' : cell.input } },
  }
}

export function setComment(draft: SheetDraft, studentId: string, comment: string): SheetDraft {
  const cell = draft.cells[studentId]
  if (!cell) return draft
  return { ...draft, cells: { ...draft.cells, [studentId]: { ...cell, comment } } }
}

/** Celdas que difieren de lo guardado. Es lo que decide si hay que advertir al salir. */
export function dirtyCells(draft: SheetDraft): GradeCell[] {
  return draft.order
    .map((id) => draft.cells[id])
    .filter((cell) => cell && (cell.input !== cell.savedInput || cell.isAbsent !== cell.savedIsAbsent))
}

export function hasUnsavedChanges(draft: SheetDraft): boolean {
  return dirtyCells(draft).length > 0
}

/** Entradas mal escritas ("ocho", "7,,5"): la UI las marca antes de dejar guardar. */
export function invalidCells(draft: SheetDraft): GradeCell[] {
  return draft.order
    .map((id) => draft.cells[id])
    .filter((cell) => cell && cell.input.trim() !== '' && parseToHundredths(cell.input) === null)
}

/**
 * Payload de guardado: **sólo lo que cambió**.
 *
 * Mandar la planilla entera haría que el backend recorriera todo el grupo en cada guardado y, peor,
 * dificultaría distinguir una carga real de un reenvío. El backend igual descarta lo que no cambió.
 */
export function toSavePayload(draft: SheetDraft): Array<{
  studentId: string
  valueHundredths: number | null
  isAbsent: boolean
  comment: string | null
}> {
  return dirtyCells(draft).map((cell) => ({
    studentId: cell.studentId,
    valueHundredths: cell.isAbsent ? null : parseToHundredths(cell.input),
    isAbsent: cell.isAbsent,
    comment: cell.comment.trim() === '' ? null : cell.comment.trim(),
  }))
}

/**
 * Mezcla la cohorte del servidor con el borrador en curso.
 *
 * Si el docente ya venía cargando notas, una recarga no puede pisarle el trabajo: se conserva lo
 * que escribió y sólo se incorporan los alumnos nuevos y los valores guardados que no tocó.
 */
export function mergeServerDraft(server: SheetDraft, current: SheetDraft | null): SheetDraft {
  if (!current) return server
  const cells: Record<string, GradeCell> = {}
  for (const id of server.order) {
    const fresh = server.cells[id]
    const existing = current.cells[id]
    if (!existing) {
      cells[id] = fresh
      continue
    }
    const wasEdited = existing.input !== existing.savedInput || existing.isAbsent !== existing.savedIsAbsent
    cells[id] = wasEdited
      ? { ...existing, savedInput: fresh.savedInput, savedIsAbsent: fresh.savedIsAbsent }
      : fresh
  }
  return { order: server.order, cells }
}

export function countGraded(draft: SheetDraft): { graded: number; absent: number; pending: number } {
  let graded = 0
  let absent = 0
  for (const id of draft.order) {
    const cell = draft.cells[id]
    if (cell.isAbsent) absent++
    else if (cell.input.trim() !== '') graded++
  }
  return { graded, absent, pending: draft.order.length - graded - absent }
}
