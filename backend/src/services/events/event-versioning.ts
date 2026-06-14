import { DateTime } from 'luxon'
import { getAppTimezone, uruguayWallToUtc } from '../../config/app-timezone.js'

/**
 * Versionado temporal de la definición de un evento recurrente.
 *
 * En vez de clonar el evento con un id opaco y marcar la descripción, al editar un campo
 * sensible de un evento que ya tiene asistencias se hace un "split de vigencia": la versión
 * actual se cierra en la fecha de corte y se crea una versión nueva vigente desde el corte.
 * Las ocurrencias pasadas (y sus asistencias) siguen resolviéndose contra la versión vieja,
 * por lo que los históricos no se corrompen.
 */

export function ymdInUruguay(d: Date): string {
  return DateTime.fromJSDate(d, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

export function uyStartOfDayUtc(ymd: string): Date {
  return uruguayWallToUtc(ymd, 0, 0)
}

export function addDaysYmd(ymd: string, days: number): string {
  return DateTime.fromISO(ymd, { zone: getAppTimezone() }).plus({ days }).toFormat('yyyy-MM-dd')
}

export function todayUruguayYmd(now = new Date()): string {
  return ymdInUruguay(now)
}

/** true si el instante de inicio del evento (UTC en DB) ya pasó respecto a `now`. */
export function isEventStartInPast(startInstantUtc: Date, now = new Date()): boolean {
  return startInstantUtc.getTime() < now.getTime()
}

/** true si el inicio cambió y el nuevo instante quedó en el pasado (edición). */
export function isMovingEventStartToPast(
  existingStartInstantUtc: Date,
  newStartInstantUtc: Date,
  now = new Date(),
): boolean {
  if (newStartInstantUtc.getTime() === existingStartInstantUtc.getTime()) return false
  return isEventStartInPast(newStartInstantUtc, now)
}

/** ¿La ventana de vigencia [from, until] (por YMD de Uruguay) incluye la fecha dada? */
export function effectiveWindowIncludesYmd(
  effectiveFrom: Date | null | undefined,
  effectiveUntil: Date | null | undefined,
  ymd: string,
): boolean {
  if (effectiveFrom && ymd < ymdInUruguay(effectiveFrom)) return false
  if (effectiveUntil && ymd > ymdInUruguay(effectiveUntil)) return false
  return true
}

/**
 * Cierra la versión actual y crea la nueva versión vigente desde `cutoffYmd`.
 * `data` son los campos ya resueltos para la nueva versión; `include` se usa para la respuesta.
 * Devuelve el evento creado (nueva versión).
 */
export async function splitEventDefinitionForEdit(
  tx: any,
  params: { existing: { id: string; revisionOf: string | null }; data: Record<string, any>; include?: any; cutoffYmd: string },
) {
  const { existing, data, include, cutoffYmd } = params
  const familyRoot = existing.revisionOf ?? existing.id

  const created = await tx.event.create({
    data: {
      ...data,
      status: data.status ?? 'SCHEDULED',
      revisionOf: familyRoot,
      effectiveFrom: uyStartOfDayUtc(cutoffYmd),
      effectiveUntil: data.recurrenceEnd ?? null,
    },
    ...(include ? { include } : {}),
  })

  await tx.event.update({
    where: { id: existing.id },
    data: {
      effectiveUntil: uyStartOfDayUtc(addDaysYmd(cutoffYmd, -1)),
      supersededById: created.id,
    },
  })

  return created
}
