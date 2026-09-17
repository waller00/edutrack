/**
 * Formato de las inasistencias en la UI.
 *
 * El backend las manda en centésimos (`250` = 2,5 faltas) para que sumarlas sea exacto; acá se
 * traducen al borde, igual que las calificaciones. Espeja `formatAbsenceUnits` de
 * `backend/src/services/student-attendance/absence-weight.ts`.
 */
export function formatAbsenceUnits(hundredths: number): string {
  const units = hundredths / 100
  return (Number.isInteger(units) ? String(units) : units.toFixed(1)).replace('.', ',')
}
