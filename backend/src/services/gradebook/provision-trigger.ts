import type { PrismaClient } from '@prisma/client'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { provisionGradeBooks } from './provision.js'

/**
 * Las libretas se generan solas al tocar el horario.
 *
 * `provisionGradeBooks` ya derivaba la libreta de los eventos de clase, pero sólo corría cuando
 * alguien llamaba al endpoint a mano — y ese endpoint no tenía botón en ninguna pantalla. Resultado:
 * se cargaba la clase, el docente entraba a la libreta y no había nada. Este módulo es el disparador
 * que faltaba.
 *
 * La provisión es una **consecuencia** del horario, no un requisito para cargarlo: corre después de
 * responder y un fallo se registra sin tumbar el guardado del evento.
 */

export type GradeBookRelevantEvent = {
  type?: string | null
  schoolYearId?: string | null
  courseOfferingId?: string | null
  subjectId?: string | null
  parentEventId?: string | null
}

/**
 * ¿Este evento participa en la derivación de libretas?
 *
 * Mismo criterio que `loadClassEvents` salvo el `status`: **cancelar** una clase también cambia el
 * resultado (el titular vigente del scope pasa a ser el del evento que queda), así que una baja
 * también tiene que disparar. Las excepciones por ocurrencia (`parentEventId`) quedan afuera porque
 * no aportan scope propio.
 */
export function affectsGradeBooks(event: GradeBookRelevantEvent | null | undefined): boolean {
  if (!event) return false
  return (
    event.type === 'CLASE' &&
    !event.parentEventId &&
    Boolean(event.schoolYearId) &&
    Boolean(event.courseOfferingId) &&
    Boolean(event.subjectId)
  )
}

function uniqueYearIds(events: readonly (GradeBookRelevantEvent | null | undefined)[]): string[] {
  const ids = new Set<string>()
  for (const event of events) {
    if (affectsGradeBooks(event)) ids.add(event!.schoolYearId as string)
  }
  return [...ids]
}

/**
 * Ciclos a reprovisionar por un guardado: el del evento y, si el evento cambió de ciclo o dejó de
 * ser relevante, también el anterior. Si no aplica a ninguno de los dos lados, no hay nada que hacer.
 */
export function provisionTargetsForSave(
  before: GradeBookRelevantEvent | null | undefined,
  after: GradeBookRelevantEvent | null | undefined,
): string[] {
  return uniqueYearIds([before, after])
}

/** Ídem para una importación de horario: un ciclo por lote, no uno por fila. */
export function provisionTargetsForBatch(events: readonly GradeBookRelevantEvent[]): string[] {
  return uniqueYearIds(events)
}

async function provisionOpenSchoolYears(schoolYearIds: readonly string[], db: PrismaClient): Promise<void> {
  const open = await db.schoolYear.findMany({
    where: { id: { in: [...schoolYearIds] }, status: { not: 'CLOSED' } },
    select: { id: true },
  })
  for (const year of open) {
    await provisionGradeBooks(year.id, db)
  }
}

/**
 * Lanza la provisión sin esperarla.
 *
 * Nunca recibe un cliente de transacción: la promesa corre después del commit y el `tx` ya estaría
 * cerrado. Los ciclos cerrados se saltean — cancelar un evento de un año archivado no debe crear
 * libretas activas en él (`archiveSchoolYearGradeBooks` justamente las archivó).
 */
export function scheduleGradeBookProvision(
  schoolYearIds: readonly string[],
  db: PrismaClient = defaultPrisma,
): void {
  if (schoolYearIds.length === 0) return
  // Una función `async` nunca lanza en forma sincrónica: rechaza la promesa. Por eso quien guarda
  // el evento puede llamar a esto sin envolverlo en un try/catch.
  void provisionOpenSchoolYears(schoolYearIds, db).catch((error) => {
    console.error('[gradebook provision trigger]', error)
  })
}
