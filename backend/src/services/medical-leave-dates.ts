import type { Prisma } from '@prisma/client'
import { uruguayWallToUtc, uruguayYmdEndOfDayToUtc } from '../config/app-timezone.js'

/**
 * Fechas de las licencias.
 *
 * Una licencia es de **días enteros**: se carga "del 3 al 7" y cubre todas las clases de esos
 * días. Se guarda con la fecha UTC del día (la pantalla manda el mediodía UTC; las viejas pueden
 * estar a medianoche), así que su día civil es la parte de fecha UTC. Antes se comparaba el
 * instante guardado: una licencia del 3 al 7 cubría desde las 9:00 del 3 hasta las 9:00 del 7, y
 * una clase de las 7:30 del primer día o de la tarde del último quedaba sin justificar.
 */

const YMD = /^(\d{4}-\d{2}-\d{2})/

/** Día civil guardado en una fecha de licencia o de ciclo: su parte de fecha UTC. */
export function storedDayYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` o un ISO completo → `YYYY-MM-DD`; `null` si no es una fecha. */
export function queryDayYmd(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const match = YMD.exec(raw.trim())
  return match ? match[1] : null
}

/** Ventana que cubre la licencia: desde las 00:00 del primer día hasta el final del último, en hora institucional. */
export function licenseWindow(license: { startDate: Date; endDate: Date }): { from: Date; to: Date } {
  return {
    from: uruguayWallToUtc(storedDayYmd(license.startDate), 0, 0),
    to: uruguayYmdEndOfDayToUtc(storedDayYmd(license.endDate)),
  }
}

/**
 * Días del ciclo lectivo: sus fechas de inicio y fin, o el año calendario (`code`) si el ciclo
 * no las tiene cargadas. Antes, sin fechas, el filtro se ignoraba y aparecían las licencias de
 * todos los años.
 */
export function schoolYearDays(schoolYear: { code: number; startsOn: Date | null; endsOn: Date | null }): {
  from: string
  to: string
} {
  return {
    from: schoolYear.startsOn ? storedDayYmd(schoolYear.startsOn) : `${schoolYear.code}-01-01`,
    to: schoolYear.endsOn ? storedDayYmd(schoolYear.endsOn) : `${schoolYear.code}-12-31`,
  }
}

/**
 * Licencias vigentes algún día entre `from` y `to` (inclusive), comparando días y no instantes.
 *
 * Los ciclos se guardan a la medianoche UTC y las licencias al mediodía: comparando instantes,
 * una licencia que empezaba el último día del ciclo quedaba afuera de ese ciclo.
 */
export function activeOnDays(from: string | null, to: string | null): Prisma.MedicalLeaveWhereInput[] {
  const conditions: Prisma.MedicalLeaveWhereInput[] = []
  if (to) conditions.push({ startDate: { lte: new Date(`${to}T23:59:59.999Z`) } })
  if (from) conditions.push({ endDate: { gte: new Date(`${from}T00:00:00.000Z`) } })
  return conditions
}
