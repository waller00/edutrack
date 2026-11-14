import { ABSENCE_THRESHOLDS } from '../student-reports/rules.js'
import type { AbsenceStreakRow, AbsenceThresholdRow, loadGradeDrops, loadLowGrades } from '../student-reports/reports.js'
import {
  absencesText,
  formatCount,
  formatHundredths,
  formatPercent,
  formatRatio,
  formatShare,
  formatShortYmd,
  gradeUnits,
  ratioValue,
  studentName,
} from '../reports/format.js'
import { share, type Block, type Column, type Part, type ReportDoc, type ReportSection, type TableBlock, type Tile } from '../reports/model.js'
import type { AcademicComparison, AcademicDashboard, ComparisonDimension } from './academic.js'
import type { DayCounts } from './attendance-trend.js'
import type { loadAttendanceTrend, loadRisk, loadSubjectsApe } from './loaders.js'
import type { RiskFamily, RiskRow } from './risk.js'
import type { Cohort, Counts, Trajectory } from './trajectory.js'

/**
 * Informe de Indicadores de estudiantes: las secciones de la pantalla (Resumen, Rendimiento,
 * Materias y APE, Asistencia, Trayectoria, Quién necesita atención), cada una sólo con el permiso
 * de donde salen sus números, como `visibleSections` del front. Los números salen de los mismos
 * servicios que la pantalla; acá sólo se escriben.
 *
 * Las cuentas chicas de la pantalla (`presentDays`, `trajectoryHeadline`, el orden de las materias
 * con notas bajas) están copiadas de `frontend/web/src/lib/admin/student-indicators.ts` y
 * `student-trajectory.ts`: si cambia una, cambia la otra.
 */

export type IndicatorAccess = { analytics: boolean; reports: boolean }
export type ReportPeriod = { id: string; name: string; level: string | null }

type RiskResult = Awaited<ReturnType<typeof loadRisk>>
type TrendResult = Awaited<ReturnType<typeof loadAttendanceTrend>>
type ApeResult = Awaited<ReturnType<typeof loadSubjectsApe>>
type LowGradesResult = NonNullable<Awaited<ReturnType<typeof loadLowGrades>>>
type DropsResult = NonNullable<Awaited<ReturnType<typeof loadGradeDrops>>>
type YearRef = { id: string; label: string }

export type StudentReportData = {
  access: IndicatorAccess
  year: YearRef
  period: ReportPeriod | null
  generatedAt: Date
  risk: RiskResult | null
  trend: TrendResult | null
  streaks: AbsenceStreakRow[] | null
  thresholds: AbsenceThresholdRow[] | null
  subjectsApe: ApeResult | null
  lowGrades: LowGradesResult | null
  drops: DropsResult | null
  dashboard: AcademicDashboard | null
  comparisons: Partial<Record<ComparisonDimension, AcademicComparison>> | null
  trajectory: Trajectory | null
}

const [WARNING_ABSENCES, CRITICAL_ABSENCES] = ABSENCE_THRESHOLDS
const LEVEL_NAMES: Record<string, string> = { EBI: 'ciclo básico', EMS: 'bachillerato' }
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre']

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const units = (hundredths: number | null) => (hundredths === null ? null : gradeUnits(hundredths))

// ─── Cuentas de la pantalla ─────────────────────────────────────────────────

/** Días en que vino: los días con lista menos los días con falta (llegar tarde es que vino). */
export const presentDays = (counts: DayCounts) => counts.studentDays - counts.absentDays

const attendanceRate = (counts: DayCounts) => (counts.studentDays > 0 ? (presentDays(counts) / counts.studentDays) * 100 : null)

/** `2026-03` → «marzo». */
export const monthName = (month: string) => MONTHS[Number(month.slice(5, 7)) - 1] ?? month

/** `2026-03` → «Mar». */
export function monthLabel(month: string): string {
  const name = monthName(month)
  return name === month ? month : `${capitalize(name).slice(0, 3)}`
}

/** El último grado de cada nivel es el de mayor posición entre los cursos del año. */
function finalGradeEnrolled(byCourse: Trajectory['byCourse']): number {
  const last = new Map<string, number>()
  for (const row of byCourse) last.set(String(row.level), Math.max(last.get(String(row.level)) ?? 0, row.position))
  return byCourse.filter((row) => row.position === last.get(String(row.level))).reduce((acc, row) => acc + row.enrolled, 0)
}

export function trajectoryHeadline(total: Counts, byCourse: Trajectory['byCourse']) {
  const leftDuringYear = total.leftWithdrawn + total.leftTransferred
  return {
    enrolled: total.enrolled,
    promoted: total.promoted + total.promotedWithPending,
    promotedWithPending: total.promotedWithPending,
    repeated: total.repeated,
    graduated: total.graduated + total.graduatedWithPending,
    finalEnrolled: finalGradeEnrolled(byCourse),
    left: leftDuringYear + total.notReenrolled,
    leftDuringYear,
    notReenrolled: total.notReenrolled,
  }
}

