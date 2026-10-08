import { prisma } from '../../db/prisma.js'
import { getActiveSchoolYearId } from '../school-year-service.js'
import { provisionGradeBooks, type ProvisionSummary } from './provision.js'

/** Cada cuánto se regeneran solas las libretas del ciclo activo. */
export const GRADEBOOK_PROVISION_INTERVAL_MS = 60 * 60 * 1000

/**
 * Genera o actualiza las libretas del ciclo activo a partir de los eventos de clase (RF-020).
 *
 * Corre sola (`server.ts`) para que la libreta exista sin que nadie la pida: el horario se carga y
 * se cambia todo el año, y hasta ahora `provisionGradeBooks` sólo corría si alguien llamaba a mano
 * a la API. Es idempotente y no revive libretas archivadas; administración también puede correrla
 * desde Configuración de libreta después de cargar el horario.
 */
export async function provisionActiveSchoolYear(): Promise<ProvisionSummary | null> {
  const schoolYearId = await getActiveSchoolYearId(prisma)
  if (!schoolYearId) return null
  return provisionGradeBooks(schoolYearId)
}

/** Línea de log sólo cuando algo cambió: una corrida por hora sin novedades no ensucia el log. */
export function provisionLogLine(summary: ProvisionSummary | null): string | null {
  if (!summary || (summary.created === 0 && summary.updated === 0)) return null
  return (
    `[libreta] provisión: creadas=${summary.created} titular-actualizado=${summary.updated} ` +
    `eventos-sin-mapear=${summary.skippedEvents} cursos-no-ofertados=${summary.skippedNotOffered}`
  )
}
