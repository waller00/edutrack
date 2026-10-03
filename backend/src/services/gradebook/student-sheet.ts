/**
 * La hoja del estudiante que el docente ve dentro de su libreta.
 *
 * El liceo la describe así: el docente recibe la hoja con todo lo que administración cargó —foto,
 * datos, de dónde vino o cómo promovió, qué materias se llevó y qué adecuaciones tiene— porque lo
 * tiene en cuenta **al calificar**. Por eso vive en la libreta y no en una ficha aparte.
 *
 * Es distinta de `GET /admin/gradebook/students/:id`, que exige `gradebook.read` de alcance ALL
 * —que el docente no tiene— y devuelve la trayectoria de todos los años.
 */

export type AccommodationRow = {
  id: string
  kind: string
  summary: string
  externalUrl: string | null
  validFrom: Date | null
  validUntil: Date | null
}

/** Solo las fechas: alcanza para saber si una adecuación está vigente (chips del roster). */
export type AccommodationValidity = {
  validFrom: Date | null
  validUntil: Date | null
}

/**
 * Adecuaciones vigentes a la fecha.
 *
 * Una vencida deja de mostrarse pero no se borra: el historial importa, y que el docente de este
 * año no la vea no significa que no haya existido. Sin fechas se considera vigente — es el caso
 * normal de una adecuación que no tiene plazo.
 */
export function currentAccommodations<T extends AccommodationValidity>(
  rows: readonly T[],
  now: Date = new Date(),
): T[] {
  return rows.filter((row) => {
    if (row.validFrom && row.validFrom > now) return false
    if (row.validUntil && row.validUntil < now) return false
    return true
  })
}

export type PendingSubjectRow = {
  id: string
  subject: { id: string; name: string } | null
  schoolYear: { id: string; code: number } | null
  origin: string
  apeDecember: string | null
  apeFebruary: string | null
  resolvedAt: Date | null
}

/**
 * Materias que el estudiante **todavía** debe, de más reciente a más vieja.
 *
 * Las resueltas se filtran acá y no en la consulta para que el mismo dato sirva después al
 * histórico: lo que el docente necesita ver es lo que arrastra hoy.
 */
export function unresolvedPendingSubjects(
  rows: readonly PendingSubjectRow[],
): PendingSubjectRow[] {
  return rows
    .filter((row) => row.resolvedAt == null)
    .sort((a, b) => (b.schoolYear?.code ?? 0) - (a.schoolYear?.code ?? 0))
}

/** Etiqueta legible de cómo llegó el estudiante a este año. */
export const ACADEMIC_RESULT_LABELS: Record<string, string> = {
  PROMOTED: 'Promovido',
  PROMOTED_WITH_PENDING: 'Promovido con materias pendientes',
  REPEATED: 'Repitió',
  PENDING_APE: 'Pendiente de APE',
}

/**
 * Códigos de distintivo para la grilla / carta de evaluaciones (estilo SIGED).
 *
 * - ADEC: adecuaciones vigentes
 * - Gen: observaciones generales (notas de acceso/observación que carga admin)
 * - EXEN: reservado; hoy no hay modelo de exenciones en el esquema
 * - PEND: no se emite por ahora (las materias pendientes siguen en la hoja)
 */
export function badgeCodesForStudent(flags: {
  hasAccommodations: boolean
  hasGeneralNotes: boolean
  hasExemptions?: boolean
}): string[] {
  const codes: string[] = []
  if (flags.hasAccommodations) codes.push('ADEC')
  if (flags.hasExemptions) codes.push('EXEN')
  if (flags.hasGeneralNotes) codes.push('GEN')
  return codes
}

/**
 * Cómo llegó el estudiante a este ciclo.
 *
 * En 7.º no hay año anterior en el liceo: lo que corresponde mostrar es de dónde vino el pase. En
 * los años siguientes, el resultado del ciclo anterior. Es la distinción que pide el liceo.
 */
export function admissionSummary(params: {
  admittedFrom: string | null
  previousResult: string | null
  previousYearCode: number | null
}): { kind: 'TRANSFER' | 'PROMOTION' | 'UNKNOWN'; label: string } {
  if (params.previousResult) {
    const label = ACADEMIC_RESULT_LABELS[params.previousResult] ?? params.previousResult
    return {
      kind: 'PROMOTION',
      label: params.previousYearCode ? `${label} en ${params.previousYearCode}` : label,
    }
  }
  if (params.admittedFrom?.trim()) {
    return { kind: 'TRANSFER', label: `Pase de ${params.admittedFrom.trim()}` }
  }
  return { kind: 'UNKNOWN', label: 'Sin datos de ingreso' }
}
