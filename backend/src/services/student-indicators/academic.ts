import { z } from 'zod'
import { compareCodeUnits } from '../../lib/strings.js'
import { prisma } from '../../db/prisma.js'
import { loadRosterForScope } from '../student-attendance/roster.js'
import { isReportCardPeriod, officialPeriodValue } from '../gradebook/period-closure.js'
import { alertRulesForYear } from '../gradebook/alert-rules.js'
import { periodScaleFor } from '../gradebook/period-scale.js'
import { gradeBooksForGroup } from '../gradebook/institutional.js'
import {
  buildComparison,
  lowSubjectsHistogram,
  performanceBlock,
  referencePeriod,
  studentSnapshots,
  studentsBlock,
  valuesAt,
  type AnalyticsPeriod,
  type AnalyticsState,
  type ComparisonRow,
  type LevelRow,
} from '../gradebook/analytics.js'

/**
 * Rendimiento de "Indicadores de estudiantes": el tablero y las comparaciones de las notas (R) de
 * una reunión. Los usan `/admin/academic-analytics` (la pantalla) y el informe descargable, así
 * dicen lo mismo.
 *
 * Todo se mira **por nivel** y contra **una reunión**: ciclo básico califica de 1 a 10 y
 * bachillerato de 1 a 12, así que un promedio que los junta no significa nada, y un promedio que
 * junta el diagnóstico con febrero tampoco.
 */

export const academicFiltersSchema = z.object({
  schoolYearId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  level: z.enum(['EBI', 'EMS']).optional(),
  courseOfferingId: z.string().uuid().optional(),
  courseOrientationId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
})

export type AcademicFilters = z.infer<typeof academicFiltersSchema>
export type Level = 'EBI' | 'EMS'
export type ComparisonDimension = 'YEAR' | 'COURSE' | 'SUBJECT'

export const ACADEMIC_DISCLAIMER =
  'Las alertas tienen finalidad informativa y de apoyo a la intervención pedagógica. No generan ' +
  'automáticamente decisiones administrativas, promociones, repeticiones ni sanciones. Los indicadores ' +
  'de gestión no constituyen por sí solos un mecanismo de evaluación del desempeño docente.'

/** Con los dos niveles en los datos hay que elegir uno: devuelve cuáles hay. */
export type Ambiguous = { ambiguous: string[] }

type LevelPick = { level: Level | null; ambiguous?: string[] }

/**
 * Nivel de los indicadores: el pedido, o el único que aparece en los datos. Con los dos niveles
 * hay que elegir: promediar notas de 1 a 10 con notas de 1 a 12 no dice nada.
 */
export function pickLevel(requested: Level | undefined, available: Iterable<string | null | undefined>): LevelPick {
  if (requested) return { level: requested }
  const levels = [...new Set([...available].filter((l): l is string => Boolean(l)))].sort(compareCodeUnits)
  if (levels.length > 1) return { level: null, ambiguous: levels }
  return { level: (levels[0] as Level | undefined) ?? null }
}

/** Escala del nivel para tramos y alertas: la misma con la que se ponen C y R. */
export async function scaleFor(level: Level | null) {
  if (!level) return { levels: [] as LevelRow[], scale: null }
  const scale = await periodScaleFor(level)
  return {
    levels: (scale?.levels ?? []) as LevelRow[],
    scale: scale
      ? {
          name: scale.name,
          minValueHundredths: scale.minValueHundredths,
          maxValueHundredths: scale.maxValueHundredths,
          decimals: scale.decimals,
        }
      : null,
  }
}

const GRADEBOOK_INCLUDE = {
  subject: { select: { id: true, name: true } },
  courseOffering: { include: { course: { select: { id: true, name: true, level: true } } } },
}

/**
 * Libretas del filtro. Con un grupo elegido son las de su orientación más las de tronco común,
 * igual que en la reunión: filtrar sólo por la orientación dejaba afuera media matriz.
 */
async function loadGradeBooks(filters: AcademicFilters, schoolYearId: string) {
  const rows = await prisma.gradeBook.findMany({
    where: {
      schoolYearId,
      ...(filters.courseOfferingId ? { courseOfferingId: filters.courseOfferingId } : {}),
      ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
      ...(filters.level ? { courseOffering: { course: { level: filters.level } } } : {}),
    } as never,
    include: GRADEBOOK_INCLUDE,
  })
  if (!filters.courseOfferingId || !filters.courseOrientationId) return rows
  return gradeBooksForGroup(rows, {
    courseOfferingId: filters.courseOfferingId,
    courseOrientationId: filters.courseOrientationId,
    orientationId: null,
  })
}

