import type { RollCallStatus, TeacherStatus } from './rollcall-status'

export type SheetStudent = {
  studentId: string
  firstName: string
  lastName: string
  documentId: string | null
  entryId: string | null
  status: RollCallStatus | null
  note: string | null
  markedAt: string | null
}

export type SheetDraft = Record<string, { status: RollCallStatus | null; note: string | null }>

/** Estado inicial editable a partir de lo que devolvió el servidor. */
export function buildDraft(students: SheetStudent[]): SheetDraft {
  const draft: SheetDraft = {}
  for (const student of students) {
    draft[student.studentId] = { status: student.status, note: student.note }
  }
  return draft
}

export function setStatus(draft: SheetDraft, studentId: string, status: TeacherStatus): SheetDraft {
  return { ...draft, [studentId]: { status, note: draft[studentId]?.note ?? null } }
}

export function setNote(draft: SheetDraft, studentId: string, note: string): SheetDraft {
  const trimmed = note.trim()
  return {
    ...draft,
    [studentId]: { status: draft[studentId]?.status ?? null, note: trimmed ? trimmed : null },
  }
}

/** Marca a todos con el mismo estado. No pisa una falta ya justificada por secretaría. */
export function applyBulk(draft: SheetDraft, students: SheetStudent[], status: TeacherStatus): SheetDraft {
  const next: SheetDraft = { ...draft }
  for (const student of students) {
    const current = draft[student.studentId]
    if (current?.status === 'ABSENT_JUSTIFIED' && status === 'ABSENT') continue
    next[student.studentId] = { status, note: current?.note ?? null }
  }
  return next
}

export type CopySuggestion = { studentId: string; status: RollCallStatus }

/**
 * Aplica la sugerencia de la hora anterior.
 *
 * Solo toca alumnos presentes en ambas listas. Los que no venían en la hora anterior
 * (`newStudentIds`) quedan deliberadamente sin marcar: son altas nuevas o cambios de grupo,
 * y el docente tiene que decidir explícitamente, no heredar un estado que nadie afirmó.
 */
export function applyCopySuggestion(
  draft: SheetDraft,
  students: SheetStudent[],
  suggestions: CopySuggestion[],
): { draft: SheetDraft; applied: number; unmatchedIds: string[] } {
  const byStudent = new Map(suggestions.map((s) => [s.studentId, s.status]))
  const next: SheetDraft = { ...draft }
  const unmatchedIds: string[] = []
  let applied = 0

  for (const student of students) {
    const suggested = byStudent.get(student.studentId)
    if (!suggested) {
      unmatchedIds.push(student.studentId)
      continue
    }
    next[student.studentId] = { status: suggested, note: draft[student.studentId]?.note ?? null }
    applied += 1
  }

  return { draft: next, applied, unmatchedIds }
}

export type StatusCounts = { present: number; late: number; absent: number; justified: number; pending: number }

export function countByStatus(draft: SheetDraft, students: SheetStudent[]): StatusCounts {
  const counts: StatusCounts = { present: 0, late: 0, absent: 0, justified: 0, pending: 0 }
  for (const student of students) {
    switch (draft[student.studentId]?.status) {
      case 'PRESENT':
        counts.present += 1
        break
      case 'LATE':
        counts.late += 1
        break
      case 'ABSENT':
        counts.absent += 1
        break
      case 'ABSENT_JUSTIFIED':
        counts.justified += 1
        break
      default:
        counts.pending += 1
    }
  }
  return counts
}

export function isSheetComplete(draft: SheetDraft, students: SheetStudent[]): boolean {
  return students.length > 0 && students.every((s) => Boolean(draft[s.studentId]?.status))
}

export type SavePayloadEntry = { studentId: string; status: TeacherStatus; note: string | null }

/**
 * Convierte el borrador en el payload del PUT.
 *
 * `ABSENT_JUSTIFIED` se degrada a `ABSENT`: el endpoint no acepta ese estado (solo se alcanza
 * justificando) y el backend reconoce la justificación existente y la conserva.
 * Los alumnos sin marcar se omiten: no se afirma nada sobre quien el docente no tocó.
 */
export function toSavePayload(draft: SheetDraft, students: SheetStudent[]): SavePayloadEntry[] {
  const payload: SavePayloadEntry[] = []
  for (const student of students) {
    const cell = draft[student.studentId]
    if (!cell?.status) continue
    payload.push({
      studentId: student.studentId,
      status: cell.status === 'ABSENT_JUSTIFIED' ? 'ABSENT' : (cell.status as TeacherStatus),
      note: cell.note ?? null,
    })
  }
  return payload
}

/**
 * Reconcilia el borrador local con un roster recién traído del servidor.
 * Conserva lo que el docente ya marcó y deja sin estado a los alumnos nuevos.
 */
export function mergeServerRoster(server: SheetStudent[], localDraft: SheetDraft): SheetDraft {
  const next: SheetDraft = {}
  for (const student of server) {
    const local = localDraft[student.studentId]
    next[student.studentId] = local ?? { status: student.status, note: student.note }
  }
  return next
}

export function fullName(student: { firstName: string; lastName: string }): string {
  return `${student.lastName}, ${student.firstName}`
}
