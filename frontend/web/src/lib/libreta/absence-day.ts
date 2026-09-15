/** Día civil YYYY-MM-DD en zona institucional (Uruguay). */
export function todayYmdUruguay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Montevideo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Suma/resta días civiles sobre un YYYY-MM-DD (calendario, sin DST). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

export function formatYmdDisplay(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return ymd
  return `${d}/${m}/${y.slice(2)}`
}

/** Nombre del día de la semana en español (Uruguay), capitalizado. */
export function weekdayNameEs(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  if (!y || !m || !d) return ''
  // Mediodía UTC ≈ mañana en Uruguay; evita bordes de fecha por huso.
  const name = new Intl.DateTimeFormat('es-UY', {
    timeZone: 'America/Montevideo',
    weekday: 'long',
  }).format(new Date(Date.UTC(y, m - 1, d, 15, 0, 0)))
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Valores del combo de inasistencia.
 * Vacío = presente (el docente solo marca faltas y tardes).
 * LATE / media falta se entienden como 0,5 sin mostrarlo en la etiqueta.
 */
export type DayMarkSelectValue = '' | 'LATE' | 'ABSENT_100' | 'ABSENT_50'

export function dayMarkToSelect(mark: {
  status: string
  absenceWeightHundredths: number | null
} | null): DayMarkSelectValue {
  if (!mark) return ''
  if (mark.status === 'PRESENT') return ''
  if (mark.status === 'LATE') return 'LATE'
  if (mark.status === 'ABSENT' || mark.status === 'ABSENT_JUSTIFIED') {
    return mark.absenceWeightHundredths === 50 ? 'ABSENT_50' : 'ABSENT_100'
  }
  return ''
}

/** Vacío → PRESENT (vino). Solo se usa al guardar. */
export function selectToDayMark(value: DayMarkSelectValue): {
  status: 'PRESENT' | 'LATE' | 'ABSENT'
  absenceWeightHundredths: number | null
} {
  if (!value) return { status: 'PRESENT', absenceWeightHundredths: null }
  if (value === 'LATE') return { status: 'LATE', absenceWeightHundredths: null }
  if (value === 'ABSENT_50') return { status: 'ABSENT', absenceWeightHundredths: 50 }
  return { status: 'ABSENT', absenceWeightHundredths: 100 }
}

/** Filas CSV del historial de inasistencias (estilo Libro del Profesor). */
export function buildAbsencesExportRows(params: {
  studentName: string
  courseName: string
  fromYmd: string
  toYmd: string
  subjects: Array<{
    subjectName: string
    absences: string
    entries: Array<{ ymd: string; label: string }>
  }>
}): string[][] {
  const rows: string[][] = [
    [`Inasistencias del Alumno: ${params.studentName}`],
    [
      `Curso: ${params.courseName}`,
      '',
      '',
      `Desde: ${formatYmdDisplay(params.fromYmd)}`,
      '',
      `Hasta: ${formatYmdDisplay(params.toYmd)}`,
    ],
    [],
  ]

  for (const subject of params.subjects) {
    rows.push([subject.subjectName.toUpperCase(), '', '', `FALTA: ${subject.absences}`])
    for (const entry of subject.entries) {
      rows.push([formatYmdDisplay(entry.ymd), entry.label.toUpperCase()])
    }
    rows.push([])
  }

  return rows
}