/** «Ciclo 2026 todavía no terminó: se muestra Ciclo 2025.», cuando el año mirado no es el elegido. */
function focusNote(requested: { id: string; label: string } | null, focus: { id: string; label: string } | null, reason: string): string | null {
  if (!focus || !requested || requested.id === focus.id) return null
  return `${requested.label} ${reason}: se muestra ${focus.label}.`
}

const lowShare = (row: { low: number; graded: number }) => (row.graded > 0 ? row.low / row.graded : -1)

/** Por curso, las materias con alguna nota baja, de más a menos (como la pantalla, pero todas). */
export function lowGradeRows(data: Pick<LowGradesResult, 'rows' | 'courses'>) {
  return data.courses.flatMap((course) =>
    data.rows
      .filter((row) => row.courseOfferingId === course.courseOfferingId && row.low > 0)
      .sort((a, b) => lowShare(b) - lowShare(a) || b.low - a.low || a.subjectName.localeCompare(b.subjectName, 'es')),
  )
}

// ─── Quién necesita atención ────────────────────────────────────────────────

const familyText = (families: readonly RiskFamily[]) => {
  if (families.length === 2) return 'Notas y faltas'
  return families[0] === 'NOTAS' ? 'Notas' : 'Faltas'
}

const RISK_COLUMNS: Column[] = [
  { header: 'Estudiante', weight: 2.2 },
  { header: 'Curso', weight: 1 },
  { header: 'Motivo', weight: 1.1 },
  { header: 'Materias bajas', kind: 'count' },
  { header: 'Cuáles', weight: 2.2 },
  { header: 'Debe de años anteriores', kind: 'count' },
  { header: 'Faltas del año', kind: 'decimal' },
  { header: 'Faltas seguidas que siguen (días)', kind: 'count' },
]

export function riskTable(rows: readonly RiskRow[]): TableBlock {
  return {
    kind: 'table',
    title: 'Quién necesita atención',
    sheet: 'Quién necesita atención',
    columns: RISK_COLUMNS,
    rows: rows.map((row) => [
      studentName(row),
      row.courseName,
      familyText(row.families),
      row.grades?.lowSubjects ?? null,
      row.grades?.subjects.join(', ') || null,
      row.carried,
      row.absenceHundredths / 100,
      row.streak?.days ?? null,
    ]),
    empty: 'Nadie necesita atención por ahora.',
  }
}

/** Qué boletín se usó para las notas de cada nivel, en una frase. */
function referenceText(risk: RiskResult): string {
  const names = risk.references.flatMap((ref) => (ref.period ? [ref.period.name] : []))
  if (names.length === 0) return 'Todavía no hay boletines con notas: por ahora sólo cuentan las faltas y las materias de años anteriores.'
  const rule = risk.threshold === null ? 'la regla de asignaturas en alerta está apagada' : `desde ${risk.threshold} materias bajas`
  return `Notas de ${names.join(' y ')} (${rule}), como en la reunión de profesores.`
}

function riskSection(risk: RiskResult): ReportSection {
  const c = risk.counts
  return {
    id: 'riesgo',
    title: 'Quién necesita atención',
    intro: `${referenceText(risk)} Faltas: desde las ${WARNING_ABSENCES / 100} del año, contadas como en el boletín, o 3 o más días seguidos que siguen. Es para saber a quién llamar o citar: no decide promociones ni sanciones.`,
    blocks: [
      { kind: 'note', lines: [`${formatShare(c.students, risk.enrolled)} estudiantes del ciclo · ${c.grades} por notas · ${c.absences} por faltas · ${c.both} por las dos.`] },
      riskTable(risk.rows),
    ],
  }
}

// ─── Resumen ────────────────────────────────────────────────────────────────

function riskTile(risk: RiskResult): Tile {
  const { counts, enrolled } = risk
  return {
    label: 'Necesitan atención',
    value: formatCount(counts.students),
    detail: `${formatShare(counts.students, enrolled)} estudiantes del ciclo. ${counts.grades} por notas, ${counts.absences} por faltas y ${counts.both} por las dos.`,
  }
}

function attendanceTile(trend: TrendResult): Tile {
  const label = 'Asistencia del año'
  const { total } = trend
  if (total.studentDays === 0) return { label, value: '—', detail: 'Todavía no hay listas pasadas en el ciclo.' }
  return {
    label,
    value: formatRatio(presentDays(total), total.studentDays),
    detail: `${formatCount(presentDays(total))} de ${formatCount(total.studentDays)} días con lista, sin falta. Llegar tarde cuenta como que vino.`,
  }
}

