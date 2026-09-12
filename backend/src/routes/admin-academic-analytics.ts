import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { loadRosterForScope } from '../services/student-attendance/roster.js'
import {
  buildComparison,
  managementBlock,
  performanceBlock,
  studentsBlock,
  triggeredAlerts,
  type AlertRule,
  type GradeBookState,
  type LevelRow,
  type StudentSnapshot,
} from '../services/gradebook/analytics.js'

/**
 * Backoffice de inteligencia académica (§5).
 *
 * Montado bajo `/admin/academic-analytics` con `academic-analytics.read` de alcance ALL. Lee del
 * mismo esquema transaccional: a escala de un liceo no compensa el repositorio analítico aparte
 * que sugiere §5.10, y evita que un indicador quede desfasado del dato que lo originó.
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

/** Umbrales vigentes para un ciclo (RF-200): los propios del año, o los generales. */
export async function alertRulesForYear(schoolYearId: string): Promise<AlertRule[]> {
  const rows = await prisma.academicAlertRule.findMany({
    where: { isActive: true, OR: [{ schoolYearId }, { schoolYearId: null }] },
  })
  // La regla específica del ciclo pisa a la general: así una comparativa histórica se evalúa con
  // el umbral que regía ese año y no cambia sola cuando alguien mueve el actual.
  const byType = new Map<string, AlertRule>()
  for (const row of rows) {
    const current = byType.get(row.type)
    if (!current || row.schoolYearId === schoolYearId) {
      byType.set(row.type, { type: row.type as AlertRule['type'], threshold: row.threshold })
    }
  }
  return [...byType.values()]
}

