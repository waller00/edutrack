/**
 * Qué se puede cargar y editar en Calificaciones, con las mismas reglas que el backend aplica al
 * escribir (`assessmentWritePermissions`): un período cerrado congela sus evaluaciones y, fuera de
 * él, el docente tiene un plazo desde la fecha de cada una. La pantalla no ofrece lo que después
 * falla.
 */

export type PeriodWriteState = { periodId: string; status: string; canEdit: boolean }

/** Los tramos donde todavía se puede cargar: sin estado conocido, todos (lo decide al guardar). */
export function openTramos<T extends { id: string }>(tramos: readonly T[], states: readonly PeriodWriteState[] | undefined): T[] {
  if (!states) return [...tramos]
  const byId = new Map(states.map((state) => [state.periodId, state]))
  return tramos.filter((tramo) => byId.get(tramo.id)?.canEdit !== false)
}

function addDays(ymd: string, days: number): string {
  const date = new Date(`${ymd}T12:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/**
 * La fecha más vieja que se le puede poner a una evaluación nueva: hoy menos el plazo (un día de
 * margen por la hora). Sin plazo, o si quien carga corrige fuera de plazo, no hay límite.
 */
export function earliestGradableDate(todayYmd: string, windowDays: number | null | undefined, canWriteOutsideWindow = false): string | undefined {
  if (canWriteOutsideWindow || windowDays == null) return undefined
  return addDays(todayYmd, -Math.max(0, windowDays - 1))
}

export type AssessmentWrite = { canEdit?: boolean; blockedReason?: string | null; editableUntil?: string | null }

/** «Período cerrado», «Plazo vencido el 12/10»: por qué ya no se edita, en texto (no sólo un candado). */
export function assessmentLockText(write: AssessmentWrite): string | null {
  if (write.canEdit !== false) return null
  if (write.blockedReason === 'PERIOD_CLOSED') return 'Período cerrado'
  if (write.blockedReason === 'ARCHIVED') return 'Ciclo cerrado'
  if (write.blockedReason === 'WINDOW_EXPIRED') {
    const until = write.editableUntil?.slice(0, 10)
    return until ? `Plazo vencido el ${until.slice(8, 10)}/${until.slice(5, 7)}` : 'Plazo vencido'
  }
  return 'Sólo lectura'
}
