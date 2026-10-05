import {
  describeInheritance,
  inheritSourceOptions,
  type PeriodInheritanceSummary,
  type YearOption,
} from './period-inheritance'

/**
 * Alta de un ciclo lectivo.
 *
 * El alta hereda **la parametrización de la libreta y nada más**: los períodos del ciclo origen con
 * las fechas corridas al año nuevo. Las ofertas de curso, las asignaturas y las decisiones de los
 * estudiantes siguen siendo el wizard de apertura, que es donde Dirección las revisa una por una.
 *
 * Antes de esto un ciclo nacía sin períodos y el docente abría su libreta y no veía nada.
 */

export type CreateYearDraft = {
  code: string
  label: string
  startsOn: string
  sourceSchoolYearId: string
  inheritPeriods: boolean
}

export type CreateYearResponse = {
  code: number
  label: string
  /** `null` cuando se creó sin heredar. */
  academicPeriods: PeriodInheritanceSummary | null
}

/** Los ciclos ofrecibles como origen del calendario. Ninguno existe todavía como destino. */
export function createSourceOptions(years: readonly YearOption[]): Array<{ value: string; label: string }> {
  return inheritSourceOptions(years, null)
}

/**
 * Sugerencias para el formulario vacío: el año siguiente al último cargado y ese último como
 * origen, que es el caso real de todos los marzos.
 */
export function defaultCreateDraft(years: readonly YearOption[], fallbackYear: number): CreateYearDraft {
  const latest = [...years].sort((a, b) => b.code - a.code)[0]
  const code = latest ? latest.code + 1 : fallbackYear
  return {
    code: String(code),
    label: `Ciclo lectivo ${code}`,
    startsOn: '',
    sourceSchoolYearId: latest?.id ?? '',
    inheritPeriods: true,
  }
}

/** El mensaje de error a mostrar, o `null` si el borrador se puede enviar. */
export function validateCreateDraft(draft: CreateYearDraft): string | null {
  const code = Number.parseInt(draft.code, 10)
  if (!draft.label.trim() || Number.isNaN(code)) return 'Completá el código (año) y la etiqueta.'
  if (code < 1980 || code > 2100) return 'El código (año) tiene que estar entre 1980 y 2100.'
  return null
}

export function createYearPayload(draft: CreateYearDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    code: Number.parseInt(draft.code, 10),
    label: draft.label.trim(),
    status: 'PLANNED',
    inheritAcademicPeriods: draft.inheritPeriods,
  }
  if (draft.startsOn) payload.startsOn = new Date(`${draft.startsOn}T00:00:00.000Z`).toISOString()
  // El origen sólo viaja si se va a heredar: mandarlo apagado haría creer que se copió algo.
  if (draft.inheritPeriods && draft.sourceSchoolYearId) payload.sourceSchoolYearId = draft.sourceSchoolYearId
  return payload
}

export function createYearMessage(response: CreateYearResponse): string {
  const created = `Ciclo ${response.code} creado en estado planificado.`
  if (!response.academicPeriods) {
    return `${created} Sin parametrización de libreta: cargala desde Libreta → Configuración.`
  }
  return `${created} ${describeInheritance(response.academicPeriods)}`
}
