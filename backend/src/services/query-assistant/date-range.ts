import { DateTime } from 'luxon'
import { getAppTimezone } from '../../config/app-timezone.js'
import type { LlmIntentPayload } from './schemas.js'
import type { QueryAssistantScope } from './scope.js'

export function ymdRangeForCalendarMonth(year: number, month: number) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  return { from, to }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Límites UTC inclusivos para consultas por día civil YYYY-MM-DD. */
export function ymdBoundsUtc(fromYmd: string, toYmd: string): { start: Date; end: Date } {
  const start = new Date(`${fromYmd}T00:00:00.000Z`)
  const end = new Date(`${toYmd}T23:59:59.999Z`)
  return { start, end }
}

/**
 * Prioridad: dateFrom+dateTo válidos → mes calendario (year+month, año actual si falta year).
 */
export function resolveYmdRangeFromPayload(params: LlmIntentPayload['params']): { from: string; to: string } | null {
  const df = params.dateFrom?.trim()
  const dt = params.dateTo?.trim()
  if (df && dt && YMD.test(df) && YMD.test(dt) && df <= dt) {
    return { from: df, to: dt }
  }

  let year = params.year
  const month = params.month
  if (month != null && month >= 1 && month <= 12 && year == null) {
    year = DateTime.utc().year
  }
  if (year != null && month != null && month >= 1 && month <= 12) {
    return ymdRangeForCalendarMonth(year, month)
  }
  return null
}

function todayYmdUy(): string {
  return DateTime.now().setZone(getAppTimezone()).toISODate()!
}

/**
 * Rango efectivo del informe, por precedencia:
 *  1. Filtro de fechas explícito de la UI (`scope.dateFrom`/`dateTo`).
 *  2. Período derivado de la pregunta (mes, rango, "este año", "hoy"…).
 *  3. Ciclo lectivo seleccionado completo (sus límites, o el año del código).
 *  4. "Todos los ciclos": todo el histórico disponible.
 * Devuelve null solo si no hay ninguna señal (ni scope) → el executor pide un mes.
 */
export function resolveEffectiveYmdRange(
  params: LlmIntentPayload['params'],
  scope?: QueryAssistantScope,
): { from: string; to: string } | null {
  const uiFrom = scope?.dateFrom?.trim()
  const uiTo = scope?.dateTo?.trim()
  if (uiFrom && uiTo && YMD.test(uiFrom) && YMD.test(uiTo) && uiFrom <= uiTo) {
    return { from: uiFrom, to: uiTo }
  }

  const fromQuestion = resolveYmdRangeFromPayload(params)
  if (fromQuestion) return fromQuestion

  if (scope?.schoolYearId && !scope.allYears) {
    if (scope.schoolYearStartsOn) {
      return { from: scope.schoolYearStartsOn, to: scope.schoolYearEndsOn ?? todayYmdUy() }
    }
    if (scope.schoolYearCode) {
      return { from: `${scope.schoolYearCode}-01-01`, to: `${scope.schoolYearCode}-12-31` }
    }
  }

  if (scope?.allYears) {
    // Sin límite inferior real: la expansión por evento queda acotada por cada startDate/recurrenceEnd.
    return { from: '2000-01-01', to: todayYmdUy() }
  }

  return null
}
