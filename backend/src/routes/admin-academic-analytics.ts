import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { loadRosterForScope } from '../services/student-attendance/roster.js'
import { officialPeriodValue } from '../services/gradebook/period-closure.js'
import { alertRulesForYear } from '../services/gradebook/alert-rules.js'
import { periodScaleFor } from '../services/gradebook/period-scale.js'
import { gradeBooksForGroup } from '../services/gradebook/institutional.js'
import {
  buildComparison,
  managementBlock,
  managementStates,
  performanceBlock,
  referencePeriod,
  studentSnapshots,
  studentsBlock,
  triggeredAlerts,
  valuesAt,
  type AnalyticsPeriod,
  type AnalyticsState,
  type LevelRow,
} from '../services/gradebook/analytics.js'

/**
 * Backoffice de inteligencia académica (§5).
 *
 * Montado bajo `/admin/academic-analytics` con `academic-analytics.read` de alcance ALL. Lee del
 * mismo esquema transaccional: a escala de un liceo no compensa el repositorio analítico aparte
 * que sugiere §5.10, y evita que un indicador quede desfasado del dato que lo originó.
 *
 * Todo se mira **por nivel** y contra **una reunión**: ciclo básico califica de 1 a 10 y
 * bachillerato de 1 a 12, así que un promedio que los junta no significa nada, y un promedio que
 * junta el diagnóstico con febrero tampoco.
 */

const r = Router()

const filtersSchema = z.object({
  schoolYearId: z.string().uuid().optional(),
  periodId: z.string().uuid().optional(),
  level: z.enum(['EBI', 'EMS']).optional(),
  courseOfferingId: z.string().uuid().optional(),
  courseOrientationId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
})

type Filters = z.infer<typeof filtersSchema>
type Level = 'EBI' | 'EMS'

const DISCLAIMER =
  'Las alertas tienen finalidad informativa y de apoyo a la intervención pedagógica. No generan ' +
  'automáticamente decisiones administrativas, promociones, repeticiones ni sanciones. Los indicadores ' +
  'de gestión no constituyen por sí solos un mecanismo de evaluación del desempeño docente.'

async function schoolYearOf(req: any, filters: Filters): Promise<string | null> {
  return filters.schoolYearId ?? resolveSchoolYearIdForList(prisma, { role: req.user?.role, requestedSchoolYearId: undefined })
}

type LevelPick = { level: Level | null; ambiguous?: string[] }

/**
 * Nivel de los indicadores: el pedido, o el único que aparece en los datos. Con los dos niveles
 * hay que elegir: promediar notas de 1 a 10 con notas de 1 a 12 no dice nada.
 */
export function pickLevel(requested: Level | undefined, available: Iterable<string | null | undefined>): LevelPick {
  if (requested) return { level: requested }
  const levels = [...new Set([...available].filter((l): l is string => Boolean(l)))].sort()
  if (levels.length > 1) return { level: null, ambiguous: levels }
  return { level: (levels[0] as Level | undefined) ?? null }
}

function levelRequired(res: any, levels: string[]) {
  return res.status(400).json({
    message: 'Elegí un nivel: ciclo básico (1 a 10) y bachillerato (1 a 12) no se promedian juntos.',
    code: 'LEVEL_REQUIRED',
    levels,
  })
}