/** Con un grupo elegido cuentan sólo sus alumnos: una libreta de tronco común trae a todo el curso. */
async function groupRoster(filters: AcademicFilters, schoolYearId: string): Promise<Set<string> | null> {
  if (!filters.courseOfferingId) return null
  const roster = await loadRosterForScope({
    schoolYearId,
    courseOfferingId: filters.courseOfferingId,
    courseOrientationId: filters.courseOrientationId ?? null,
    orientationId: null,
  })
  return new Set(roster.map((s) => s.studentId))
}

const PERIOD_SELECT = {
  id: true,
  name: true,
  sortOrder: true,
  isMeeting: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
} as const

type PeriodRow = { id: string; name: string; sortOrder: number; isMeeting: boolean; requiresGeneralGrade: boolean; requiresConceptualJudgement: boolean }

/** El período como lo usa la analítica: si es boletín decide la reunión por defecto. */
function analyticsPeriod(period: PeriodRow): AnalyticsPeriod {
  return { id: period.id, name: period.name, sortOrder: period.sortOrder, reportCard: isReportCardPeriod(period) }
}

/** Los períodos con reunión de las libretas, con la nota oficial (R) ya resuelta. */
async function loadMeetingStates(gradeBookIds: readonly string[], rosterIds: ReadonlySet<string> | null): Promise<AnalyticsState[]> {
  if (gradeBookIds.length === 0) return []
  const rows = await prisma.gradeBookPeriod.findMany({
    where: { gradeBookId: { in: [...gradeBookIds] }, period: { isMeeting: true } },
    include: { grades: true, period: { select: PERIOD_SELECT } },
  })
  return rows.map((row) => ({
    gradeBookId: row.gradeBookId,
    period: analyticsPeriod(row.period),
    grades: row.grades
      .filter((grade) => !rosterIds || rosterIds.has(grade.studentId))
      .map((grade) => ({
        studentId: grade.studentId,
        lastName: grade.studentLastName,
        firstName: grade.studentFirstName,
        value: officialPeriodValue(grade),
      })),
  }))
}

/** La reunión pedida aunque ninguna libreta la haya abierto todavía: se rotula igual. */
async function periodById(periodId: string | undefined): Promise<AnalyticsPeriod | null> {
  if (!periodId) return null
  const period = await prisma.academicPeriod.findUnique({ where: { id: periodId }, select: PERIOD_SELECT })
  return period ? analyticsPeriod(period) : null
}

/** Evaluaciones de cada libreta hasta la reunión de referencia: las de los tramos que la preceden. */
async function assessmentCounts(gradeBookIds: readonly string[], reference: AnalyticsPeriod | null) {
  if (gradeBookIds.length === 0) return new Map<string, number>()
  const rows = await prisma.assessment.groupBy({
    by: ['gradeBookId'],
    where: {
      gradeBookId: { in: [...gradeBookIds] },
      deletedAt: null,
      ...(reference ? { period: { sortOrder: { lte: reference.sortOrder } } } : {}),
    },
    _count: { _all: true },
  })
  return new Map(rows.map((row) => [row.gradeBookId, row._count._all]))
}

export type Snapshot = {
  level: Level | null
  books: Array<Awaited<ReturnType<typeof loadGradeBooks>>[number]>
  states: AnalyticsState[]
  reference: AnalyticsPeriod | null
  rosterIds: Set<string> | null
}

/** Libretas del nivel, sus reuniones y la reunión de referencia; o los niveles para elegir. */
export async function loadSnapshot(filters: AcademicFilters, schoolYearId: string): Promise<Snapshot | Ambiguous> {
  const allBooks = await loadGradeBooks(filters, schoolYearId)
  const pick = pickLevel(
    filters.level,
    allBooks.map((gb) => gb.courseOffering?.course?.level),
  )
  if (pick.ambiguous) return { ambiguous: pick.ambiguous }

  const books = pick.level ? allBooks.filter((gb) => gb.courseOffering?.course?.level === pick.level) : allBooks
  const rosterIds = await groupRoster(filters, schoolYearId)
  const states = await loadMeetingStates(
    books.map((b) => b.id),
    rosterIds,
  )
  const reference = referencePeriod(states, filters.periodId) ?? (await periodById(filters.periodId))
  return { level: pick.level, books, states, reference, rosterIds }
}

/** Tablero principal (§5.1): promedio, distribución por tramo, materias bajas y evolución. */
export async function loadAcademicDashboard(filters: AcademicFilters, schoolYearId: string) {
  const snapshot = await loadSnapshot(filters, schoolYearId)
  if ('ambiguous' in snapshot) return snapshot
  const { level, books, states, reference } = snapshot
  const ids = books.map((b) => b.id)

  const [{ levels, scale }, rules, assessments] = await Promise.all([scaleFor(level), alertRulesForYear(schoolYearId), assessmentCounts(ids, reference)])

  const students = studentSnapshots({
    states,
    subjectOf: new Map(books.map((b) => [b.id, b.subjectId])),
    reference,
    assessmentsOf: (bookIds) => [...bookIds].reduce((acc, id) => acc + (assessments.get(id) ?? 0), 0),
  })

  return {
    schoolYearId,
    level,
    scale,
    referencePeriod: reference ? { id: reference.id, name: reference.name } : null,
    students: studentsBlock(students, rules, levels),
    performance: performanceBlock(valuesAt(states, reference), levels),
    lowSubjects: lowSubjectsHistogram(students, levels),
    rules,
    disclaimer: ACADEMIC_DISCLAIMER,
  }
}

