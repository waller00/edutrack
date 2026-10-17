/** Estados persistidos de una marca de estudiante. */
export type RollCallStatus = 'PRESENT' | 'LATE' | 'ABSENT' | 'ABSENT_JUSTIFIED'

/** Los tres que el docente puede elegir; el justificado lo aplica secretaría. */
export const TEACHER_STATUSES = ['PRESENT', 'ABSENT', 'LATE'] as const
export type TeacherStatus = (typeof TEACHER_STATUSES)[number]

export const ROLL_CALL_STATUS_LABEL: Record<RollCallStatus, string> = {
  PRESENT: 'Presente',
  LATE: 'Llegada tarde',
  ABSENT: 'Ausente',
  ABSENT_JUSTIFIED: 'Ausente justificado',
}

/** Etiqueta corta para los botones del aula, donde el ancho es escaso. */
export const ROLL_CALL_STATUS_SHORT: Record<RollCallStatus, string> = {
  PRESENT: 'P',
  LATE: 'T',
  ABSENT: 'A',
  ABSENT_JUSTIFIED: 'AJ',
}

/** Clase del botón seleccionado. El no seleccionado es neutro para que el color informe. */
export function getRollCallStatusButtonClass(status: RollCallStatus, selected: boolean): string {
  if (!selected) return 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
  switch (status) {
    case 'PRESENT':
      return 'border-emerald-300 bg-emerald-100 text-emerald-900'
    case 'LATE':
      return 'border-amber-300 bg-amber-100 text-amber-900'
    case 'ABSENT':
      return 'border-red-300 bg-red-100 text-red-900'
    default:
      return 'border-sky-300 bg-sky-100 text-sky-900'
  }
}

export function getRollCallStatusChipClass(status: RollCallStatus | null): string {
  switch (status) {
    case 'PRESENT':
      return 'bg-emerald-100 text-emerald-800'
    case 'LATE':
      return 'bg-amber-100 text-amber-900'
    case 'ABSENT':
      return 'bg-red-100 text-red-800'
    case 'ABSENT_JUSTIFIED':
      return 'bg-sky-100 text-sky-900'
    default:
      return 'bg-gray-100 text-gray-600'
  }
}

/**
 * Estado guardado de la planilla de una clase. Lo que se muestra (abre a las…, sin pasar, fuera de
 * plazo) depende además de la hora: ver `rollcall-phase.ts`.
 */
export type SessionStatus = 'PENDING' | 'TAKEN'

/**
 * Ciclo del botón de estado: presente → ausente → llegada tarde → presente.
 * La excepción más frecuente, la ausencia, queda a un solo toque.
 */
export function nextStatusOnTap(current: RollCallStatus | null): TeacherStatus {
  switch (current) {
    case 'PRESENT':
      return 'ABSENT'
    case 'ABSENT':
      return 'LATE'
    default:
      // Tarde, justificado o sin marcar arrancan (o vuelven) en presente.
      return 'PRESENT'
  }
}
