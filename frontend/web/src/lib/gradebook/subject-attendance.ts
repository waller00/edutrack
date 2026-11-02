/**
 * Inasistencias de un alumno en la asignatura de la libreta (`GET /gradebook/:id/subject-attendance`),
 * para el control del docente en la carta: cada clase con lista cuenta una vez. No son las faltas
 * oficiales, que son del liceo y se cuentan por día.
 */
export type MarkCounts = {
  absent: number
  justified: number
  late: number
  /** Clases con lista pasada en las que figura el alumno. */
  classes: number
}

export type SubjectAttendance = {
  studentId: string
  total: MarkCounts
  /** Por período (id del período académico). */
  periods: Record<string, MarkCounts>
}

export type MarkCountPart = { count: number; label: string }

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** «2 sin justificar», «1 justificada», «1 llegada tarde»: lo que es cero no se nombra. */
export function markCountParts(counts: MarkCounts): MarkCountPart[] {
  const parts: MarkCountPart[] = [
    { count: counts.absent, label: 'sin justificar' },
    { count: counts.justified, label: plural(counts.justified, 'justificada', 'justificadas') },
    { count: counts.late, label: plural(counts.late, 'llegada tarde', 'llegadas tarde') },
  ]
  return parts.filter((part) => part.count > 0)
}

/** Hay algo que mostrar cuando se pasó lista al menos una vez con el alumno en el grupo. */
export function hasRollCalls(counts: MarkCounts | null | undefined): counts is MarkCounts {
  return Boolean(counts && counts.classes > 0)
}
