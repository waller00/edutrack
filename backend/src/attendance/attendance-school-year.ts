import type { PrismaClient } from '@prisma/client'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'

/**
 * Filtra Attendance por ciclo lectivo usando la columna directa `schoolYearId`.
 * Antes se filtraba vía `where.event.schoolYearId`, lo que ocultaba las marcas sin
 * evento (manual / biométrica fuera de horario). Ahora se segmenta por la columna propia.
 */
export function mergeSchoolYearIntoAttendanceEventWhere(where: any, schoolYearId: string) {
  where.schoolYearId = schoolYearId
}

/**
 * Ciclo lectivo admin (query `schoolYearId` / `allYears=1`), alineado con eventos/cursos.
 * No aplica filtro si `allYears=1` o si no hay año resuelto.
 */
export async function attachResolvedSchoolYearToAttendanceWhere(
  prisma: PrismaClient,
  where: any,
  query: Record<string, unknown>,
  viewerRole: string,
) {
  if (query.allYears === '1') return
  const schoolYearId = await resolveSchoolYearIdForList(prisma, {
    role: viewerRole,
    requestedSchoolYearId: typeof query.schoolYearId === 'string' ? query.schoolYearId : undefined,
  })
  if (!schoolYearId) return
  mergeSchoolYearIntoAttendanceEventWhere(where, schoolYearId)
}
