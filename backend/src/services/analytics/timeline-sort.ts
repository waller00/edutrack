import { DateTime } from 'luxon'
import { getAppTimezone, uruguayWallToUtc } from '../../config/app-timezone.js'

/** Proyecta la hora civil al día filtrado para ordenar bloques de clase/puente en cronología diaria. */
export function timelineSortInstantOnDay(dayYmd: string, at?: Date | string | null) {
  if (!at) return uruguayWallToUtc(dayYmd, 0, 0)
  const wall = DateTime.fromJSDate(new Date(at), { zone: 'utc' }).setZone(getAppTimezone())
  return uruguayWallToUtc(dayYmd, wall.hour, wall.minute)
}