function lowSubjectsTile(dashboard: AcademicDashboard | null): Tile {
  const label = 'Con materias bajas en el boletín'
  if (!dashboard?.referencePeriod || dashboard.lowSubjects.graded === 0) return { label, value: '—', detail: 'Todavía no hay notas de boletín.' }
  const { lowSubjects, referencePeriod } = dashboard
  const withLow = lowSubjects.graded - lowSubjects.none
  return {
    label,
    value: formatRatio(withLow, lowSubjects.graded),
    detail: `${formatShare(withLow, lowSubjects.graded)} estudiantes con notas tienen al menos una materia baja en ${referencePeriod.name}.`,
  }
}

function promotionTile(trajectory: Trajectory): Tile {
  const label = 'Promoción del último año cerrado'
  if (!trajectory.focusYear) return { label, value: '—', detail: 'Todavía no terminó ningún ciclo.' }
  const h = trajectoryHeadline(trajectory.total, trajectory.byCourse)
  const passed = h.promoted + h.graduated
  return {
    label,
    value: formatRatio(passed, h.enrolled),
    detail: `${formatShare(passed, h.enrolled)} matriculados en ${trajectory.focusYear.label} promovieron o egresaron. ${h.repeated} repitieron y ${h.left} dejaron el liceo.`,
  }
}

function summarySection(data: StudentReportData): ReportSection {
  const tiles: Tile[] = []
  if (data.risk) tiles.push(riskTile(data.risk))
  if (data.trend) tiles.push(attendanceTile(data.trend))
  if (data.access.analytics) tiles.push(lowSubjectsTile(data.dashboard))
  if (data.trajectory) tiles.push(promotionTile(data.trajectory))
  const blocks: Block[] = [{ kind: 'tiles', tiles }]
  if (data.risk) {
    blocks.push({
      ...riskTable(data.risk.rows.slice(0, 5)),
      title: 'Para mirar primero',
      sheet: 'Para mirar primero',
      description: 'Quienes tienen a la vez notas y faltas para mirar, y después los casos más avanzados.',
      // La lista entera está en su sección (y en su hoja del Excel).
      pdfOnly: true,
    })
  }
  return { id: 'resumen', title: 'Resumen', blocks }
}

// ─── Rendimiento ────────────────────────────────────────────────────────────

type Bucket = AcademicDashboard['performance']['distribution'][number]

/** Los tramos en alerta, dichos en palabras: «Insuficiente o En proceso». */
const alertNames = (buckets: readonly Bucket[]) =>
  buckets
    .filter((b) => b.isAlert)
    .map((b) => b.label)
    .join(' o ')

function performanceTiles(d: AcademicDashboard): Tile[] {
  const { performance, referencePeriod } = d
  const low = performance.distribution.filter((b) => b.isAlert).reduce((acc, b) => acc + b.count, 0)
  const period = referencePeriod?.name ?? 'el boletín'
  return [
    { label: 'Promedio', value: formatHundredths(performance.averageHundredths, 1), detail: `De ${formatCount(performance.gradedCount)} notas (R) de ${period}.` },
    { label: 'Mediana', value: formatHundredths(performance.medianHundredths, 1), detail: 'La mitad de las notas está por debajo y la mitad por encima.' },
    {
      label: 'Notas bajas',
      value: formatRatio(low, performance.gradedCount),
      detail: `${formatCount(low)} de ${formatCount(performance.gradedCount)} notas en ${alertNames(performance.distribution) || 'tramo de alerta'}.`,
    },
  ]
}

function lowSubjectsBlock(d: AcademicDashboard): Block {
  const title = 'Estudiantes según sus materias bajas'
  const h = d.lowSubjects
  if (h.graded === 0) return { kind: 'note', title, lines: ['Todavía no hay notas de boletín.'] }
  const threshold = d.rules?.find((rule) => rule.type === 'ALERT_SUBJECTS')?.threshold ?? null
  const atRisk = (count: number) => threshold !== null && count >= threshold
  return {
    kind: 'parts',
    title,
    description:
      threshold === null
        ? 'Cuántas materias tiene bajas cada estudiante en el boletín. La regla de asignaturas en alerta está apagada.'
        : `Cuántas materias tiene bajas cada estudiante en el boletín. Desde ${threshold} la reunión lo marca en riesgo.`,
    parts: [
      { label: 'Ninguna', value: h.none },
      { label: '1 materia', value: h.one, alert: atRisk(1) },
      { label: '2 materias', value: h.two, alert: atRisk(2) },
      { label: '3 o más', value: h.threeOrMore, alert: atRisk(3) },
    ],
  }
}

function evolutionParts(students: AcademicDashboard['students']): Part[] {
  return [
    { label: 'Subieron', value: students.improved },
    { label: 'Igual', value: Math.max(0, students.compared - students.improved - students.declined) },
    { label: 'Bajaron', value: students.declined },
    { label: 'Sin comparación', value: Math.max(0, students.total - students.compared), muted: true },
  ]
}

