/**
 * Backfill de una sola vez para el cambio "C = conducta, R = rendimiento".
 *
 * Antes, C (`PeriodGrade.valueHundredths`) era la calificación del docente y R
 * (`meetingValueHundredths`) la que quedaba después de la reunión. Ahora C es la conducta
 * (`conductValueHundredths`) y R el rendimiento que carga el docente. Las notas que los docentes
 * ya pusieron como "C" quedarían invisibles y la materia figuraría pendiente en el boletín, así que
 * este script las copia a R **donde R está vacía**. Nunca pisa una R existente.
 *
 * Sólo toca libretas del ciclo en curso (`GradeBook.status = 'ACTIVE'`): los ciclos archivados son
 * histórico y sus boletines ya se emitieron.
 *
 * Ejecutar manualmente tras desplegar (NO corre en el entrypoint). Por defecto sólo informa:
 *   cd backend && npx tsx scripts/backfill-period-rendimiento.ts           # dry-run
 *   cd backend && npx tsx scripts/backfill-period-rendimiento.ts --apply   # escribe
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')

async function pending() {
  const rows = await prisma.$queryRaw<Array<{ periods: bigint; grades: bigint; gradebooks: bigint }>>`
    SELECT
      COUNT(DISTINCT pg."gradeBookPeriodId") AS periods,
      COUNT(*) AS grades,
      COUNT(DISTINCT gbp."gradeBookId") AS gradebooks
    FROM "PeriodGrade" pg
    JOIN "GradeBookPeriod" gbp ON gbp.id = pg."gradeBookPeriodId"
    JOIN "GradeBook" gb ON gb.id = gbp."gradeBookId"
    WHERE pg."meetingValueHundredths" IS NULL
      AND pg."valueHundredths" IS NOT NULL
      AND gb.status = 'ACTIVE'
  `
  const row = rows[0]
  return { gradebooks: Number(row?.gradebooks ?? 0), periods: Number(row?.periods ?? 0), grades: Number(row?.grades ?? 0) }
}

async function copyToRendimiento() {
  return prisma.$executeRaw`
    UPDATE "PeriodGrade" pg
    SET "meetingValueHundredths" = pg."valueHundredths", "updatedAt" = NOW()
    FROM "GradeBookPeriod" gbp, "GradeBook" gb
    WHERE gbp.id = pg."gradeBookPeriodId"
      AND gb.id = gbp."gradeBookId"
      AND gb.status = 'ACTIVE'
      AND pg."meetingValueHundredths" IS NULL
      AND pg."valueHundredths" IS NOT NULL
  `
}

async function main() {
  console.log(`Backfill C → R (rendimiento) — ${apply ? 'APLICANDO' : 'dry-run (usar --apply para escribir)'}`)
  const before = await pending()
  console.log('  A copiar:', before)
  if (!apply) return
  const updated = await copyToRendimiento()
  console.log('  Filas actualizadas:', updated)
  console.log('  Quedan:', await pending())
}

main()
  .catch((err) => {
    console.error('Backfill falló:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
