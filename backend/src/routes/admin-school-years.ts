import { Router } from 'express'
import { z } from 'zod'
import { Prisma, StudentEnrollmentStatus } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import {
  assertCanCreateSchoolYear,
  assertValidSchoolYearDates,
  activateSchoolYearById,
  copyCoursesBetweenSchoolYears,
  buildSubjectAssignmentsToCopy,
} from '../services/school-year-service.js'
import {
  archiveSchoolYearGradeBooks,
  historicalSummary,
  unarchiveSchoolYearGradeBooks,
} from '../services/gradebook/archive.js'

const r = Router()

type YearSerializeInput = {
  id: string
  code: number
  label: string
  startsOn: Date | null
  endsOn: Date | null
  status: string
  createdAt: Date
  updatedAt: Date
  coursesCount?: number
}

function serializeYear(row: YearSerializeInput) {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    startsOn: row.startsOn?.toISOString() ?? null,
    endsOn: row.endsOn?.toISOString() ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    coursesCount: row.coursesCount ?? 0,
  }
}

async function countCourseOfferings(schoolYearId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count FROM "CourseOffering" WHERE "schoolYearId" = ${schoolYearId}
  `
  return Number(rows[0]?.count ?? 0)
}

async function countsBySchoolYear(schoolYearIds: string[]): Promise<Record<string, number>> {
  if (schoolYearIds.length === 0) return {}
  const rows = await prisma.$queryRaw<Array<{ schoolYearId: string; count: bigint }>>`
    SELECT "schoolYearId", COUNT(*)::bigint AS count
    FROM "CourseOffering"
    WHERE "schoolYearId" IN (${Prisma.join(schoolYearIds)})
    GROUP BY "schoolYearId"
  `
  return Object.fromEntries(rows.map((row) => [row.schoolYearId, Number(row.count)]))
}

function parseSchoolYearDate(raw: string | null | undefined): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) throw new Error('INVALID_SCHOOL_YEAR_DATE')
  return parsed
}

const startDecisionSchema = z.object({
  studentId: z.string().uuid(),
  action: z.enum(['PROMOTE', 'REPEAT', 'GRADUATED', 'WITHDRAWN', 'TRANSFERRED']),
  targetCourseId: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid().optional()),
  targetOrientationId: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid().optional()),
  notes: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().max(1000).optional()),
})

const orientationSelectionSchema = z.object({
  courseId: z.string().uuid(),
  orientationId: z.string().uuid(),
})

const startSchema = z.object({
  sourceSchoolYearId: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().uuid().optional()),
  courseIds: z.array(z.string().uuid()).min(1).max(200),
  orientationSelections: z.array(orientationSelectionSchema).max(500).optional().default([]),
  studentDecisions: z.array(startDecisionSchema).max(2000).optional().default([]),
  copySubjects: z.boolean().optional().default(true),
})

const terminalStatusByAction: Partial<Record<z.infer<typeof startDecisionSchema>['action'], StudentEnrollmentStatus>> = {
  GRADUATED: 'GRADUATED',
  WITHDRAWN: 'WITHDRAWN',
  TRANSFERRED: 'TRANSFERRED',
}

const actionNote: Record<z.infer<typeof startDecisionSchema>['action'], string> = {
  PROMOTE: 'Promovido al nuevo ciclo',
  REPEAT: 'Repite en el nuevo ciclo',
  GRADUATED: 'Marcado como egresado al iniciar el nuevo ciclo',
  WITHDRAWN: 'Marcado como no continuó al iniciar el nuevo ciclo',
  TRANSFERRED: 'Marcado como transferido al iniciar el nuevo ciclo',
}

function appendDecisionNote(base: string | null | undefined, action: keyof typeof actionNote, extra?: string): string {
  return [base, actionNote[action], extra].filter(Boolean).join(' · ')
}

function orientationKey(courseId: string, orientationId: string): string {
  return `${courseId}:${orientationId}`
}

/**
 * Arrastra al ciclo destino las ofertas de curso y orientaciones del ciclo origen que NO se
 * seleccionaron: quedan creadas pero DESACTIVADAS (no desaparecen del catálogo del ciclo nuevo).
 * Si ya existen en el destino no se tocan (más arriba ya quedaron desactivadas). El admin las
 * puede reactivar con el toggle o eliminarlas manualmente.
 */
async function carryOverUnselectedAsDeactivated(
  tx: any,
  params: {
    sourceSchoolYearId: string
    targetSchoolYearId: string
    selectedCourseIds: string[]
    selectedOrientationKeys: Set<string>
  },
) {
  const { sourceSchoolYearId, targetSchoolYearId, selectedOrientationKeys } = params
  const selectedCourses = new Set(params.selectedCourseIds)

  const sourceOfferings = await tx.courseOffering.findMany({
    where: { schoolYearId: sourceSchoolYearId },
    select: { courseId: true },
  })
  for (const offering of sourceOfferings) {
    if (selectedCourses.has(offering.courseId)) continue
    await tx.courseOffering.upsert({
      where: { courseId_schoolYearId: { courseId: offering.courseId, schoolYearId: targetSchoolYearId } },
      update: {},
      create: { courseId: offering.courseId, schoolYearId: targetSchoolYearId, isActive: false, isOffered: false, visibleInFilters: false },
    })
  }

  const sourceOrientations = await tx.courseOrientation.findMany({
    where: { schoolYearId: sourceSchoolYearId },
    select: { courseId: true, orientationId: true },
  })
  for (const co of sourceOrientations) {
    if (selectedOrientationKeys.has(orientationKey(co.courseId, co.orientationId))) continue
    await tx.courseOrientation.upsert({
      where: {
        courseId_orientationId_schoolYearId: {
          courseId: co.courseId,
          orientationId: co.orientationId,
          schoolYearId: targetSchoolYearId,
        },
      },
      update: {},
      create: {
        courseId: co.courseId,
        orientationId: co.orientationId,
        schoolYearId: targetSchoolYearId,
        isActive: false,
        isOffered: false,
        visibleInFilters: false,
      },
    })
  }
}

r.get('/', async (_req, res) => {
  try {
    const rows = await prisma.schoolYear.findMany({ orderBy: [{ code: 'desc' }] })
    const counts = await countsBySchoolYear(rows.map((row) => row.id))
    return res.json(rows.map((row) => serializeYear({ ...row, coursesCount: counts[row.id] ?? 0 })))
  } catch (e) {
    console.error('[admin/school-years]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/active', async (_req, res) => {
  try {
    const row = await prisma.schoolYear.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { code: 'desc' },
    })
    if (!row) return res.json(null)
    return res.json(serializeYear({ ...row, coursesCount: await countCourseOfferings(row.id) }))
  } catch (e) {
    console.error('[admin/school-years/active]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Comparación básica entre dos ciclos (estudiantes y cursos). */
r.get('/compare-metrics', async (req, res) => {
  const a = z.string().uuid().safeParse(req.query.a)
  const b = z.string().uuid().safeParse(req.query.b)
  if (!a.success || !b.success) {
    return res.status(400).json({ message: 'Parámetros a y b deben ser UUID de SchoolYear' })
  }
  try {
    const [ya, yb] = await Promise.all([
      prisma.schoolYear.findUnique({ where: { id: a.data } }),
      prisma.schoolYear.findUnique({ where: { id: b.data } }),
    ])
    if (!ya || !yb) return res.status(404).json({ message: 'Año lectivo no encontrado' })

    const [studentsA, studentsB, coursesA, coursesB, groupA, groupB] = await Promise.all([
      (prisma as any).studentEnrollment.count({ where: { schoolYearId: ya.id } }),
      (prisma as any).studentEnrollment.count({ where: { schoolYearId: yb.id } }),
      countCourseOfferings(ya.id),
      countCourseOfferings(yb.id),
      (prisma as any).studentEnrollment.groupBy({
        by: ['enrollmentStatus'],
        where: { schoolYearId: ya.id },
        _count: { _all: true },
      }),
      (prisma as any).studentEnrollment.groupBy({
        by: ['enrollmentStatus'],
        where: { schoolYearId: yb.id },
        _count: { _all: true },
      }),
    ])

    const mapGroup = (g: typeof groupA) => {
      const out: Record<string, number> = {}
      for (const row of g) out[row.enrollmentStatus] = row._count._all
      return out
    }

    return res.json({
      a: {
        ...serializeYear(ya),
        studentsTotal: studentsA,
        coursesCount: coursesA,
        studentsByStatus: mapGroup(groupA),
      },
      b: {
        ...serializeYear(yb),
        studentsTotal: studentsB,
        coursesCount: coursesB,
        studentsByStatus: mapGroup(groupB),
      },
    })
  } catch (e) {
    console.error('[admin/school-years/compare-metrics]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/:id/start-plan', async (req, res) => {
  const id = req.params.id
  const requestedSourceId = typeof req.query.sourceSchoolYearId === 'string' ? req.query.sourceSchoolYearId : undefined
  try {
    const target = await prisma.schoolYear.findUnique({ where: { id } })
    if (!target) return res.status(404).json({ message: 'Ciclo no encontrado' })
    if (target.status === 'CLOSED') {
      return res.status(400).json({ message: 'No se puede iniciar un ciclo cerrado' })
    }

    const sourceYears = await prisma.schoolYear.findMany({
      where: { id: { not: id } },
      orderBy: [{ code: 'desc' }],
    })
    const source = requestedSourceId
      ? sourceYears.find((row) => row.id === requestedSourceId) ?? null
      : sourceYears[0] ?? null
    if (requestedSourceId && !source) {
      return res.status(404).json({ message: 'Ciclo origen no encontrado' })
    }

    const offeringSchoolYearIds = [target.id, source?.id].filter((v): v is string => Boolean(v))
    const [courseRows, enrollmentRows] = await Promise.all([
      (prisma as any).course.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          level: true,
          sortOrder: true,
          isActive: true,
          offerings: offeringSchoolYearIds.length
            ? {
                where: { schoolYearId: { in: offeringSchoolYearIds } },
                select: { id: true, schoolYearId: true, isActive: true, isOffered: true, visibleInFilters: true },
              }
            : { select: { id: true, schoolYearId: true, isActive: true, isOffered: true, visibleInFilters: true } },
          orientations: {
            where: {
              OR: [
                { schoolYearId: null },
                ...(offeringSchoolYearIds.length ? [{ schoolYearId: { in: offeringSchoolYearIds } }] : []),
              ],
            },
            select: {
              id: true,
              courseId: true,
              orientationId: true,
              schoolYearId: true,
              isActive: true,
              isOffered: true,
              visibleInFilters: true,
              orientation: { select: { id: true, name: true, code: true, sortOrder: true, isActive: true } },
            },
            orderBy: [{ orientation: { sortOrder: 'asc' } }, { orientation: { name: 'asc' } }],
          },
        },
        orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
      source
        ? (prisma as any).studentEnrollment.findMany({
            where: { schoolYearId: source.id, enrollmentStatus: 'ACTIVE' },
            include: {
              student: { select: { id: true, firstName: true, lastName: true, documentId: true } },
              courseOffering: { include: { course: { select: { id: true, name: true, code: true, level: true, sortOrder: true } } } },
              orientation: { select: { id: true, name: true, code: true } },
              courseOrientation: { select: { id: true, orientationId: true } },
            },
            orderBy: [
              { courseOffering: { course: { sortOrder: 'asc' } } },
              { student: { lastName: 'asc' } },
              { student: { firstName: 'asc' } },
            ],
          })
        : Promise.resolve([]),
    ])

    const courses = (courseRows as any[]).map((course) => {
      const targetOffering = course.offerings?.find((offering: any) => offering.schoolYearId === target.id)
      const sourceOffering = source ? course.offerings?.find((offering: any) => offering.schoolYearId === source.id) : null
      const targetOffered = Boolean(targetOffering?.isActive && targetOffering?.isOffered && targetOffering?.visibleInFilters)
      const sourceOffered = Boolean(sourceOffering?.isActive && sourceOffering?.isOffered && sourceOffering?.visibleInFilters)
      const orientationsById = new Map<string, any[]>()
      for (const row of course.orientations ?? []) {
        if (!row.orientation?.isActive) continue
        orientationsById.set(row.orientationId, [...(orientationsById.get(row.orientationId) ?? []), row])
      }
      const orientations = [...orientationsById.entries()].map(([orientationId, rows]) => {
        const targetRow = rows.find((row) => row.schoolYearId === target.id)
        const sourceRow = source ? rows.find((row) => row.schoolYearId === source.id) : null
        const globalRow = rows.find((row) => row.schoolYearId === null)
        const displayRow = targetRow ?? sourceRow ?? globalRow ?? rows[0]
        const isVisible = (row: any) => Boolean(row?.isActive && row?.isOffered && row?.visibleInFilters)
        const targetOrientationOffered = isVisible(targetRow)
        const sourceOrientationOffered = isVisible(sourceRow)
        const globalOrientationOffered = isVisible(globalRow)
        return {
          orientationId,
          name: displayRow.orientation.name,
          code: displayRow.orientation.code,
          sortOrder: displayRow.orientation.sortOrder,
          targetOffered: targetOrientationOffered,
          sourceOffered: sourceOrientationOffered,
          recommended: targetRow ? targetOrientationOffered : source ? sourceOrientationOffered : globalOrientationOffered,
        }
      }).sort((a, b) => (a.sortOrder === b.sortOrder ? a.name.localeCompare(b.name) : a.sortOrder - b.sortOrder))
      return {
        id: course.id,
        name: course.name,
        code: course.code,
        level: course.level,
        sortOrder: course.sortOrder,
        isActive: course.isActive,
        targetOffered,
        sourceOffered,
        recommended: targetOffering ? targetOffered : source ? sourceOffered : true,
        orientations,
      }
    })

    const students = (enrollmentRows as any[]).map((enrollment) => ({
      studentId: enrollment.studentId,
      firstName: enrollment.student.firstName,
      lastName: enrollment.student.lastName,
      documentId: enrollment.student.documentId,
      sourceCourseId: enrollment.courseOffering?.courseId ?? null,
      sourceCourseName: enrollment.courseOffering?.course?.name ?? 'Sin curso',
      sourceCourseCode: enrollment.courseOffering?.course?.code ?? null,
      sourceOrientationId: enrollment.orientationId ?? null,
      sourceOrientationName: enrollment.orientation?.name ?? null,
      sourceOrientationCode: enrollment.orientation?.code ?? null,
      enrollmentStatus: enrollment.enrollmentStatus,
    }))

    return res.json({
      target: serializeYear({ ...target, coursesCount: await countCourseOfferings(target.id) }),
      source: source ? serializeYear({ ...source, coursesCount: await countCourseOfferings(source.id) }) : null,
      sourceYears: await Promise.all(
        sourceYears.map(async (row) => serializeYear({ ...row, coursesCount: await countCourseOfferings(row.id) })),
      ),
      courses,
      students,
    })
  } catch (e) {
    console.error('[admin/school-years start-plan]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const createSchema = z.object({
  code: z.number().int().min(1980).max(2100),
  label: z.string().min(1).max(120),
  startsOn: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().min(4).max(40).optional()),
  endsOn: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().min(4).max(40).optional()),
  status: z.enum(['PLANNED', 'ACTIVE', 'CLOSED']).optional(),
})

r.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  const { code, label, startsOn, endsOn, status } = parsed.data
  try {
    if (status === 'ACTIVE') {
      return res.status(400).json({ message: 'Para activar un ciclo usá POST /:id/activate' })
    }
    await assertCanCreateSchoolYear(prisma)
    const startsAt = parseSchoolYearDate(startsOn)
    const endsAt = parseSchoolYearDate(endsOn)
    assertValidSchoolYearDates(startsAt, endsAt)
    const row = await prisma.schoolYear.create({
      data: {
        code,
        label,
        startsOn: startsAt,
        endsOn: endsAt,
        status: status ?? 'PLANNED',
      },
    })
    return res.status(201).json(serializeYear({ ...row, coursesCount: 0 }))
  } catch (e: unknown) {
    const codeP = (e as { code?: string }).code
    if (codeP === 'P2002') {
      return res.status(409).json({ message: 'Ya existe un ciclo con ese código (año)' })
    }
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'INVALID_SCHOOL_YEAR_DATE') return res.status(400).json({ message: 'Fecha de ciclo lectivo inválida' })
    if (msg === 'SCHOOL_YEAR_DATES_OUT_OF_ORDER') {
      return res.status(400).json({ message: 'La fecha de inicio no puede ser posterior a la fecha de fin' })
    }
    if (msg === 'ACTIVE_SCHOOL_YEAR_EXISTS') {
      return res.status(409).json({ message: 'Ya hay un ciclo lectivo activo. Cerralo manualmente antes de crear otro.' })
    }
    console.error('[admin/school-years POST]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const patchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  startsOn: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().min(4).max(40).optional().nullable()),
  endsOn: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().min(4).max(40).optional().nullable()),
})

r.patch('/:id', async (req, res) => {
  const id = req.params.id
  const parsed = patchSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  try {
    const data: Record<string, unknown> = {}
    if (parsed.data.label !== undefined) data.label = parsed.data.label
    if (parsed.data.startsOn !== undefined) {
      data.startsOn = parseSchoolYearDate(parsed.data.startsOn)
    }
    if (parsed.data.endsOn !== undefined) {
      data.endsOn = parseSchoolYearDate(parsed.data.endsOn)
    }
    const current = await prisma.schoolYear.findUnique({ where: { id }, select: { startsOn: true, endsOn: true } })
    if (!current) return res.status(404).json({ message: 'Ciclo no encontrado' })
    assertValidSchoolYearDates(
      data.startsOn !== undefined ? (data.startsOn as Date | null) : current.startsOn,
      data.endsOn !== undefined ? (data.endsOn as Date | null) : current.endsOn,
    )
    const row = await prisma.schoolYear.update({
      where: { id },
      data: data as { label?: string; startsOn?: Date | null; endsOn?: Date | null },
    })
    const full = await prisma.schoolYear.findUniqueOrThrow({ where: { id: row.id } })
    return res.json(serializeYear({ ...full, coursesCount: await countCourseOfferings(full.id) }))
  } catch (e: unknown) {
    const codeP = (e as { code?: string }).code
    if (codeP === 'P2025') return res.status(404).json({ message: 'Ciclo no encontrado' })
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'INVALID_SCHOOL_YEAR_DATE') return res.status(400).json({ message: 'Fecha de ciclo lectivo inválida' })
    if (msg === 'SCHOOL_YEAR_DATES_OUT_OF_ORDER') {
      return res.status(400).json({ message: 'La fecha de inicio no puede ser posterior a la fecha de fin' })
    }
    console.error('[admin/school-years PATCH]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:id', async (req, res) => {
  const id = req.params.id
  try {
    const row = await prisma.schoolYear.findUnique({ where: { id } })
    if (!row) return res.status(404).json({ message: 'Ciclo no encontrado' })
    await prisma.schoolYear.delete({ where: { id } })
    return res.json({ ok: true, deleted: serializeYear({ ...row, coursesCount: 0 }) })
  } catch (e: unknown) {
    const codeP = (e as { code?: string }).code
    if (codeP === 'P2025') return res.status(404).json({ message: 'Ciclo no encontrado' })
    if (codeP === 'P2003' || codeP === 'P2014') {
      return res.status(409).json({ message: 'No se puede borrar porque el ciclo tiene datos vinculados.' })
    }
    console.error('[admin/school-years DELETE]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/start', async (req, res) => {
  const id = req.params.id
  const parsed = startSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({
      message: 'Datos inválidos',
      detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
    })
  }
  const uniqueCourseIds = [...new Set(parsed.data.courseIds)]
  const orientationSelections = parsed.data.orientationSelections.filter((selection) => uniqueCourseIds.includes(selection.courseId))
  const selectedOrientationKeys = new Set(orientationSelections.map((selection) => orientationKey(selection.courseId, selection.orientationId)))
  const decisions = parsed.data.studentDecisions
  const duplicateDecision = decisions.find((decision, index) =>
    decisions.findIndex((other) => other.studentId === decision.studentId) !== index
  )
  if (duplicateDecision) {
    return res.status(400).json({ message: 'Hay estudiantes duplicados en la preparación del ciclo.' })
  }
  const selectedCourses = new Set(uniqueCourseIds)
  const movableActions = new Set(['PROMOTE', 'REPEAT'])
  const invalidDecision = decisions.find(
    (decision) =>
      movableActions.has(decision.action) &&
      (!decision.targetCourseId ||
        !selectedCourses.has(decision.targetCourseId) ||
        (decision.targetOrientationId && !selectedOrientationKeys.has(orientationKey(decision.targetCourseId, decision.targetOrientationId)))),
  )
  if (invalidDecision) {
    return res.status(400).json({ message: 'Todo estudiante que pasa o repite debe tener un curso activo y una orientación válida si corresponde.' })
  }

  try {
    const target = await prisma.schoolYear.findUnique({ where: { id } })
    if (!target) return res.status(404).json({ message: 'Ciclo no encontrado' })
    if (target.status === 'CLOSED') return res.status(400).json({ message: 'No se puede iniciar un ciclo cerrado' })
    if (parsed.data.sourceSchoolYearId) {
      const source = await prisma.schoolYear.findUnique({ where: { id: parsed.data.sourceSchoolYearId }, select: { id: true } })
      if (!source) return res.status(404).json({ message: 'Ciclo origen no encontrado' })
    }
    const courses = await (prisma as any).course.findMany({
      where: { id: { in: uniqueCourseIds }, isActive: true },
      select: { id: true },
    })
    if (courses.length !== uniqueCourseIds.length) {
      return res.status(400).json({ message: 'Uno o más cursos seleccionados no existen o están inactivos.' })
    }
    if (orientationSelections.length) {
      const orientationRows = await (prisma as any).courseOrientation.findMany({
        where: {
          OR: orientationSelections.map((selection) => ({
            courseId: selection.courseId,
            orientationId: selection.orientationId,
            OR: [
              { schoolYearId: null },
              ...(parsed.data.sourceSchoolYearId ? [{ schoolYearId: parsed.data.sourceSchoolYearId }] : []),
              { schoolYearId: id },
            ],
          })),
          orientation: { isActive: true },
        },
        select: { courseId: true, orientationId: true },
      })
      const validOrientationKeys = new Set(orientationRows.map((row: any) => orientationKey(row.courseId, row.orientationId)))
      const missingOrientation = orientationSelections.find((selection) => !validOrientationKeys.has(orientationKey(selection.courseId, selection.orientationId)))
      if (missingOrientation) {
        return res.status(400).json({ message: 'Una o más orientaciones no pertenecen al curso seleccionado.' })
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const otherActive = await tx.schoolYear.findFirst({
        where: { status: 'ACTIVE', NOT: { id } },
        select: { id: true },
      })
      if (otherActive) throw new Error('ACTIVE_SCHOOL_YEAR_EXISTS')

      await (tx as any).courseOffering.updateMany({
        where: { schoolYearId: id, courseId: { notIn: uniqueCourseIds } },
        data: { isActive: false, isOffered: false, visibleInFilters: false },
      })
      await (tx as any).courseOrientation.updateMany({
        where: { schoolYearId: id, courseId: { notIn: uniqueCourseIds } },
        data: { isActive: false, isOffered: false, visibleInFilters: false },
      })
      await (tx as any).courseOrientation.updateMany({
        where: { schoolYearId: id, courseId: { in: uniqueCourseIds } },
        data: { isActive: false, isOffered: false, visibleInFilters: false },
      })

      for (const courseId of uniqueCourseIds) {
        await (tx as any).courseOffering.upsert({
          where: { courseId_schoolYearId: { courseId, schoolYearId: id } },
          update: { isActive: true, isOffered: true, visibleInFilters: true },
          create: { courseId, schoolYearId: id, isActive: true, isOffered: true, visibleInFilters: true },
        })
      }
      for (const selection of orientationSelections) {
        await (tx as any).courseOrientation.upsert({
          where: {
            courseId_orientationId_schoolYearId: {
              courseId: selection.courseId,
              orientationId: selection.orientationId,
              schoolYearId: id,
            },
          },
          update: { isActive: true, isOffered: true, visibleInFilters: true },
          create: {
            courseId: selection.courseId,
            orientationId: selection.orientationId,
            schoolYearId: id,
            isActive: true,
            isOffered: true,
            visibleInFilters: true,
          },
        })
      }

      // Lo NO seleccionado del ciclo origen se conserva en el nuevo ciclo, pero desactivado.
      if (parsed.data.sourceSchoolYearId) {
        await carryOverUnselectedAsDeactivated(tx, {
          sourceSchoolYearId: parsed.data.sourceSchoolYearId,
          targetSchoolYearId: id,
          selectedCourseIds: uniqueCourseIds,
          selectedOrientationKeys,
        })
      }

      let subjectsCopied = 0
      if (parsed.data.sourceSchoolYearId && parsed.data.copySubjects) {
        const assignmentSelect = {
          subjectId: true,
          level: true,
          courseId: true,
          orientationId: true,
          associationType: true,
          isActive: true,
          isOffered: true,
          visibleInFilters: true,
          sortOrder: true,
          notes: true,
        }
        // Asignaciones del origen: específicas de los cursos elegidos + las de alcance
        // nivel/orientación (courseId nulo), que aplican aunque el curso no esté seleccionado.
        const sourceAssignments = await (tx as any).subjectCourseAssignment.findMany({
          where: {
            schoolYearId: parsed.data.sourceSchoolYearId,
            OR: [{ courseId: { in: uniqueCourseIds } }, { courseId: null }],
          },
          select: assignmentSelect,
        })
        if (sourceAssignments.length) {
          const existingTarget = await (tx as any).subjectCourseAssignment.findMany({
            where: { schoolYearId: id },
            select: { subjectId: true, courseId: true, orientationId: true, level: true, associationType: true },
          })
          const toCreate = buildSubjectAssignmentsToCopy(sourceAssignments, existingTarget, id)
          if (toCreate.length) {
            await (tx as any).subjectCourseAssignment.createMany({ data: toCreate })
            subjectsCopied = toCreate.length
          }
        }
      }

      const targetOfferings = await (tx as any).courseOffering.findMany({
        where: { schoolYearId: id, courseId: { in: uniqueCourseIds } },
        select: { id: true, courseId: true },
      })
      const targetCourseOrientations = orientationSelections.length
        ? await (tx as any).courseOrientation.findMany({
            where: {
              schoolYearId: id,
              OR: orientationSelections.map((selection) => ({
                courseId: selection.courseId,
                orientationId: selection.orientationId,
              })),
            },
            select: { id: true, courseId: true, orientationId: true },
          })
        : []
      const offeringByCourse = new Map<string, string>(targetOfferings.map((offering: any) => [offering.courseId, offering.id]))
      const courseOrientationByKey = new Map<string, string>(
        targetCourseOrientations.map((row: any) => [orientationKey(row.courseId, row.orientationId), row.id]),
      )
      let moved = 0
      let closed = 0
      if (parsed.data.sourceSchoolYearId && decisions.length) {
        const sourceEnrollments = await (tx as any).studentEnrollment.findMany({
          where: {
            schoolYearId: parsed.data.sourceSchoolYearId,
            studentId: { in: decisions.map((decision) => decision.studentId) },
          },
          select: { id: true, studentId: true, notes: true },
        })
        const sourceByStudent = new Map<string, { id: string; notes: string | null }>(
          sourceEnrollments.map((enrollment: any) => [enrollment.studentId, enrollment]),
        )
        const now = new Date()
        for (const decision of decisions) {
          const sourceEnrollment = sourceByStudent.get(decision.studentId)
          if (!sourceEnrollment) throw new Error('STUDENT_SOURCE_ENROLLMENT_NOT_FOUND')
          if (decision.action === 'PROMOTE' || decision.action === 'REPEAT') {
            const targetCourseId = decision.targetCourseId as string
            const targetOfferingId = offeringByCourse.get(targetCourseId)
            if (!targetOfferingId) throw new Error('TARGET_COURSE_NOT_OFFERED')
            const targetCourseOrientationId = decision.targetOrientationId
              ? courseOrientationByKey.get(orientationKey(targetCourseId, decision.targetOrientationId))
              : null
            if (decision.targetOrientationId && !targetCourseOrientationId) throw new Error('TARGET_ORIENTATION_NOT_OFFERED')
            await (tx as any).studentEnrollment.upsert({
              where: { studentId_schoolYearId: { studentId: decision.studentId, schoolYearId: id } },
              update: {
                courseOfferingId: targetOfferingId,
                orientationId: decision.targetOrientationId ?? null,
                courseOrientationId: targetCourseOrientationId,
                enrollmentStatus: 'ACTIVE',
                withdrawnAt: null,
                withdrawalAcademicYear: null,
                notes: appendDecisionNote(null, decision.action, decision.notes),
              },
              create: {
                studentId: decision.studentId,
                schoolYearId: id,
                courseOfferingId: targetOfferingId,
                orientationId: decision.targetOrientationId ?? null,
                courseOrientationId: targetCourseOrientationId,
                enrollmentStatus: 'ACTIVE',
                notes: appendDecisionNote(null, decision.action, decision.notes),
              },
            })
            moved += 1
          } else {
            const status = terminalStatusByAction[decision.action]
            if (!status) throw new Error('INVALID_STUDENT_DECISION')
            await (tx as any).studentEnrollment.update({
              where: { id: sourceEnrollment.id },
              data: {
                enrollmentStatus: status,
                withdrawnAt: status === 'GRADUATED' ? null : now,
                withdrawalAcademicYear: target.code,
                notes: appendDecisionNote(sourceEnrollment.notes, decision.action, decision.notes),
              },
            })
            closed += 1
          }
        }
      }

      const updated = await tx.schoolYear.update({
        where: { id },
        data: { status: 'ACTIVE' },
      })
      return { updated, moved, closed, courses: uniqueCourseIds.length, orientations: orientationSelections.length, subjectsCopied }
    })

    const full = await prisma.schoolYear.findUniqueOrThrow({ where: { id: result.updated.id } })
    return res.json({
      year: serializeYear({ ...full, coursesCount: await countCourseOfferings(full.id) }),
      courses: result.courses,
      orientations: result.orientations,
      movedStudents: result.moved,
      closedStudents: result.closed,
      subjectsCopied: result.subjectsCopied,
    })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'ACTIVE_SCHOOL_YEAR_EXISTS') {
      return res.status(409).json({ message: 'Ya hay un ciclo lectivo activo. Cerralo manualmente antes de iniciar otro.' })
    }
    if (msg === 'STUDENT_SOURCE_ENROLLMENT_NOT_FOUND') {
      return res.status(400).json({ message: 'Uno o más estudiantes no pertenecen al ciclo origen elegido.' })
    }
    if (msg === 'TARGET_COURSE_NOT_OFFERED') {
      return res.status(400).json({ message: 'Uno o más estudiantes apuntan a un curso no activo en el ciclo destino.' })
    }
    if (msg === 'TARGET_ORIENTATION_NOT_OFFERED') {
      return res.status(400).json({ message: 'Uno o más estudiantes apuntan a una orientación no activa en el ciclo destino.' })
    }
    console.error('[admin/school-years start]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/activate', async (req, res) => {
  const id = req.params.id
  try {
    const row = await prisma.schoolYear.findUnique({ where: { id } })
    if (!row) return res.status(404).json({ message: 'Ciclo no encontrado' })
    const updated = await activateSchoolYearById(prisma, id)
    // Reabrir un ciclo cerrado por error no puede dejar las libretas en sólo lectura.
    await unarchiveSchoolYearGradeBooks(id)
    const full = await prisma.schoolYear.findUniqueOrThrow({ where: { id: updated.id } })
    return res.json(serializeYear({ ...full, coursesCount: await countCourseOfferings(full.id) }))
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'ACTIVE_SCHOOL_YEAR_EXISTS') {
      return res.status(409).json({ message: 'Ya hay un ciclo lectivo activo. Cerralo manualmente antes de iniciar otro.' })
    }
    console.error('[admin/school-years activate]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/close', async (req, res) => {
  const id = req.params.id
  try {
    const row = await prisma.schoolYear.findUnique({ where: { id } })
    if (!row) return res.status(404).json({ message: 'Ciclo no encontrado' })
    if (row.status === 'CLOSED') {
      return res.json(serializeYear({ ...row, coursesCount: await countCourseOfferings(row.id) }))
    }
    const updated = await prisma.schoolYear.update({
      where: { id },
      data: { status: 'CLOSED' },
    })

    // RF-110: las libretas del ciclo pasan a histórico. No se copia ni se mueve nada: el estado
    // `ARCHIVED` es lo que bloquea toda la cadena de escritura y deja la consulta abierta.
    const archive = await archiveSchoolYearGradeBooks(id)

    const full = await prisma.schoolYear.findUniqueOrThrow({ where: { id: updated.id } })
    return res.json({
      ...serializeYear({ ...full, coursesCount: await countCourseOfferings(full.id) }),
      gradeBooks: archive,
    })
  } catch (e) {
    console.error('[admin/school-years close]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Resumen de la actividad académica de un ciclo, para la consulta histórica (RF-111). */
r.get('/:id/gradebook-summary', async (req, res) => {
  try {
    const row = await prisma.schoolYear.findUnique({ where: { id: req.params.id } })
    if (!row) return res.status(404).json({ message: 'Ciclo no encontrado' })

    return res.json({
      schoolYearId: row.id,
      status: row.status,
      readOnly: row.status === 'CLOSED',
      summary: await historicalSummary(row.id),
    })
  } catch (e) {
    console.error('[admin/school-years gradebook-summary]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/copy-courses-from/:sourceId', async (req, res) => {
  const targetId = req.params.id
  const sourceId = req.params.sourceId
  try {
    const result = await copyCoursesBetweenSchoolYears(prisma, targetId, sourceId)
    return res.status(201).json({ ok: true, ...result })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'SCHOOL_YEAR_NOT_FOUND') return res.status(404).json({ message: 'Año lectivo no encontrado' })
    if (msg === 'SAME_SCHOOL_YEAR') return res.status(400).json({ message: 'Origen y destino no pueden ser el mismo' })
    if (msg === 'TARGET_YEAR_HAS_COURSES') {
      return res.status(409).json({ message: 'El año destino ya tiene cursos. La copia solo se permite en un catálogo vacío.' })
    }
    console.error('[admin/school-years copy-courses]', e)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