function dropsTable(drops: DropsResult): TableBlock {
  return {
    kind: 'table',
    title: 'Quiénes bajaron en alguna materia respecto del boletín anterior',
    sheet: 'Bajaron',
    columns: [
      { header: 'Estudiante', weight: 2.4 },
      { header: 'Curso', weight: 1.2 },
      { header: 'Materia', weight: 2 },
      { header: drops.previous?.name ?? 'Boletín anterior', kind: 'decimal' },
      { header: drops.period.name, kind: 'decimal' },
    ],
    rows: drops.rows.map((row) => [studentName(row), row.courseName, row.subjectName, gradeUnits(row.previous), gradeUnits(row.current)]),
    empty: drops.previous ? `Nadie bajó respecto de ${drops.previous.name}.` : 'Es el primer boletín: no hay uno anterior con qué comparar.',
  }
}

const DIMENSION_TITLES: Record<ComparisonDimension, { title: string; sheet: string; description: string }> = {
  SUBJECT: { title: 'Comparar por asignatura', sheet: 'Comparar por asignatura', description: 'Notas bajas de cada asignatura sobre sus notas del boletín, de más a menos.' },
  COURSE: { title: 'Comparar por curso', sheet: 'Comparar por curso', description: 'Notas bajas de cada curso sobre sus notas del boletín, de más a menos.' },
  YEAR: { title: 'Comparar por año lectivo', sheet: 'Comparar por año', description: 'El mismo boletín en cada ciclo.' },
}

export function comparisonTable(dimension: ComparisonDimension, comparison: AcademicComparison | undefined): TableBlock {
  const rows = [...(comparison?.data ?? [])].sort(
    (a, b) => (ratioValue(b.alertCount, b.gradedCount) ?? -1) - (ratioValue(a.alertCount, a.gradedCount) ?? -1),
  )
  return {
    kind: 'table',
    ...DIMENSION_TITLES[dimension],
    columns: [
      { header: dimension === 'YEAR' ? 'Ciclo' : 'Grupo', weight: 2.4 },
      { header: 'Notas bajas', kind: 'share' },
      { header: 'Promedio', kind: 'decimal', fixed: true },
      { header: 'Mediana', kind: 'decimal', fixed: true },
      { header: 'Estudiantes', kind: 'count' },
    ],
    rows: rows.map((row) => [row.label, share(row.alertCount, row.gradedCount), units(row.averageHundredths), units(row.medianHundredths), row.studentCount]),
    empty: 'No hay notas de boletín para comparar.',
  }
}

function performanceSection(data: StudentReportData): ReportSection {
  const section = {
    id: 'rendimiento',
    title: 'Rendimiento',
    intro: 'Las notas (R) del boletín elegido: cómo se reparten, quiénes tienen materias bajas y cómo evolucionan.',
  }
  const d = data.dashboard
  if (!d?.referencePeriod || d.performance.gradedCount === 0) {
    return { ...section, blocks: [{ kind: 'note', lines: ['Todavía no hay notas de boletín en este ciclo.'] }] }
  }
  const blocks: Block[] = [
    { kind: 'tiles', tiles: performanceTiles(d) },
    {
      kind: 'parts',
      title: 'Distribución de las notas',
      description: `Cada nota (R) del boletín según el tramo de la escala${d.scale ? ` (${d.scale.name})` : ''}.`,
      parts: d.performance.distribution.map((b) => ({ label: b.label, value: b.count, alert: b.isAlert })),
    },
    lowSubjectsBlock(d),
    {
      kind: 'parts',
      title: 'Evolución desde el primer boletín',
      description: 'El promedio de cada estudiante en cada boletín hasta el elegido. Sin comparación: tiene un solo boletín con notas.',
      parts: evolutionParts(d.students),
    },
  ]
  if (data.drops) blocks.push(dropsTable(data.drops))
  for (const dimension of ['SUBJECT', 'COURSE', 'YEAR'] as const) blocks.push(comparisonTable(dimension, data.comparisons?.[dimension]))
  blocks.push({ kind: 'note', title: 'Sobre estos indicadores', lines: [d.disclaimer] })
  return { ...section, blocks }
}

// ─── Materias y APE ─────────────────────────────────────────────────────────

