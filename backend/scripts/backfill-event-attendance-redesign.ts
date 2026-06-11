/**
 * Backfill idempotente para el rediseño de eventos/asistencia/incidencias.
 *
 * Ejecutar manualmente tras desplegar (NO corre en el entrypoint):
 *   cd backend && npx tsx scripts/backfill-event-attendance-redesign.ts
 *
 * Hace dos cosas, ambas seguras de repetir:
 *  1) Versionado: para eventos sin `effectiveFrom`, fija la ventana de vigencia inicial
 *     (`effectiveFrom = startDate`, `effectiveUntil = recurrenceEnd`).
 *  2) Incidencias redundantes: marca como RESUELTAS las LATE_ARRIVAL / EARLY_EXIT abiertas
 *     (ahora se derivan del status de la asistencia, no se persisten como incidencias).
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function backfillEventVersioning() {
  // effectiveFrom = startDate donde aún no está seteado (idempotente: solo toca los null).
  const fromResult = await prisma.$executeRaw`
    UPDATE "Event"
    SET "effectiveFrom" = "startDate"
    WHERE "effectiveFrom" IS NULL
  `
  // effectiveUntil = recurrenceEnd para recurrentes con fin definido y sin vigencia de cierre.
  const untilResult = await prisma.$executeRaw`
    UPDATE "Event"
    SET "effectiveUntil" = "recurrenceEnd"
    WHERE "effectiveUntil" IS NULL AND "recurrenceEnd" IS NOT NULL
  `
  return { effectiveFromSet: fromResult, effectiveUntilSet: untilResult }
}

async function resolveRedundantIncidents() {
  const result = await prisma.$executeRaw`
    UPDATE "AttendanceIncident"
    SET "status" = 'RESOLVED', "resolvedAt" = NOW()
    WHERE "type" IN ('LATE_ARRIVAL', 'EARLY_EXIT') AND "status" <> 'RESOLVED'
  `
  return { resolvedRedundant: result }
}

async function main() {
  console.log('Backfill rediseño eventos/asistencia — inicio')
  const versioning = await backfillEventVersioning()
  console.log('  Versionado:', versioning)
  const incidents = await resolveRedundantIncidents()
  console.log('  Incidencias redundantes resueltas:', incidents)
  console.log('Backfill completado.')
}

main()
  .catch((err) => {
    console.error('Backfill falló:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