export type AcademicDashboard = Exclude<Awaited<ReturnType<typeof loadAcademicDashboard>>, Ambiguous>

// ─── Comparaciones ──────────────────────────────────────────────────────────

type ComparisonPeriod = { code: string; level: Level } | null

/**
 * Filtro de reunión de la comparativa. Entre años, la "1.ª Entrega" de cada ciclo es otro período
 * (otro id), así que se compara por código y nivel; dentro de un año, por el período mismo.
 */
export function comparisonPeriodWhere(dimension: string, periodId: string | undefined, period: ComparisonPeriod) {
  if (!periodId) return { isMeeting: true }
  if (dimension === 'YEAR' && period) return { isMeeting: true, code: period.code, level: period.level }
  return { isMeeting: true, id: periodId }
}

type ComparisonBook = {
  schoolYearId: string
  schoolYear: { label: string }
  subject: { id: string; name: string }
  courseOffering: { course: { id: string; name: string; level?: string | null } }
}

type ComparisonRowInput = {
  studentId: string
  meetingValueHundredths: number | null
  gradeBookPeriod: { gradeBook: ComparisonBook }
}

function bucketKey(dimension: string, book: ComparisonBook): [string, string] {
  if (dimension === 'YEAR') return [book.schoolYearId, book.schoolYear.label]
  if (dimension === 'COURSE') return [book.courseOffering.course.id, book.courseOffering.course.name]
  return [book.subject.id, book.subject.name]
}

async function comparisonPeriod(periodId: string | undefined): Promise<ComparisonPeriod> {
  if (!periodId) return null
  return (await prisma.academicPeriod.findUnique({ where: { id: periodId }, select: { code: true, level: true } })) as ComparisonPeriod
}

export type ComparisonParams = AcademicFilters & { dimension: ComparisonDimension; years: readonly string[] }

export type AcademicComparison = { dimension: ComparisonDimension; level: Level | null; data: ComparisonRow[] }

/** Comparativas por año, curso o asignatura (§5.3, §5.4, §5.5, RF-200), siempre dentro de un nivel. */
export async function loadAcademicComparison(params: ComparisonParams): Promise<AcademicComparison | Ambiguous> {
  const period = await comparisonPeriod(params.periodId)
  const requestedLevel = params.level ?? period?.level ?? undefined

  const rows = (await prisma.periodGrade.findMany({
    where: {
      meetingValueHundredths: { not: null },
      gradeBookPeriod: {
        period: comparisonPeriodWhere(params.dimension, params.periodId, period),
        gradeBook: {
          schoolYearId: { in: [...params.years] },
          ...(params.subjectId ? { subjectId: params.subjectId } : {}),
          ...(params.courseOfferingId ? { courseOfferingId: params.courseOfferingId } : {}),
          ...(requestedLevel ? { courseOffering: { course: { level: requestedLevel } } } : {}),
        },
      },
    },
    select: {
      studentId: true,
      meetingValueHundredths: true,
      gradeBookPeriod: {
        select: {
          gradeBook: {
            select: {
              schoolYearId: true,
              schoolYear: { select: { label: true } },
              subject: { select: { id: true, name: true } },
              courseOffering: { select: { course: { select: { id: true, name: true, level: true } } } },
            },
          },
        },
      },
    },
  })) as ComparisonRowInput[]

  const pick = pickLevel(
    requestedLevel,
    rows.map((row) => row.gradeBookPeriod.gradeBook.courseOffering.course.level),
  )
  if (pick.ambiguous) return { ambiguous: pick.ambiguous }
  const { levels } = await scaleFor(pick.level)

  const buckets = new Map<string, { label: string; values: number[]; students: Set<string> }>()
  for (const row of rows) {
    const [key, label] = bucketKey(params.dimension, row.gradeBookPeriod.gradeBook)
    const bucket = buckets.get(key) ?? { label, values: [], students: new Set<string>() }
    bucket.values.push(row.meetingValueHundredths!)
    bucket.students.add(row.studentId)
    buckets.set(key, bucket)
  }

  const comparison = buildComparison(
    [...buckets.entries()].map(([key, bucket]) => ({
      key,
      label: bucket.label,
      values: bucket.values,
      studentCount: bucket.students.size,
    })),
    levels,
  )

  return {
    dimension: params.dimension,
    level: pick.level,
    data: comparison.sort((a, b) => a.label.localeCompare(b.label, 'es')),
  }
}