function lowGradesBlocks(data: StudentReportData): Block[] {
  const title = 'Materias con más notas bajas, por curso'
  if (!data.period) return [{ kind: 'note', title, lines: ['El ciclo todavía no tiene boletines.'] }]
  const low = data.lowGrades
  if (!low || low.rows.length === 0) return [{ kind: 'note', title, lines: ['No hay libretas para este boletín.'] }]
  return [
    {
      kind: 'table',
      title: 'Estudiantes con alguna materia baja, por curso',
      sheet: 'Notas bajas por curso',
      columns: [{ header: 'Curso', weight: 2 }, { header: 'Con alguna materia baja', kind: 'share' }],
      rows: low.courses.map((course) => [course.courseName, share(course.low, course.graded)]),
      empty: 'No hay notas en este boletín.',
    },
    {
      kind: 'table',
      title,
      sheet: 'Notas bajas por materia',
      description: 'Estudiantes con nota baja (tramo de alerta de la escala) sobre los que ya tienen la R de esa materia en el boletín.',
      columns: [
        { header: 'Curso', weight: 1.2 },
        { header: 'Materia', weight: 2.2 },
        { header: 'Orientación', weight: 1.4 },
        { header: 'Con nota baja', kind: 'share' },
        { header: 'Sin R todavía', kind: 'count' },
      ],
      rows: lowGradeRows(low).map((row) => [row.courseName, row.subjectName, row.orientationName, share(row.low, row.graded), row.pending]),
      empty: 'Ninguna materia tiene notas bajas en este boletín.',
    },
  ]
}

type ApeCounts = { referred: number; december: number; february: number; previa: number; owed: number }

function apeTotals(ape: ApeResult): ApeCounts {
  const totals: ApeCounts = { referred: 0, december: 0, february: 0, previa: 0, owed: 0 }
  const keys = Object.keys(totals) as (keyof ApeCounts)[]
  for (const row of ape.byCourse as readonly ApeCounts[]) {
    for (const key of keys) totals[key] += row[key]
  }
  return totals
}

function apeBlocks(ape: ApeResult): Block[] {
  if (!ape.focusYear) return [{ kind: 'note', title: 'Materias que fueron a APE', lines: ['Todavía no hay materias perdidas registradas en ningún ciclo.'] }]
  const totals = apeTotals(ape)
  const s = ape.students
  const note = focusNote(ape.requestedYear, ape.focusYear, 'todavía no tiene materias que hayan ido a APE')
  const blocks: Block[] = note ? [{ kind: 'note', lines: [note] }] : []
  blocks.push(
    {
      kind: 'tiles',
      tiles: [
        { label: 'Estudiantes que fueron a APE', value: formatCount(s.referred), detail: `Con ${formatCount(totals.referred)} materias perdidas en total.` },
        { label: 'Salvaron todo antes de marzo', value: formatCount(s.clearedByFebruary), detail: `${formatShare(s.clearedByFebruary, s.referred)} de los que fueron.` },
        { label: 'Siguen debiendo', value: formatCount(s.stillOwing), detail: `${formatShare(s.stillOwing, s.referred)}; ${s.clearedLater} salvaron después, como previa.` },
      ],
    },
    {
      kind: 'parts',
      title: `Qué pasó con las materias que fueron a APE (${ape.focusYear.label})`,
      description: 'Las materias que cada estudiante perdió al cerrar el año: si las salvó en la APE de diciembre, en la de febrero, después como previa, o si todavía las debe.',
      parts: [
        { label: 'Salvó en diciembre', value: totals.december },
        { label: 'Salvó en febrero', value: totals.february },
        { label: 'Salvó después, como previa', value: totals.previa },
        { label: 'Todavía la debe', value: totals.owed, alert: totals.owed > 0 },
      ],
    },
    {
      kind: 'table',
      title: 'Materias que fueron a APE, por curso',
      sheet: 'APE',
      columns: [
        { header: 'Curso', weight: 1.2 },
        { header: 'Materia', weight: 2.2 },
        { header: 'Fueron a APE', kind: 'count' },
        { header: 'Diciembre', kind: 'count' },
        { header: 'Febrero', kind: 'count' },
        { header: 'Después', kind: 'count' },
        { header: 'La deben', kind: 'count' },
      ],
      rows: ape.rows.map((row) => [row.courseName, row.subjectName, row.referred, row.december, row.february, row.previa, row.owed]),
      empty: 'No hay materias que hayan ido a APE.',
    },
  )
  return blocks
}

function carriedNote(ape: ApeResult): Block {
  const { carriedOver } = ape
  const line =
    carriedOver.students === 0
      ? 'Nadie empezó el ciclo debiendo materias.'
      : `${formatCount(carriedOver.students)} estudiantes empezaron el ciclo debiendo ${formatCount(carriedOver.subjects)} materias. Están en «Quién necesita atención».`
  return { kind: 'note', title: 'Materias de años anteriores', lines: [line] }
}

function subjectsSection(data: StudentReportData): ReportSection {
  const blocks = lowGradesBlocks(data)
  if (data.subjectsApe) blocks.push(...apeBlocks(data.subjectsApe), carriedNote(data.subjectsApe))
  return {
    id: 'materias',
    title: 'Materias y APE',
    intro: 'Dónde se concentran las notas bajas del boletín, y qué pasó con las materias que se perdieron.',
    blocks,
  }
}

