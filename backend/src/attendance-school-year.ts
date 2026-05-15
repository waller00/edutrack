import type { PrismaClient } from '@prisma/client'
import { resolveSchoolYearIdForList } from './services/school-year-service.js'

/** Mezcla `schoolYearId` en `where.event` para consultas Prisma sobre Attendance. */
export function mergeSchoolYearIntoAttendanceEventWhere(where: any, schoolYearId: string) {
  const existing = where.event
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
    where.event = { ...existing, schoolYearId }
  } else {
    where.event = { schoolYearId }
  }
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
