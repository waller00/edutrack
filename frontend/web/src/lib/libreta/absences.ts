/**
 * Formato de las inasistencias en la UI.
 *
 * El backend las manda en centésimos (`250` = 2,5 faltas) para que sumarlas sea exacto; acá se
 * traducen al borde, igual que las calificaciones. Espeja `formatAbsenceUnits` de
 * `backend/src/services/student-attendance/absence-weight.ts`.
 */
/**
 * Ciclo básico (EBI) cuenta la falta **por día**: faltar a una sola clase ya es la falta del día,
 * y una llegada tarde o una ausencia justificada valen media. Ahí el peso no lo elige nadie.
 */
export function isBasicCycleLevel(level: string | null | undefined): boolean {
  return level === 'EBI'
}

export function formatAbsenceUnits(hundredths: number): string {
  const units = hundredths / 100
  return (Number.isInteger(units) ? String(units) : units.toFixed(1)).replace('.', ',')
}