// ─── Asistencia ─────────────────────────────────────────────────────────────

function attendanceTiles(data: StudentReportData, total: DayCounts): Tile[] {
  const thresholds = data.thresholds ?? []
  const over25 = thresholds.filter((row) => row.absenceHundredths >= CRITICAL_ABSENCES).length
  const openStreaks = new Set((data.streaks ?? []).filter((row) => row.open).map((row) => row.studentId)).size
  const enrolled = data.risk ? `${formatShare(thresholds.length, data.risk.enrolled)} estudiantes del ciclo. ` : ''
  return [
    {
      label: 'Asistencia del año',
      value: formatRatio(presentDays(total), total.studentDays),
      detail: `${formatCount(presentDays(total))} de ${formatCount(total.studentDays)} días con lista, sin falta.`,
    },
    {
      label: 'Faltas justificadas',
      value: formatRatio(total.justifiedDays, total.absentDays),
      detail: `${formatCount(total.justifiedDays)} de ${formatCount(total.absentDays)} días con falta tenían justificativo.`,
    },
    {
      label: 'Llegadas tarde',
      value: formatCount(total.lateDays),
      detail: `En ${formatRatio(total.lateDays, total.studentDays)} de los días con lista. Cuentan como que vino.`,
    },
    { label: `${WARNING_ABSENCES / 100} faltas o más`, value: formatCount(thresholds.length), detail: `${enrolled}${over25} con ${CRITICAL_ABSENCES / 100} o más.` },
    {
      label: 'Faltas seguidas que siguen',
      value: formatCount(openStreaks),
      detail: 'Estudiantes con 3 o más días de clase seguidos con falta, que todavía no volvieron.',
    },
  ]
}

/** Las barras de cada mes; el eje arranca un poco debajo del mes más bajo, como la pantalla. */
function monthlyBars(trend: TrendResult): Block {
  const rates = trend.total.months.map(attendanceRate)
  const known = rates.filter((value): value is number => value !== null)
  const floor = Math.max(0, Math.floor((Math.min(...known, 100) - 2) / 5) * 5)
  return {
    kind: 'bars',
    title: 'Asistencia por mes',
    description: 'Días con lista sin falta, sobre los días con lista de cada mes.',
    bars: trend.total.months.map((month, i) => ({ label: monthLabel(month.month), value: rates[i], text: rates[i] === null ? '—' : formatPercent(rates[i] as number) })),
    min: floor,
    max: 100,
    axis: floor > 0 ? `La escala va de ${floor} % a 100 %.` : undefined,
  }
}

function monthlyTable(trend: TrendResult): TableBlock {
  return {
    kind: 'table',
    title: 'Asistencia y días con falta por mes',
    sheet: 'Asistencia por mes',
    columns: [
      { header: 'Mes', weight: 1.2 },
      { header: 'Asistencia', kind: 'share' },
      { header: 'Días sin justificar', kind: 'count' },
      { header: 'Días justificados', kind: 'count' },
      { header: 'Llegadas tarde', kind: 'count' },
      { header: 'Días con lista', kind: 'count' },
    ],
    rows: trend.total.months.map((m) => [
      capitalize(monthName(m.month)),
      share(presentDays(m), m.studentDays),
      m.absentDays - m.justifiedDays,
      m.justifiedDays,
      m.lateDays,
      m.studentDays,
    ]),
    empty: 'Todavía no hay listas pasadas en el ciclo.',
  }
}

function courseMonthTable(trend: TrendResult): TableBlock {
  return {
    kind: 'table',
    title: 'Asistencia por curso y mes',
    sheet: 'Asistencia por curso',
    description: 'Cada celda: días con lista sin falta, sobre los días con lista del curso ese mes.',
    columns: [{ header: 'Curso', weight: 2 }, ...trend.months.map((month): Column => ({ header: monthLabel(month), kind: 'percent' })), { header: 'Año', kind: 'percent' }],
    rows: trend.byCourse.map((course) => [
      course.courseName,
      ...course.months.map((m) => share(presentDays(m), m.studentDays)),
      share(presentDays(course.total), course.total.studentDays),
    ]),
    empty: 'Todavía no hay listas pasadas en el ciclo.',
  }
}

function streaksTable(rows: readonly AbsenceStreakRow[]): TableBlock {
  return {
    kind: 'table',
    title: 'Faltas seguidas',
    sheet: 'Faltas seguidas',
    description: '3 o más días de clase con falta entera sin justificar (fines de semana y feriados no cortan la racha).',
    columns: [
      { header: 'Estudiante', weight: 2.4 },
      { header: 'Curso', weight: 1.2 },
      { header: 'Desde', weight: 0.8 },
      { header: 'Hasta', weight: 0.8 },
      { header: 'Días', kind: 'count' },
      { header: 'Estado', weight: 1.2 },
    ],
    rows: rows.map((row) => [studentName(row), row.courseName, formatShortYmd(row.from), formatShortYmd(row.to), row.days, row.open ? 'Sigue faltando' : 'Cortada']),
    empty: 'Nadie tiene 3 o más días seguidos con falta sin justificar.',
  }
}

