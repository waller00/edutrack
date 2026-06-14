import { prisma } from '../../../db/prisma.js'
import { resolveSchoolYearIdForList } from '../../school-year-service.js'

/** Filtros mínimos que afectan el alcance (personas / ciclo) de un export. */
export type ExportScopeFilters = {
  role?: string
  userId?: string
  schoolYearId?: string
}

/**
 * Conjunto de userIds que entran al export:
 *  - si hay userId, ese único usuario;
 *  - si hay role, todos los usuarios de ese rol;
 *  - si no hay ninguno, null (sin restricción por persona).
 */
export async function scopeUserIdsFor(filters?: ExportScopeFilters): Promise<string[] | null> {
  if (filters?.userId) return [filters.userId]
  if (!filters?.role) return null
  const rows = await prisma.user.findMany({ where: { orgRole: { code: filters.role } }, select: { id: true } })
  return rows.map((row) => row.id)
}

/** Ciclo lectivo a aplicar: undefined si el export es "todos los ciclos". */
export async function resolveScopedSchoolYearId(filters: ExportScopeFilters | undefined, allYearsExport: boolean) {
  if (allYearsExport) return undefined
  const sy = await resolveSchoolYearIdForList(prisma, {
    role: 'ADMIN',
    requestedSchoolYearId: typeof filters?.schoolYearId === 'string' ? filters.schoolYearId : undefined,
  })
  return sy || undefined
}
