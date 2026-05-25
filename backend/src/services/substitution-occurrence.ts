import { DateTime } from 'luxon'
import { APP_TIMEZONE, isYmdDateString, uruguayWallToUtc } from '../config/app-timezone.js'
export class SubstitutionError extends Error {
  constructor(
    message: string,
    public statusCode = 400,
    public code = 'SUBSTITUTION_ERROR',
  ) {
    super(message)
  }
}

export function combineDateWithUtcTime(plannedDateYmd: string, time: Date) {
  const base = new Date(`${plannedDateYmd}T00:00:00.000Z`)
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      time.getUTCSeconds(),
      time.getUTCMilliseconds(),
    ),
  )
}

export function jsWeekdayInUruguayYmd(ymd: string) {
  const dt = DateTime.fromISO(`${ymd}T12:00:00`, { zone: APP_TIMEZONE })
  return dt.weekday % 7
}

export function resolveSubstitutionOccurrence(params: {
  occurrenceDate?: string | null
  event: {
    startDate: Date
    startTime: Date
    endTime: Date
    isRecurring: boolean
    daysOfWeek: number[]
    startDateOnly?: Date
  }
}) {
  const defaultYmd = DateTime.fromJSDate(params.event.startTime, { zone: 'utc' })
    .setZone(APP_TIMEZONE)
    .toFormat('yyyy-MM-dd')
  const occurrenceYmd = params.occurrenceDate?.trim() || defaultYmd

  if (!isYmdDateString(occurrenceYmd)) {
    throw new SubstitutionError('La fecha de la suplencia debe ser YYYY-MM-DD')
  }

  if (params.event.isRecurring && params.event.daysOfWeek.length > 0) {
    const dow = jsWeekdayInUruguayYmd(occurrenceYmd)
    if (!params.event.daysOfWeek.includes(dow)) {
      throw new SubstitutionError('La clase no tiene horario ese día de la semana')
    }
  }

  const eventStartYmd = DateTime.fromJSDate(params.event.startDate, { zone: 'utc' })
    .setZone(APP_TIMEZONE)
    .toFormat('yyyy-MM-dd')
  if (occurrenceYmd < eventStartYmd) {
    throw new SubstitutionError('La fecha de suplencia es anterior al inicio de la clase')
  }

  const attendanceDate = uruguayWallToUtc(occurrenceYmd, 0, 0)
  const startTime = combineDateWithUtcTime(occurrenceYmd, params.event.startTime)
  const endTime = combineDateWithUtcTime(occurrenceYmd, params.event.endTime)

  if (endTime.getTime() <= startTime.getTime()) {
    throw new SubstitutionError('El horario de la clase es inválido para esa fecha')
  }

  return { occurrenceYmd, attendanceDate, startTime, endTime }
}