/** Escala de referencia para los tramos. */
async function referenceLevels(): Promise<LevelRow[]> {
  const scale = await prisma.gradingScale.findFirst({
    where: { isActive: true },
    include: { levels: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  })
  return (scale?.levels ?? []) as LevelRow[]
}

type GradeBookRow = {
  id: string
  subjectId: string
  courseOfferingId: string
  orientationId: string | null
  courseOrientationId: string | null
  schoolYearId: string
}

function gradeBookWhere(filters: z.infer<typeof filtersSchema>, schoolYearId: string) {
  return {
    schoolYearId,
    ...(filters.courseOfferingId ? { courseOfferingId: filters.courseOfferingId } : {}),
    ...(filters.courseOrientationId ? { courseOrientationId: filters.courseOrientationId } : {}),
    ...(filters.subjectId ? { subjectId: filters.subjectId } : {}),
    ...(filters.level ? { courseOffering: { course: { level: filters.level } } } : {}),
  }
}

/**
 * Reúne los datos crudos del ciclo: libretas, estados de período y calificaciones.
 * Una consulta por tabla, no una por libreta.
 */
async function loadSnapshot(filters: z.infer<typeof filtersSchema>, schoolYearId: string) {
  const gradeBooks = await prisma.gradeBook.findMany({
    where: gradeBookWhere(filters, schoolYearId) as never,
    include: {
      subject: { select: { id: true, name: true } },
      courseOffering: { include: { course: { select: { id: true, name: true, level: true } } } },
    },
  })
  const ids = gradeBooks.map((gb) => gb.id)

  const [states, assessmentCounts] = await Promise.all([
    prisma.gradeBookPeriod.findMany({
      where: {
        gradeBookId: { in: ids },
        ...(filters.periodId ? { periodId: filters.periodId } : {}),
      },
      include: {
        grades: true,
        endorsements: { where: { section: 'ALL' }, orderBy: { occurredAt: 'desc' }, take: 1 },
        period: { select: { id: true, name: true, sortOrder: true } },
      },
    }),
    prisma.assessment.groupBy({
      by: ['gradeBookId'],
      where: { gradeBookId: { in: ids }, deletedAt: null, ...(filters.periodId ? { periodId: filters.periodId } : {}) },
      _count: { _all: true },
    }),
  ])

  return { gradeBooks, states, assessmentCounts }
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

/** Dashboard principal (§5.1). */
r.get('/dashboard', async (req: any, res) => {
  const parsed = filtersSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const schoolYearId =
      parsed.data.schoolYearId ??
      (await resolveSchoolYearIdForList(prisma, { role: req.user?.role, requestedSchoolYearId: undefined }))
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const [levels, rules, snapshot] = await Promise.all([
      referenceLevels(),
      alertRulesForYear(schoolYearId),
      loadSnapshot(parsed.data, schoolYearId),
    ])
    const sizes = await rosterSizes(snapshot.gradeBooks)
    const assessmentsByBook = new Map(snapshot.assessmentCounts.map((row) => [row.gradeBookId, row._count._all]))

    // Un estudiante aparece una vez, con una nota por asignatura y su serie por período.
    const perStudent = new Map<string, { name: [string, string]; bySubject: Map<string, number | null>; byPeriod: Map<number, number | null>; assessments: number }>()
    const allValues: number[] = []

    for (const state of snapshot.states) {
      for (const grade of state.grades) {
        const entry = perStudent.get(grade.studentId) ?? {
          name: [grade.studentLastName, grade.studentFirstName] as [string, string],
          bySubject: new Map(),
          byPeriod: new Map(),
          assessments: 0,
        }
        const gradeBook = snapshot.gradeBooks.find((gb) => gb.id === state.gradeBookId)
        if (gradeBook) entry.bySubject.set(gradeBook.subjectId, grade.valueHundredths)
        entry.byPeriod.set(state.period.sortOrder, grade.valueHundredths)
        entry.assessments += assessmentsByBook.get(state.gradeBookId) ?? 0
        perStudent.set(grade.studentId, entry)
        if (grade.valueHundredths != null) allValues.push(grade.valueHundredths)
      }
    }

    const students: StudentSnapshot[] = [...perStudent.entries()].map(([studentId, entry]) => ({
      studentId,
      lastName: entry.name[0],
      firstName: entry.name[1],
      subjectValues: [...entry.bySubject.values()],
      periodValues: [...entry.byPeriod.entries()].sort((a, b) => a[0] - b[0]).map(([, value]) => value),
      assessmentCount: entry.assessments,
    }))

    const states: GradeBookState[] = snapshot.gradeBooks.map((gb) => {
      const state = snapshot.states.find((s) => s.gradeBookId === gb.id)
      return {
        gradeBookId: gb.id,
        gradedStudents: state?.grades.length ?? 0,
        rosterSize: sizes.get(gb.id) ?? 0,
        periodStatus: (state?.status as never) ?? null,
        endorsed: state?.endorsements[0]?.status === 'ENDORSED',
        closedLate: state?.closedLate ?? false,
      }
    })

    return res.json({
      schoolYearId,
      students: studentsBlock(students, rules, levels),
      performance: performanceBlock(allValues, levels),
      management: managementBlock(states),
      rules,
      disclaimer:
        'Las alertas tienen finalidad informativa y de apoyo a la intervención pedagógica. No generan ' +
        'automáticamente decisiones administrativas, promociones, repeticiones ni sanciones. Los indicadores ' +
        'de gestión no constituyen por sí solos un mecanismo de evaluación del desempeño docente.',
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

/** Comparativas por año, curso o asignatura (§5.3, §5.4, §5.5, RF-200). */
r.get('/comparison', async (req: any, res) => {
  const parsed = comparisonSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const levels = await referenceLevels()
    const years = parsed.data.schoolYearIds
      ? parsed.data.schoolYearIds.split(',').filter(Boolean)
      : [
          parsed.data.schoolYearId ??
            (await resolveSchoolYearIdForList(prisma, { role: req.user?.role, requestedSchoolYearId: undefined })),
        ].filter((id): id is string => Boolean(id))
    if (years.length === 0) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const rows = await prisma.periodGrade.findMany({
      where: {
        valueHundredths: { not: null },
        gradeBookPeriod: {
          ...(parsed.data.periodId ? { periodId: parsed.data.periodId } : {}),
          gradeBook: {
            schoolYearId: { in: years },
            ...(parsed.data.subjectId ? { subjectId: parsed.data.subjectId } : {}),
            ...(parsed.data.courseOfferingId ? { courseOfferingId: parsed.data.courseOfferingId } : {}),
            ...(parsed.data.level ? { courseOffering: { course: { level: parsed.data.level } } } : {}),
          },
        },
      },
      select: {
        studentId: true,
        valueHundredths: true,
        gradeBookPeriod: {
          select: {
            gradeBook: {
              select: {
                schoolYearId: true,
                schoolYear: { select: { label: true } },
                subject: { select: { id: true, name: true } },
                courseOffering: { select: { course: { select: { id: true, name: true } } } },
              },
            },
          },
        },
      },
    })

    const buckets = new Map<string, { label: string; values: number[]; students: Set<string> }>()
    for (const row of rows) {
      const book = row.gradeBookPeriod.gradeBook
      const [key, label] =
        parsed.data.dimension === 'YEAR'
          ? [book.schoolYearId, book.schoolYear.label]
          : parsed.data.dimension === 'COURSE'
            ? [book.courseOffering.course.id, book.courseOffering.course.name]
            : [book.subject.id, book.subject.name]

      const bucket = buckets.get(key) ?? { label, values: [], students: new Set<string>() }
      bucket.values.push(row.valueHundredths!)
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

    return res.json({ dimension: parsed.data.dimension, data: comparison.sort((a, b) => a.label.localeCompare(b.label, 'es')) })
  } catch (error) {
    console.error('[academic-analytics] comparison:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Matriz de riesgo Estudiantes × Materias (§5.8). */
r.get('/risk-matrix', async (req: any, res) => {
  const parsed = filtersSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const schoolYearId =
      parsed.data.schoolYearId ??
      (await resolveSchoolYearIdForList(prisma, { role: req.user?.role, requestedSchoolYearId: undefined }))
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const [levels, rules, snapshot] = await Promise.all([
      referenceLevels(),
      alertRulesForYear(schoolYearId),
      loadSnapshot(parsed.data, schoolYearId),
    ])

    const subjects = [...new Map(snapshot.gradeBooks.map((gb) => [gb.subjectId, gb.subject])).values()]
    const bookToSubject = new Map(snapshot.gradeBooks.map((gb) => [gb.id, gb.subjectId]))

    const perStudent = new Map<string, { lastName: string; firstName: string; bySubject: Map<string, number | null> }>()
    for (const state of snapshot.states) {
      const subjectId = bookToSubject.get(state.gradeBookId)
      if (!subjectId) continue
      for (const grade of state.grades) {
        const entry = perStudent.get(grade.studentId) ?? {
          lastName: grade.studentLastName,
          firstName: grade.studentFirstName,
          bySubject: new Map(),
        }
        entry.bySubject.set(subjectId, grade.valueHundredths)
        perStudent.set(grade.studentId, entry)
      }
    }

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

    return res.json({ subjects, students, levels })
  } catch (error) {
    console.error('[academic-analytics] risk-matrix:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const ruleSchema = z.object({
  type: z.enum(['ALERT_SUBJECTS', 'SCORE_DROP', 'NO_ASSESSMENTS']),
  schoolYearId: z.string().uuid().nullish(),
  threshold: z.number().int().min(0),
  isActive: z.boolean().optional(),
})

/** Umbrales de alerta (§5.7): configurables, nunca programados de forma rígida. */
r.get('/alert-rules', async (_req, res) => {
  try {
    const rules = await prisma.academicAlertRule.findMany({
      include: { schoolYear: { select: { code: true, label: true } } },
      orderBy: [{ type: 'asc' }, { schoolYearId: 'asc' }],
    })
    return res.json({ data: rules })
  } catch (error) {
    console.error('[academic-analytics] alert rules:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/alert-rules', async (req: any, res) => {
  const parsed = ruleSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const d = parsed.data
    const schoolYearId = d.schoolYearId ?? null
    const existing = await prisma.academicAlertRule.findFirst({ where: { type: d.type, schoolYearId } })

    const saved = existing
      ? await prisma.academicAlertRule.update({
          where: { id: existing.id },
          data: { threshold: d.threshold, ...(d.isActive === undefined ? {} : { isActive: d.isActive }) },
        })
      : await prisma.academicAlertRule.create({
          data: { type: d.type, schoolYearId, threshold: d.threshold, isActive: d.isActive ?? true },
        })

    return res.json({ data: saved })
  } catch (error) {
    console.error('[academic-analytics] alert rule save:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
