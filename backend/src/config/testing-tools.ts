/**
 * ¿Están habilitadas las herramientas de prueba (simular lector, limpiar datos, borrar todo)?
 *
 * `ALLOW_ADMIN_TESTING_TOOLS` manda; sin definir, sólo fuera de producción. Vive aparte de
 * `admin-testing-tools.ts` para que las rutas que la consultan no carguen esas herramientas.
 */
export function isAdminTestingToolsEnabled() {
  const flag = String(process.env.ALLOW_ADMIN_TESTING_TOOLS ?? '').trim().toLowerCase()
  if (flag === '1' || flag === 'true' || flag === 'yes') return true
  if (flag === '0' || flag === 'false' || flag === 'no') return false
  return process.env.NODE_ENV !== 'production'
}