function thresholdsTable(rows: readonly AbsenceThresholdRow[]): TableBlock {
  return {
    kind: 'table',
    title: `${WARNING_ABSENCES / 100} y ${CRITICAL_ABSENCES / 100} faltas`,
    sheet: `${WARNING_ABSENCES / 100} y ${CRITICAL_ABSENCES / 100} faltas`,
    description: 'El total del año, contado como en el boletín.',
    columns: [
      { header: 'Estudiante', weight: 2.4 },
      { header: 'Curso', weight: 1.2 },
      { header: 'Faltas del año', kind: 'decimal' },
      { header: 'Umbral', weight: 1.2 },
    ],
    rows: rows.map((row) => [
      studentName(row),
      row.courseName,
      row.absenceHundredths / 100,
      `Pasó las ${absencesText(row.absenceHundredths >= CRITICAL_ABSENCES ? CRITICAL_ABSENCES : WARNING_ABSENCES)}`,
    ]),
    empty: `Nadie llegó a ${WARNING_ABSENCES / 100} faltas.`,
  }
}

function attendanceSection(data: StudentReportData): ReportSection {
  const trend = data.trend
  const blocks: Block[] = []
  if (!trend || trend.total.studentDays === 0) blocks.push({ kind: 'note', lines: ['Todavía no hay listas pasadas en el ciclo.'] })
  else blocks.push({ kind: 'tiles', tiles: attendanceTiles(data, trend.total) }, monthlyBars(trend), monthlyTable(trend), courseMonthTable(trend))
  blocks.push(streaksTable(data.streaks ?? []), thresholdsTable(data.thresholds ?? []))
  return {
    id: 'asistencia',
    title: 'Asistencia',
    intro: 'Contada por día como el boletín: faltar a una clase es faltar el día, y llegar tarde es que vino. Sólo cuentan las listas pasadas.',
    blocks,
  }
}

// ─── Trayectoria ────────────────────────────────────────────────────────────

function trajectoryTiles(t: Trajectory): Tile[] {
  const h = trajectoryHeadline(t.total, t.byCourse)
  return [
    { label: 'Promovieron', value: formatRatio(h.promoted, h.enrolled), detail: `${formatShare(h.promoted, h.enrolled)} matriculados; ${h.promotedWithPending} con materias pendientes.` },
    { label: 'Repitieron', value: formatRatio(h.repeated, h.enrolled), detail: `${formatShare(h.repeated, h.enrolled)} matriculados.` },
    { label: 'Egresaron', value: formatRatio(h.graduated, h.finalEnrolled), detail: `${formatShare(h.graduated, h.finalEnrolled)} matriculados en el último grado.` },
    {
      label: 'Dejaron el liceo',
      value: formatRatio(h.left, h.enrolled),
      detail: `${formatShare(h.left, h.enrolled)} matriculados: ${h.leftDuringYear} en el año y ${h.notReenrolled} que no se reinscribieron.`,
    },
  ]
}

function outcomeParts(c: Counts): Part[] {
  return [
    { label: 'Promovieron', value: c.promoted + c.promotedWithPending },
    { label: 'Repitieron', value: c.repeated },
    { label: 'Egresaron', value: c.graduated + c.graduatedWithPending },
    { label: 'Se fueron en el año', value: c.leftWithdrawn + c.leftTransferred },
    { label: 'Sin fallo o cursando', value: c.pendingApe + c.noResult + c.inProgress, muted: true },
  ]
}

const OUTCOME_COLUMNS: Column[] = [
  { header: 'Matriculados', kind: 'count' },
  { header: 'Promovieron', kind: 'count' },
  { header: 'Repitieron', kind: 'count' },
  { header: 'Egresaron', kind: 'count' },
  { header: 'Se fueron en el año', kind: 'count' },
  { header: 'Sin fallo o cursando', kind: 'count' },
  { header: 'No se reinscribieron', kind: 'count' },
]

const outcomeCells = (c: Counts) => [
  c.enrolled,
  c.promoted + c.promotedWithPending,
  c.repeated,
  c.graduated + c.graduatedWithPending,
  c.leftWithdrawn + c.leftTransferred,
  c.pendingApe + c.noResult + c.inProgress,
  c.notReenrolled,
]

