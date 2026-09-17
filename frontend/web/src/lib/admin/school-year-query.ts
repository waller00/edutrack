/**
 * Compone el filtro de ciclo lectivo (`schoolYearId=…` o `allYears=1`) sobre una ruta de API.
 *
 * `schoolYearQuery` sale de `useOptionalAdminSchoolYear()` y puede venir vacío cuando la
 * página se renderiza fuera del `AdminShell` (por ejemplo en tests), en cuyo caso la ruta
 * se devuelve intacta y el backend resuelve el ciclo activo por su cuenta.
 */
export function withSchoolYear(path: string, schoolYearQuery: string): string {
  if (!schoolYearQuery) return path
  return path.includes('?') ? `${path}&${schoolYearQuery}` : `${path}?${schoolYearQuery}`
}
