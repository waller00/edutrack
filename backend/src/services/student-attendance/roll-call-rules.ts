import type { StudentAttendanceStatus } from '@prisma/client'
import type { TeacherWritableStatus } from './edit-window.js'

/** Largo de `StudentAttendanceEntry.note` en el esquema (VarChar 280). */
export const ENTRY_NOTE_MAX = 280

/**
 * Estado final de una entrada al recibir una marca del docente.
 *
 * Si secretaría ya justificó la falta y el docente reenvía `ABSENT` (típico cuando su
 * teléfono tenía la planilla cargada de antes), la justificación se conserva: sin esta
 * regla un guardado tardío borraría silenciosamente el trabajo administrativo.
 * Un `PRESENT`/`LATE` entrante sí pisa —el alumno efectivamente vino— y queda auditado.
 */
export function resolveIncomingEntryStatus(
  existing: StudentAttendanceStatus | null,
  incoming: TeacherWritableStatus,
): StudentAttendanceStatus {
  if (existing === 'ABSENT_JUSTIFIED' && incoming === 'ABSENT') return 'ABSENT_JUSTIFIED'
  return incoming
}

/** True cuando la marca entrante revierte una justificación existente (se audita). */
export function overridesJustification(
  existing: StudentAttendanceStatus | null,
  incoming: TeacherWritableStatus,
): boolean {
  return existing === 'ABSENT_JUSTIFIED' && incoming !== 'ABSENT'
}

/**
 * Estudiantes enviados que ya no pertenecen a la cohorte.
 * Evita que un cliente con el roster viejo escriba sobre un alumno que cambió de grupo.
 */
export function findStudentsOutsideRoster(
  incomingStudentIds: readonly string[],
  rosterStudentIds: readonly string[],
): string[] {
  const roster = new Set(rosterStudentIds)
  const seen = new Set<string>()
  const offenders: string[] = []
  for (const id of incomingStudentIds) {
    if (roster.has(id) || seen.has(id)) continue
    seen.add(id)
    offenders.push(id)
  }
  return offenders
}

/**
 * Agrega el motivo de la justificación a la nota del alumno, truncando al límite de columna.
 * La versión de personal concatena sin límite porque `Attendance.notes` es texto libre;
 * acá la columna es VarChar(280) y un append ingenuo reventaría el insert.
 */
export function appendJustificationNote(note: string | null, reason: string): string {
  const suffix = `Justificación: ${reason.trim()}`
  const merged = note?.trim() ? `${note.trim()} · ${suffix}` : suffix
  if (merged.length <= ENTRY_NOTE_MAX) return merged
  return `${merged.slice(0, ENTRY_NOTE_MAX - 1)}…`
}