/** «Ingreso 2023 (ciclo básico)». */
export function cohortLabel(cohort: Pick<Cohort, 'entryYear' | 'level'>): string {
  const level = cohort.level ? LEVEL_NAMES[cohort.level] : undefined
  return level ? `Ingreso ${cohort.entryYear} (${level})` : `Ingreso ${cohort.entryYear}`
}

function trajectoryTables(t: Trajectory): TableBlock[] {
  return [
    {
      kind: 'table',
      title: 'Año a año',
      sheet: 'Año a año',
      description: 'Cada ciclo con datos. El ciclo en curso todavía no tiene fallo.',
      columns: [{ header: 'Ciclo', weight: 1.4 }, ...OUTCOME_COLUMNS.slice(0, 5), { header: 'No se reinscribieron', kind: 'count' }, { header: 'Cursando', kind: 'count' }],
      rows: t.byYear.map((y) => [y.label, ...outcomeCells(y).slice(0, 5), y.notReenrolled, y.inProgress]),
      empty: 'No hay ciclos con datos.',
    },
    {
      kind: 'table',
      title: 'Qué pasó con cada generación',
      sheet: 'Generaciones',
      description: 'Quienes entraron al primer grado del nivel cada año, seguidos hasta hoy. En tiempo: sin repetir. Los que entraron por pase a otro grado no forman generación.',
      columns: [
        { header: 'Generación', weight: 2.2 },
        { header: 'Entraron', kind: 'count' },
        { header: 'Egresaron en tiempo', kind: 'count' },
        { header: 'Egresaron con atraso', kind: 'count' },
        { header: 'Siguen en tiempo', kind: 'count' },
        { header: 'Siguen atrasados', kind: 'count' },
        { header: 'Dejaron el liceo', kind: 'count' },
        { header: 'Sin dato', kind: 'count' },
      ],
      rows: t.cohorts.map((c) => [cohortLabel(c), c.entrants, c.graduatedOnTime, c.graduatedLate, c.onTrack, c.behind, c.left, c.unknown]),
      empty: 'Todavía no hay generaciones para seguir.',
    },
  ]
}

function trajectorySection(t: Trajectory): ReportSection {
  const blocks: Block[] = []
  if (t.focusYear) {
    const note = focusNote(t.requestedYear, t.focusYear, 'todavía no terminó')
    blocks.push(
      { kind: 'note', lines: [`Cómo terminó ${t.focusYear.label}.${note ? ` ${note}` : ''}`] },
      { kind: 'tiles', tiles: trajectoryTiles(t) },
      {
        kind: 'parts',
        title: 'Cómo terminó el año',
        description: 'El fallo de cada estudiante: el que se cargó o, si falta, el que muestra su matrícula del año siguiente (mismo grado es que repitió).',
        parts: outcomeParts(t.total),
      },
      {
        kind: 'table',
        title: 'Cómo terminó el año, por curso',
        sheet: 'Trayectoria por curso',
        columns: [{ header: 'Curso', weight: 1.6 }, ...OUTCOME_COLUMNS],
        rows: t.byCourse.map((row) => [row.courseName, ...outcomeCells(row)]),
        empty: 'No hay cursos con matrícula en ese ciclo.',
      },
    )
  } else {
    blocks.push({ kind: 'note', lines: ['Todavía no terminó ningún ciclo: la trayectoria aparece cuando cierra el primero.'] })
  }
  const [byYear, cohorts] = trajectoryTables(t)
  if (t.byYear.length > 0) blocks.push(byYear)
  blocks.push(cohorts)
  return {
    id: 'trayectoria',
    title: 'Trayectoria',
    intro: 'Promoción, repetición, egreso y desvinculación del último año cerrado, año a año y por generación.',
    blocks,
  }
}

// ─── Informe ────────────────────────────────────────────────────────────────

function periodText(period: ReportPeriod): string {
  const level = period.level ? LEVEL_NAMES[period.level] : undefined
  return level ? `${period.name} (${level})` : period.name
}

export function buildStudentReport(data: StudentReportData): ReportDoc {
  const { access, year, period } = data
  const sections: ReportSection[] = [summarySection(data)]
  if (access.analytics) sections.push(performanceSection(data))
  if (access.reports) sections.push(subjectsSection(data), attendanceSection(data))
  if (access.analytics && data.trajectory) sections.push(trajectorySection(data.trajectory))
  if (access.reports && data.risk) sections.push(riskSection(data.risk))
  return {
    title: 'Indicadores de estudiantes',
    subtitle: period ? `${year.label} · notas (R) de ${period.name}` : year.label,
    filters: [
      `Ciclo lectivo: ${year.label}`,
      period ? `Boletín de referencia: ${periodText(period)}` : 'Boletín de referencia: el ciclo todavía no tiene boletines',
    ],
    sections,
    filename: `Indicadores de estudiantes ${year.label}${period ? ` - ${period.name}` : ''}`,
    generatedAt: data.generatedAt,
  }
}
