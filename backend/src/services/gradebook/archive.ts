import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'

/**
 * Paso a histórico de las libretas al cerrar el ciclo (RF-110, RF-111).
 *
 * Archivar no borra ni mueve nada: cambia el estado a `ARCHIVED` y con eso toda la cadena de
 * escritura —calificar, cerrar períodos, importar de Moodle, visar— queda bloqueada por las
 * guardas que ya existen. La consulta sigue abierta para quien tenga permiso.
 */

export type ArchiveSummary = {
  schoolYearId: string
  archived: number
  alreadyArchived: number
  /** Períodos que quedaron sin cerrar al archivar: no bloquean, pero conviene saberlo. */
  openPeriods: number
}

/**
 * ¿Se puede archivar el ciclo?
 *
 * Deliberadamente **no** se exige que todo esté cerrado y visado. Un año lectivo termina en una
 * fecha, no cuando el último docente completó su libreta; bloquear el cierre por una libreta
 * incompleta dejaría a la institución sin poder pasar de año. Lo que sí se hace es informar
 * cuántos períodos quedaron abiertos.
 */
export async function countOpenPeriods(schoolYearId: string, db: PrismaClient = defaultPrisma): Promise<number> {
  return db.gradeBookPeriod.count({
    where: { gradeBook: { schoolYearId }, status: { not: 'CLOSED' } },
  })
}

export async function archiveSchoolYearGradeBooks(
  schoolYearId: string,
  db: PrismaClient = defaultPrisma,
): Promise<ArchiveSummary> {
  const [total, alreadyArchived, openPeriods] = await Promise.all([
    db.gradeBook.count({ where: { schoolYearId } }),
    db.gradeBook.count({ where: { schoolYearId, status: 'ARCHIVED' } }),
    countOpenPeriods(schoolYearId, db),
  ])

  const result = await db.gradeBook.updateMany({
    where: { schoolYearId, status: 'ACTIVE' },
    data: { status: 'ARCHIVED' },
  })

  return {
    schoolYearId,
    archived: result.count,
    alreadyArchived,
    openPeriods,
  }
}

/**
 * Reapertura del ciclo: vuelve las libretas a `ACTIVE`.
 *
 * Existe porque cerrar un año por error es un accidente plausible y sin esto la única salida
 * sería tocar la base a mano. Reabrir el ciclo no reabre los períodos: cada uno conserva su
 * estado y su historial de visado.
 */
export async function unarchiveSchoolYearGradeBooks(
  schoolYearId: string,
  db: PrismaClient = defaultPrisma,
): Promise<{ schoolYearId: string; restored: number }> {
  const result = await db.gradeBook.updateMany({
    where: { schoolYearId, status: 'ARCHIVED' },
    data: { status: 'ACTIVE' },
  })
  return { schoolYearId, restored: result.count }
}

/** Total, no sólo el conteo: la ficha histórica necesita saber si el ciclo tuvo actividad. */
export async function historicalSummary(schoolYearId: string, db: PrismaClient = defaultPrisma) {
  const [gradeBooks, closedPeriods, endorsed, grades] = await Promise.all([
    db.gradeBook.count({ where: { schoolYearId } }),
    db.gradeBookPeriod.count({ where: { gradeBook: { schoolYearId }, status: 'CLOSED' } }),
    db.endorsement.count({
      where: { gradeBookPeriod: { gradeBook: { schoolYearId } }, section: 'ALL', status: 'ENDORSED' },
    }),
    db.periodGrade.count({ where: { gradeBookPeriod: { gradeBook: { schoolYearId } } } }),
  ])
  return { gradeBooks, closedPeriods, endorsedPeriods: endorsed, periodGrades: grades }
}