/** Escala del nivel para tramos y alertas: la misma con la que se ponen C y R. */
async function scaleFor(level: Level | null) {
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
async function loadGradeBooks(filters: Filters, schoolYearId: string) {
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
async function groupRoster(filters: Filters, schoolYearId: string): Promise<Set<string> | null> {
  if (!filters.courseOfferingId) return null
  const roster = await loadRosterForScope({
    schoolYearId,
    courseOfferingId: filters.courseOfferingId,
    courseOrientationId: filters.courseOrientationId ?? null,
    orientationId: null,
  })
  return new Set(roster.map((s) => s.studentId))
}

/** Los períodos con reunión de las libretas, con la nota oficial (R) ya resuelta. */
async function loadMeetingStates(
  gradeBookIds: readonly string[],
  rosterIds: ReadonlySet<string> | null,
): Promise<AnalyticsState[]> {
  if (gradeBookIds.length === 0) return []
  const rows = await prisma.gradeBookPeriod.findMany({
    where: { gradeBookId: { in: [...gradeBookIds] }, period: { isMeeting: true } },
    include: {
      grades: true,
      endorsements: { where: { section: 'ALL' }, orderBy: { occurredAt: 'desc' }, take: 1 },
      period: { select: { id: true, name: true, sortOrder: true } },
    },
  })
  return rows.map((row) => ({
    gradeBookId: row.gradeBookId,
    status: row.status as AnalyticsState['status'],
    closedLate: row.closedLate,
    endorsed: row.endorsements[0]?.status === 'ENDORSED',
    period: row.period,
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
  return prisma.academicPeriod.findUnique({ where: { id: periodId }, select: { id: true, name: true, sortOrder: true } })
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

/** Cohorte de cada libreta, resuelta una vez por scope y no una por libreta. */
async function rosterSizes(gradeBooks: readonly any[]): Promise<Map<string, number>> {
  const byScope = new Map<string, string[]>()
  for (const gb of gradeBooks) {
    const key = `${gb.schoolYearId}|${gb.courseOfferingId}|${gb.orientationId ?? ''}|${gb.courseOrientationId ?? ''}`
    byScope.set(key, [...(byScope.get(key) ?? []), gb.id])
  }

  const sizes = new Map<string, number>()
  for (const [key, gradeBookIds] of byScope) {
    const [schoolYearId, courseOfferingId, orientationId, courseOrientationId] = key.split('|')
    const roster = await loadRosterForScope({
      schoolYearId,
      courseOfferingId,
      orientationId: orientationId || null,
      courseOrientationId: courseOrientationId || null,
    })
    for (const id of gradeBookIds) sizes.set(id, roster.length)
  }
  return sizes
}

type Snapshot = {
  level: Level | null
  books: Array<Awaited<ReturnType<typeof loadGradeBooks>>[number]>
  states: AnalyticsState[]
  reference: AnalyticsPeriod | null
  rosterIds: Set<string> | null
}

/** Libretas del nivel, sus reuniones y la reunión de referencia; o los niveles para elegir. */
async function loadSnapshot(filters: Filters, schoolYearId: string): Promise<Snapshot | { ambiguous: string[] }> {
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

/** Dashboard principal (§5.1). */
r.get('/dashboard', async (req: any, res) => {
  const parsed = filtersSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const schoolYearId = await schoolYearOf(req, parsed.data)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const snapshot = await loadSnapshot(parsed.data, schoolYearId)
    if ('ambiguous' in snapshot) return levelRequired(res, snapshot.ambiguous)
    const { level, books, states, reference, rosterIds } = snapshot
    const ids = books.map((b) => b.id)

    const [{ levels, scale }, rules, assessments, sizes] = await Promise.all([
      scaleFor(level),
      alertRulesForYear(schoolYearId),
      assessmentCounts(ids, reference),
      rosterIds ? Promise.resolve(null) : rosterSizes(books),
    ])

    const students = studentSnapshots({
      states,
      subjectOf: new Map(books.map((b) => [b.id, b.subjectId])),
      reference,
      assessmentsOf: (bookIds) => [...bookIds].reduce((acc, id) => acc + (assessments.get(id) ?? 0), 0),
    })

    return res.json({
      schoolYearId,
      level,
      scale,
      referencePeriod: reference ? { id: reference.id, name: reference.name } : null,
      students: studentsBlock(students, rules, levels),
      performance: performanceBlock(valuesAt(states, reference), levels),
      management: managementBlock(
        managementStates({
          gradeBookIds: ids,
          states,
          reference,
          // Con un grupo elegido, sólo cuentan sus alumnos, también en las libretas de tronco común.
          rosterSizeOf: (id) => (rosterIds ? rosterIds.size : sizes?.get(id) ?? 0),
        }),
      ),
      rules,
      disclaimer: DISCLAIMER,
    })
  } catch (error) {
    console.error('[academic-analytics] dashboard:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const comparisonSchema = filtersSchema.extend({
  dimension: z.enum(['YEAR', 'COURSE', 'SUBJECT']),
  schoolYearIds: z.string().optional(),
})

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

/** Comparativas por año, curso o asignatura (§5.3, §5.4, §5.5, RF-200), siempre dentro de un nivel. */
r.get('/comparison', async (req: any, res) => {
  const parsed = comparisonSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const d = parsed.data
    const years = d.schoolYearIds
      ? d.schoolYearIds.split(',').filter(Boolean)
      : [await schoolYearOf(req, d)].filter((id): id is string => Boolean(id))
    if (years.length === 0) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const period = await comparisonPeriod(d.periodId)
    const requestedLevel = d.level ?? period?.level ?? undefined

    const rows = (await prisma.periodGrade.findMany({
      where: {
        meetingValueHundredths: { not: null },
        gradeBookPeriod: {
          period: comparisonPeriodWhere(d.dimension, d.periodId, period),
          gradeBook: {
            schoolYearId: { in: years },
            ...(d.subjectId ? { subjectId: d.subjectId } : {}),
            ...(d.courseOfferingId ? { courseOfferingId: d.courseOfferingId } : {}),
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
    if (pick.ambiguous) return levelRequired(res, pick.ambiguous)
    const { levels } = await scaleFor(pick.level)

    const buckets = new Map<string, { label: string; values: number[]; students: Set<string> }>()
    for (const row of rows) {
      const [key, label] = bucketKey(d.dimension, row.gradeBookPeriod.gradeBook)
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

    return res.json({
      dimension: d.dimension,
      level: pick.level,
      data: comparison.sort((a, b) => a.label.localeCompare(b.label, 'es')),
    })
  } catch (error) {
    console.error('[academic-analytics] comparison:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Celdas Estudiante × Materia en la reunión de referencia. */
function cellsAtReference(states: readonly AnalyticsState[], subjectOf: ReadonlyMap<string, string>, reference: AnalyticsPeriod | null) {
  const perStudent = new Map<string, { lastName: string; firstName: string; bySubject: Map<string, number | null> }>()
  for (const state of states.filter((s) => s.period.id === reference?.id)) {
    const subjectId = subjectOf.get(state.gradeBookId)
    if (!subjectId) continue
    for (const grade of state.grades) {
      const entry = perStudent.get(grade.studentId) ?? { lastName: grade.lastName, firstName: grade.firstName, bySubject: new Map() }
      entry.bySubject.set(subjectId, grade.value)
      perStudent.set(grade.studentId, entry)
    }
  }
  return perStudent
}

/** Matriz de riesgo Estudiantes × Materias (§5.8), en la reunión de referencia. */
r.get('/risk-matrix', async (req: any, res) => {
  const parsed = filtersSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const schoolYearId = await schoolYearOf(req, parsed.data)
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const snapshot = await loadSnapshot(parsed.data, schoolYearId)
    if ('ambiguous' in snapshot) return levelRequired(res, snapshot.ambiguous)
    const { level, books, states, reference } = snapshot

    const [{ levels }, rules] = await Promise.all([scaleFor(level), alertRulesForYear(schoolYearId)])
    const subjects = [...new Map(books.map((gb) => [gb.subjectId, gb.subject])).values()]
    const perStudent = cellsAtReference(states, new Map(books.map((gb) => [gb.id, gb.subjectId])), reference)

    const students = [...perStudent.entries()]
      .map(([studentId, entry]) => {
        const cells = subjects.map((subject) => entry.bySubject.get(subject.id) ?? null)
        const alerts = triggeredAlerts(
          {
            studentId,
            lastName: entry.lastName,
            firstName: entry.firstName,
            subjectValues: cells,
            periodValues: [],
            assessmentCount: cells.filter((c) => c != null).length,
          },
          rules,
          levels,
        )
        return { studentId, lastName: entry.lastName, firstName: entry.firstName, cells, alerts }
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'))

    return res.json({
      level,
      referencePeriod: reference ? { id: reference.id, name: reference.name } : null,
      subjects,
      students,
      levels,
    })
  } catch (error) {
    console.error('[academic-analytics] risk-matrix:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
