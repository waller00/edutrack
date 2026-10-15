/**
 * A dónde fue cada pestaña de la vieja pantalla "Reportes de estudiantes" (`/admin/reportes`):
 * las faltas a Asistencia de estudiantes, las notas al Seguimiento de Rendimiento académico. Los
 * avisos ya guardados y los accesos directos siguen apuntando a la ruta vieja.
 */
export function legacyReportsTarget(tab: string | null | undefined): string {
  switch (tab) {
    case 'faltas':
      return '/admin/student-attendance?tab=faltas'
    case 'notas':
    case 'bajas':
      return '/libreta/indicadores?view=seguimiento'
    default:
      // "seguidas", "alertas" (las alertas que avisan son de faltas) o sin pestaña.
      return '/admin/student-attendance?tab=seguidas'
  }
}
