import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { attachmentDisposition } from '../services/exports/content-disposition.js'
import { authGuard, requirePermission, userPermissionScope } from '../middlewares/auth.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { canResolveRoster, loadRosterForScope } from '../services/student-attendance/roster.js'
import { resolveGradeBookAccess, type GradeBookAccess } from '../services/gradebook/access.js'
import { photoETag } from '../services/student-photo.js'
import { effectiveWeight, formatAbsenceUnits } from '../services/student-attendance/absence-weight.js'
import {
  admissionSummary,
  currentAccommodations,
  unresolvedPendingSubjects,
} from '../services/gradebook/student-sheet.js'
import { resolveMoodleAcademicScope } from '../integrations/moodle/scope.js'
import { AuditAction } from '@prisma/client'
import { clientIpFromRequest, recordAuditEvent, recordAuditEventNow } from '../services/audit-log.js'
import { getGradeBookSettings } from '../config/system-settings.js'
import { GRADE_BLOCK_MESSAGES, resolveGradeEditPermissions } from '../services/gradebook/edit-window.js'
import { GradingError, saveGrades } from '../services/gradebook/grading.js'
import ExcelJS from 'exceljs'
import {
  buildClosureSheet,
  buildGradesSheet,
  type GradeBookMeta,
} from '../services/gradebook/exports/gradeBookWorkbook.js'
import { generateGradeBookPdf, generateStudentReportPdf } from '../services/gradebook/exports/gradeBookPdf.js'
import {
  messageNotification,
  notifyGradeBook,
  resolveGradeBookRecipients,
} from '../services/gradebook/notifications.js'
import {
  buildImportPlan,
  buildImportPreview,
  loadMoodleReport,
  mapMoodleUsersToStudents,
} from '../services/gradebook/moodle-import.js'
import {
  CLOSURE_BLOCKER_MESSAGES,
  closureBlockers,
  describeValue,
  isLateClosure,
  periodWriteBlock,
} from '../services/gradebook/period-closure.js'

/**
 * Libreta del docente (RF-021, RF-030, RF-002).
 *
 * El acceso no se decide sólo por el permiso: `gradebook.read` con alcance `own` habilita el
 * módulo, y el vínculo real con la libreta (titular o suplente) lo resuelve
 * `resolveGradeBookAccess`. Un docente con el permiso no ve por eso las libretas de sus colegas.
 */

const r = Router()
r.use(authGuard)

const GRADEBOOK_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  orientation: { select: { id: true, name: true } },
  courseOrientation: { select: { id: true, orientation: { select: { id: true, name: true } } } },
  courseOffering: {
    select: {
      id: true,
      course: { select: { id: true, name: true, code: true, level: true } },
      schoolYear: { select: { id: true, code: true, label: true } },
    },
  },
  teacher: { select: { id: true, name: true, username: true } },
}

type GradeBookRow = Awaited<ReturnType<typeof loadGradeBook>>

async function loadGradeBook(id: string) {
  return prisma.gradeBook.findUnique({ where: { id }, include: GRADEBOOK_INCLUDE })
}

function orientationNameOf(row: any): string | null {
  return row.courseOrientation?.orientation?.name ?? row.orientation?.name ?? null
}

/** Encabezado de la libreta (RF-021). */
function serializeHeader(row: any) {
  return {
    id: row.id,
    status: row.status,
    schoolYear: row.courseOffering.schoolYear,
    course: row.courseOffering.course,
    courseOfferingId: row.courseOffering.id,
    orientation: orientationNameOf(row),
    subject: row.subject,
    teacher: row.teacher,
  }
}

/** Alcances de quien pide, para combinarlos con su vínculo con la libreta. */
async function scopesOf(req: any) {
  const userId = req.user?.id ?? req.user?.sub
  const [readScope, gradeScope, planScope] = await Promise.all([
    userPermissionScope(userId, 'gradebook.read', req.user?.role),
    userPermissionScope(userId, 'gradebook.grade', req.user?.role),
    userPermissionScope(userId, 'gradebook.plan', req.user?.role),
  ])
  return { userId, readScope, gradeScope, planScope }
}

/**
 * Claves de scope de las libretas que el usuario cubrió como suplente en el ciclo.
 *
 * Se derivan con `resolveMoodleAcademicScope`, la misma función que produjo el `scopeKey` al
 * crear la libreta, así que la correspondencia es exacta por construcción.
 */
async function coveredScopeKeys(userId: string, schoolYearId: string): Promise<string[]> {
  const substitutions = await prisma.substitution.findMany({
    where: { substituteUserId: userId, event: { schoolYearId } },
    select: {
      event: {
        select: {
          schoolYearId: true,
          courseOfferingId: true,
          subjectId: true,
          orientationId: true,
          courseOrientationId: true,
        },
      },
    },
  })

  const keys = new Set<string>()
  for (const row of substitutions) {
    const scope = resolveMoodleAcademicScope(row.event)
    if (scope) keys.add(scope.key)
  }
  return [...keys]
}

/**
 * Libretas visibles para quien pide.
 *
 * Con alcance `own` se listan las que tiene a cargo — como titular o como suplente. La suplencia
 * se resuelve en una sola consulta y no libreta por libreta.
 */
r.get('/mine', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const { userId, readScope } = await scopesOf(req)
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const where: Record<string, unknown> = { schoolYearId }
    if (readScope !== 'all') {
      // Las libretas suplidas se resuelven por `scopeKey` y no por (oferta, asignatura): esos dos
      // campos solos ignoran la orientación, y un suplente de "Matemática – 3.º Cs. de la Vida"
      // vería también las de las otras orientaciones de ese curso.
      const coveredKeys = await coveredScopeKeys(userId, schoolYearId)
      where.OR = [{ teacherUserId: userId }, { scopeKey: { in: coveredKeys } }]
    }

    const rows = await prisma.gradeBook.findMany({
      where: where as never,
      include: GRADEBOOK_INCLUDE,
      orderBy: [{ courseOffering: { course: { sortOrder: 'asc' } } }, { subject: { name: 'asc' } }],
    })

    return res.json({ schoolYearId, data: rows.map(serializeHeader) })
  } catch (error) {
    console.error('[gradebook] mine:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const idParamSchema = z.object({ id: z.string().uuid('Identificador de libreta inválido') })

/**
 * Carga la libreta, resuelve autorización y responde el error por su cuenta.
 * Devuelve `null` para que el handler sea `const ctx = await loadContext(...); if (!ctx) return`.
 */
async function loadContext(req: any, res: any): Promise<{ row: NonNullable<GradeBookRow>; access: GradeBookAccess } | null> {
  const params = idParamSchema.safeParse(req.params)
  if (!params.success) {
    res.status(400).json({ message: 'Datos inválidos', errors: params.error.errors })
    return null
  }

  const row = await loadGradeBook(params.data.id)
  if (!row) {
    res.status(404).json({ message: 'Libreta no encontrada' })
    return null
  }

  const { userId, readScope, gradeScope, planScope } = await scopesOf(req)
  const access = await resolveGradeBookAccess({
    userId,
    readScope,
    gradeScope,
    planScope,
    gradeBook: {
      teacherUserId: row.teacherUserId,
      schoolYearId: row.schoolYearId,
      courseOfferingId: row.courseOfferingId,
      subjectId: row.subjectId,
      orientationId: row.orientationId,
      courseOrientationId: row.courseOrientationId,
      status: row.status,
    },
  })

  if (!access.canRead) {
    res.status(403).json({ message: 'No tenés acceso a esta libreta.', code: 'NOT_ASSIGNED' })
    return null
  }
  return { row, access }
}

/** Encabezado + lista del grupo (RF-021 y RF-030). */
r.get('/:id', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const { row, access } = ctx
    if (!canResolveRoster(row)) {
      return res.status(409).json({ message: 'La libreta no tiene grupo resoluble.', code: 'NO_COHORT' })
    }

    // Misma precedencia que Moodle y el pase de lista: courseOrientation > orientation > tronco común.
    const students = await loadRosterForScope({
      schoolYearId: row.schoolYearId,
      courseOfferingId: row.courseOfferingId,
      orientationId: row.orientationId,
      courseOrientationId: row.courseOrientationId,
    })

    // RF-100: cada apertura de una libreta queda registrada. Fire-and-forget a propósito: es un
    // registro de consulta, de alto volumen, y no puede hacer fallar la lectura.
    void prisma.gradeBookAccessLog
      .create({
        data: {
          gradeBookId: row.id,
          userId: req.user?.id ?? req.user?.sub ?? null,
          roleCode: String(req.user?.role ?? ''),
          ip: clientIpFromRequest(req),
        },
      })
      .catch((error) => console.error('[gradebook] access log:', error))

    // Inasistencias del ciclo, **globales**: el liceo cuenta las faltas del estudiante en el
    // liceo, no las de cada materia por separado. Antes esto filtraba por `subjectId` y cada
    // docente veía sólo las suyas, que es lo contrario de lo que se necesita para detectar a
    // quien está faltando. Se traen acá porque la grilla las muestra junto a cada alumno y
    // pedirlas de a una sería N consultas.
    const attendance = await prisma.studentAttendanceEntry.findMany({
      where: {
        studentId: { in: students.map((s) => s.studentId) },
        session: { schoolYearId: row.schoolYearId },
      },
      select: { studentId: true, status: true, absenceWeightHundredths: true },
    })

    const absencesByStudent = new Map<
      string,
      { absenceHundredths: number; justified: number; lates: number }
    >()
    for (const mark of attendance) {
      const entry = absencesByStudent.get(mark.studentId) ?? {
        absenceHundredths: 0,
        justified: 0,
        lates: 0,
      }
      entry.absenceHundredths += effectiveWeight(mark)
      if (mark.status === 'ABSENT_JUSTIFIED') entry.justified += 1
      if (mark.status === 'LATE') entry.lates += 1
      absencesByStudent.set(mark.studentId, entry)
    }

    return res.json({
      ...serializeHeader(row),
      access: { level: access.level, canGrade: access.canGrade },
      studentCount: students.length,
      students: students.map((student) => {
        const totals = absencesByStudent.get(student.studentId)
        const hundredths = totals?.absenceHundredths ?? 0
        return {
          ...student,
          /** Total en centésimos: 150 = una falta y media. */
          absenceHundredths: hundredths,
          /** Ya formateado, para que la UI no tenga que saber de centésimos. */
          absences: formatAbsenceUnits(hundredths),
          justifiedCount: totals?.justified ?? 0,
          lates: totals?.lates ?? 0,
        }
      }),
    })
  } catch (error) {
    console.error('[gradebook] detail:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})


/**
 * Hoja del estudiante dentro de la libreta (la "hoja de calificaciones" del liceo).
 *
 * El docente la necesita **al calificar**: adecuaciones, materias que arrastra y cómo llegó al
 * curso son datos que tiene en cuenta para poner la nota. Por eso va acá y no en la ficha
 * académica, que exige alcance ALL y el docente no tiene.
 *
 * Sólo devuelve estudiantes del roster de ESTA libreta: con `gradebook.read` propio, un docente no
 * puede consultar por id a cualquier alumno del liceo.
 */
r.get('/:id/students/:studentId', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const roster = await loadRosterForScope({
      schoolYearId: ctx.row.schoolYearId,
      courseOfferingId: ctx.row.courseOfferingId,
      orientationId: ctx.row.orientationId,
      courseOrientationId: ctx.row.courseOrientationId,
    })
    const inRoster = roster.find((s) => s.studentId === req.params.studentId)
    if (!inRoster) {
      return res.status(403).json({
        message: 'Ese estudiante no pertenece al grupo de esta libreta.',
        code: 'STUDENT_NOT_IN_ROSTER',
      })
    }

    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        documentId: true,
        birthDate: true,
        admittedFrom: true,
        photo: { select: { mimeType: true, byteSize: true, updatedAt: true } },
        accommodations: {
          select: {
            id: true,
            kind: true,
            summary: true,
            externalUrl: true,
            validFrom: true,
            validUntil: true,
          },
        },
        pendingSubjects: {
          select: {
            id: true,
            origin: true,
            apeDecember: true,
            apeFebruary: true,
            resolvedAt: true,
            subject: { select: { id: true, name: true } },
            schoolYear: { select: { id: true, code: true } },
          },
        },
        enrollments: {
          select: {
            schoolYearId: true,
            academicResult: true,
            apeReferred: true,
            schoolYear: { select: { code: true } },
          },
        },
      },
    })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const current = student.enrollments.find((e) => e.schoolYearId === ctx.row.schoolYearId) ?? null
    // "Cómo promovió" es el resultado del ciclo ANTERIOR: el del corriente recién se completa al
    // cerrar el año, así que mirarlo acá mostraría siempre un hueco.
    const currentCode = current?.schoolYear?.code ?? null
    const previous = student.enrollments
      .filter((e) => (currentCode == null ? false : (e.schoolYear?.code ?? 0) < currentCode))
      .sort((a, b) => (b.schoolYear?.code ?? 0) - (a.schoolYear?.code ?? 0))[0] ?? null

    return res.json({
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        documentId: student.documentId,
        birthDate: student.birthDate ? student.birthDate.toISOString() : null,
        photo: student.photo
          ? {
              mimeType: student.photo.mimeType,
              byteSize: student.photo.byteSize,
              updatedAt: student.photo.updatedAt.toISOString(),
            }
          : null,
      },
      admission: admissionSummary({
        admittedFrom: student.admittedFrom,
        previousResult: previous?.academicResult ?? null,
        previousYearCode: previous?.schoolYear?.code ?? null,
      }),
      apeReferred: current?.apeReferred ?? false,
      pendingSubjects: unresolvedPendingSubjects(student.pendingSubjects).map((row) => ({
        id: row.id,
        subjectName: row.subject?.name ?? '—',
        schoolYearCode: row.schoolYear?.code ?? null,
        origin: row.origin,
        apeDecember: row.apeDecember,
        apeFebruary: row.apeFebruary,
      })),
      accommodations: currentAccommodations(student.accommodations).map((row) => ({
        id: row.id,
        kind: row.kind,
        summary: row.summary,
        externalUrl: row.externalUrl,
      })),
      // Las inasistencias no van acá todavía: hoy el conteo de la libreta es por materia y el
      // liceo las quiere globales. Se resuelve junto con la media falta.
    })
  } catch (error) {
    console.error('[gradebook] student sheet:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})


/**
 * Foto del estudiante, servida desde la libreta.
 *
 * Existe aparte de `GET /admin/students/:id/photo` porque aquélla exige `students.manage`, que es
 * de administración: el docente no la tiene y se quedaría con el recuadro vacío. Acá el control es
 * el mismo que en la hoja — el estudiante tiene que pertenecer al grupo de ESTA libreta.
 */
r.get('/:id/students/:studentId/photo', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const roster = await loadRosterForScope({
      schoolYearId: ctx.row.schoolYearId,
      courseOfferingId: ctx.row.courseOfferingId,
      orientationId: ctx.row.orientationId,
      courseOrientationId: ctx.row.courseOrientationId,
    })
    if (!roster.some((s) => s.studentId === req.params.studentId)) {
      return res.status(403).json({ code: 'STUDENT_NOT_IN_ROSTER', message: 'Ese estudiante no es de este grupo.' })
    }

    const photo = await (prisma as any).studentPhoto.findUnique({
      where: { studentId: req.params.studentId },
    })
    if (!photo) return res.status(404).json({ message: 'El estudiante no tiene foto' })

    const etag = photoETag(photo.updatedAt, photo.byteSize)
    res.setHeader('ETag', etag)
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate')
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Content-Disposition', 'inline')
    if (req.headers['if-none-match'] === etag) return res.status(304).end()

    res.setHeader('Content-Type', photo.mimeType)
    return res.send(photo.bytes)
  } catch (error) {
    console.error('[gradebook] student photo:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})


// ─── Evaluaciones y calificaciones (RF-040 a RF-043) ────────────────────────

const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha inválida')

const assessmentSchema = z.object({
  periodId: z.string().uuid(),
  date: ymdSchema,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).nullish(),
  activityTypeId: z.string().uuid().nullish(),
  gradingScaleId: z.string().uuid(),
  notes: z.string().trim().max(2000).nullish(),
})

const assessmentUpdateSchema = assessmentSchema.partial()

const gradeEntrySchema = z.object({
  studentId: z.string().uuid(),
  valueHundredths: z.number().int().nullish(),
  scaleLevelId: z.string().uuid().nullish(),
  isAbsent: z.boolean().optional(),
  comment: z.string().trim().max(500).nullish(),
})

const saveGradesSchema = z.object({
  entries: z.array(gradeEntrySchema).min(1).max(200),
  reason: z.string().trim().max(500).nullish(),
})

/** Día civil a mediodía UTC: en UTC-3 un `T00:00Z` se lee como el día anterior. */
function parseYmd(value: string): Date {
  return new Date(`${value}T12:00:00.000Z`)
}

function serializeAssessment(row: any) {
  return {
    id: row.id,
    periodId: row.periodId,
    period: row.period ? { id: row.period.id, name: row.period.name, code: row.period.code } : null,
    date: row.date.toISOString().slice(0, 10),
    title: row.title,
    description: row.description,
    activityType: row.activityType ? { id: row.activityType.id, name: row.activityType.name } : null,
    gradingScale: row.gradingScale
      ? {
          id: row.gradingScale.id,
          name: row.gradingScale.name,
          kind: row.gradingScale.kind,
          decimals: row.gradingScale.decimals,
          minValueHundredths: row.gradingScale.minValueHundredths,
          maxValueHundredths: row.gradingScale.maxValueHundredths,
          levels: row.gradingScale.levels ?? [],
        }
      : null,
    notes: row.notes,
    source: row.source,
    gradedCount: row._count?.grades ?? 0,
  }
}

const ASSESSMENT_INCLUDE = {
  period: { select: { id: true, name: true, code: true } },
  activityType: { select: { id: true, name: true } },
  gradingScale: { include: { levels: { orderBy: { sortOrder: 'asc' as const } } } },
  _count: { select: { grades: true } },
}

/** Evaluaciones de la libreta, opcionalmente filtradas por período. */
r.get('/:id/assessments', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : undefined
    const rows = await prisma.assessment.findMany({
      where: { gradeBookId: ctx.row.id, deletedAt: null, ...(periodId ? { periodId } : {}) },
      include: ASSESSMENT_INCLUDE,
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    })
    return res.json({ data: rows.map(serializeAssessment) })
  } catch (error) {
    console.error('[gradebook] assessments list:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** El período tiene que pertenecer al ciclo y al nivel de la libreta. */
async function assertPeriodFitsGradeBook(periodId: string, row: any): Promise<string | null> {
  const period = await prisma.academicPeriod.findUnique({
    where: { id: periodId },
    select: { schoolYearId: true, level: true, isActive: true },
  })
  if (!period) return 'El período no existe.'
  if (!period.isActive) return 'El período está desactivado.'
  if (period.schoolYearId !== row.schoolYearId) return 'El período es de otro ciclo lectivo.'
  const level = row.courseOffering?.course?.level ?? null
  if (level && period.level !== level) return `El período no corresponde a ${level}.`
  return null
}

r.post('/:id/assessments', requirePermission('gradebook.grade'), async (req: any, res) => {
  const parsed = assessmentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return
    if (!ctx.access.canGrade) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }

    const d = parsed.data
    const periodError = await assertPeriodFitsGradeBook(d.periodId, ctx.row)
    if (periodError) return res.status(400).json({ message: periodError, code: 'PERIOD_MISMATCH' })

    const created = await prisma.assessment.create({
      data: {
        gradeBookId: ctx.row.id,
        periodId: d.periodId,
        date: parseYmd(d.date),
        title: d.title,
        description: d.description ?? null,
        activityTypeId: d.activityTypeId ?? null,
        gradingScaleId: d.gradingScaleId,
        notes: d.notes ?? null,
        createdByUserId: req.user?.id ?? req.user?.sub,
      },
      include: ASSESSMENT_INCLUDE,
    })

    recordAuditEvent({
      action: AuditAction.ASSESSMENT_CREATED,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
      entityType: 'Assessment',
      entityId: created.id,
      metadata: { gradeBookId: ctx.row.id, title: created.title } as never,
    })
    return res.status(201).json({ data: serializeAssessment(created) })
  } catch (error) {
    console.error('[gradebook] assessment create:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Carga la evaluación y resuelve si quien pide puede escribirla.
 * Responde el error por su cuenta y devuelve `null`.
 */
async function loadAssessmentContext(req: any, res: any) {
  const ctx = await loadContext(req, res)
  if (!ctx) return null

  const assessment = await prisma.assessment.findFirst({
    where: { id: req.params.assessmentId, gradeBookId: ctx.row.id, deletedAt: null },
    include: ASSESSMENT_INCLUDE,
  })
  if (!assessment) {
    res.status(404).json({ message: 'Evaluación no encontrada' })
    return null
  }

  const userId = req.user?.id ?? req.user?.sub
  const [gradeScope, manageScope] = await Promise.all([
    userPermissionScope(userId, 'gradebook.grade', req.user?.role),
    userPermissionScope(userId, 'gradebook.manage', req.user?.role),
  ])
  const { editWindowDays } = await getGradeBookSettings()

  const permissions = resolveGradeEditPermissions({
    gradeScope,
    canManage: manageScope !== null,
    isResponsible: ctx.access.level === 'OWNER' || ctx.access.level === 'SUBSTITUTE',
    assessmentDate: assessment.date,
    windowDays: editWindowDays,
    gradeBookStatus: ctx.row.status,
  })

  // Un período cerrado congela sus evaluaciones: si no, se podría cambiar una nota parcial
  // después del cierre y el cierre dejaría de significar algo. Manda sobre la ventana de edición.
  const gradeBookPeriod = await prisma.gradeBookPeriod.findUnique({
    where: { gradeBookId_periodId: { gradeBookId: ctx.row.id, periodId: assessment.periodId } },
    select: { status: true },
  })
  const block = periodWriteBlock({
    periodStatus: gradeBookPeriod?.status ?? null,
    gradeBookStatus: ctx.row.status,
  })
  const effective = block === 'CLOSED'
    ? { ...permissions, canEdit: false, blockedReason: 'PERIOD_CLOSED' as const }
    : permissions

  return { ...ctx, assessment, permissions: effective, userId }
}

r.patch('/:id/assessments/:assessmentId', requirePermission('gradebook.grade'), async (req: any, res) => {
  const parsed = assessmentUpdateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadAssessmentContext(req, res)
    if (!ctx) return
    if (!ctx.permissions.canEdit) {
      const reason = ctx.permissions.blockedReason!
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES[reason], code: reason })
    }

    const d = parsed.data
    if (d.periodId) {
      const periodError = await assertPeriodFitsGradeBook(d.periodId, ctx.row)
      if (periodError) return res.status(400).json({ message: periodError, code: 'PERIOD_MISMATCH' })
    }

    const updated = await prisma.assessment.update({
      where: { id: ctx.assessment.id },
      data: {
        ...(d.periodId === undefined ? {} : { periodId: d.periodId }),
        ...(d.date === undefined ? {} : { date: parseYmd(d.date) }),
        ...(d.title === undefined ? {} : { title: d.title }),
        ...(d.description === undefined ? {} : { description: d.description ?? null }),
        ...(d.activityTypeId === undefined ? {} : { activityTypeId: d.activityTypeId ?? null }),
        ...(d.gradingScaleId === undefined ? {} : { gradingScaleId: d.gradingScaleId }),
        ...(d.notes === undefined ? {} : { notes: d.notes ?? null }),
      },
      include: ASSESSMENT_INCLUDE,
    })

    await auditGradeWrite(req, ctx.permissions.outsideWindow, {
      action: AuditAction.ASSESSMENT_UPDATED,
      entityId: updated.id,
      metadata: { gradeBookId: ctx.row.id, outsideWindow: ctx.permissions.outsideWindow },
    })
    return res.json({ data: serializeAssessment(updated) })
  } catch (error) {
    console.error('[gradebook] assessment update:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Baja lógica: una evaluación con notas cargadas no se destruye (§6.2). */
r.delete('/:id/assessments/:assessmentId', requirePermission('gradebook.grade'), async (req: any, res) => {
  try {
    const ctx = await loadAssessmentContext(req, res)
    if (!ctx) return
    if (!ctx.permissions.canEdit) {
      const reason = ctx.permissions.blockedReason!
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES[reason], code: reason })
    }

    await prisma.assessment.update({
      where: { id: ctx.assessment.id },
      data: { deletedAt: new Date() },
    })
    await auditGradeWrite(req, true, {
      action: AuditAction.ASSESSMENT_DELETED,
      entityId: ctx.assessment.id,
      metadata: { gradeBookId: ctx.row.id, title: ctx.assessment.title },
    })
    return res.json({ ok: true, deleted: true })
  } catch (error) {
    console.error('[gradebook] assessment delete:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Auditoría de una escritura de la libreta.
 *
 * Fuera de plazo (o al dar de baja) se **espera** el write: es la misma regla que el pase de lista
 * —cuando la acción es excepcional, la trazabilidad no puede ser fire-and-forget.
 */
async function auditGradeWrite(
  req: any,
  guaranteed: boolean,
  input: { action: AuditAction; entityId: string; metadata: Record<string, unknown> },
) {
  const payload = {
    action: input.action,
    actorUserId: req.user?.id ?? req.user?.sub ?? null,
    req,
    entityType: 'Assessment',
    entityId: input.entityId,
    metadata: input.metadata as never,
  }
  if (guaranteed) await recordAuditEventNow(payload)
  else recordAuditEvent(payload)
}

/** Planilla de la evaluación: cohorte + lo ya cargado (RF-043). */
r.get('/:id/assessments/:assessmentId/grades', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadAssessmentContext(req, res)
    if (!ctx) return

    const [students, grades] = await Promise.all([
      loadRosterForScope({
        schoolYearId: ctx.row.schoolYearId,
        courseOfferingId: ctx.row.courseOfferingId,
        orientationId: ctx.row.orientationId,
        courseOrientationId: ctx.row.courseOrientationId,
      }),
      prisma.assessmentGrade.findMany({
        where: { assessmentId: ctx.assessment.id },
        select: {
          studentId: true,
          valueHundredths: true,
          scaleLevelId: true,
          isAbsent: true,
          comment: true,
          gradedAt: true,
        },
      }),
    ])

    return res.json({
      assessment: serializeAssessment(ctx.assessment),
      permissions: {
        canEdit: ctx.permissions.canEdit,
        blockedReason: ctx.permissions.blockedReason,
        editableUntil: ctx.permissions.editableUntil.toISOString(),
        outsideWindow: ctx.permissions.outsideWindow,
      },
      students,
      grades,
    })
  } catch (error) {
    console.error('[gradebook] grades list:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:id/assessments/:assessmentId/grades', requirePermission('gradebook.grade'), async (req: any, res) => {
  const parsed = saveGradesSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadAssessmentContext(req, res)
    if (!ctx) return
    if (!ctx.permissions.canEdit) {
      const reason = ctx.permissions.blockedReason!
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES[reason], code: reason })
    }

    const roster = await loadRosterForScope({
      schoolYearId: ctx.row.schoolYearId,
      courseOfferingId: ctx.row.courseOfferingId,
      orientationId: ctx.row.orientationId,
      courseOrientationId: ctx.row.courseOrientationId,
    })

    const scale = ctx.assessment.gradingScale
    // Se arman explícitas y no con spread: con `strict: false` la inferencia de zod marca todas
    // las claves como opcionales (ver la nota en `admin-academic-config.ts`).
    const entries = (parsed.data.entries ?? []).map((e) => ({
      studentId: e.studentId,
      valueHundredths: e.valueHundredths ?? null,
      scaleLevelId: e.scaleLevelId ?? null,
      isAbsent: e.isAbsent ?? false,
      comment: e.comment ?? null,
    }))

    const result = await saveGrades({
      assessmentId: ctx.assessment.id,
      entries,
      roster,
      scale: {
        id: scale.id,
        kind: scale.kind,
        minValueHundredths: scale.minValueHundredths,
        maxValueHundredths: scale.maxValueHundredths,
        levels: scale.levels,
      },
      actorUserId: ctx.userId,
      // El origen distingue la carga del docente de la corrección de administración, que es lo
      // que después permite auditar "quién cambió esta nota y por qué".
      origin: ctx.permissions.outsideWindow ? 'ADMIN_CORRECTION' : 'TEACHER',
      reason: parsed.data.reason ?? null,
    })

    await auditGradeWrite(req, ctx.permissions.outsideWindow, {
      action: result.revisions > 0 ? AuditAction.GRADE_UPDATED : AuditAction.GRADE_ENTERED,
      entityId: ctx.assessment.id,
      metadata: { gradeBookId: ctx.row.id, ...result, outsideWindow: ctx.permissions.outsideWindow },
    })
    return res.json({ data: result })
  } catch (error) {
    if (error instanceof GradingError) {
      return res.status(error.httpStatus).json({ message: error.message, code: error.code, detail: error.details })
    }
    console.error('[gradebook] grades save:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Opciones para armar una evaluación: períodos del ciclo y nivel de la libreta, escalas activas y
 * tipos de actividad disponibles.
 *
 * Existe porque el docente **no** puede pegarle a `/admin/academic-config` (eso exige
 * `academic-config.manage`). Acá todo viene ya acotado a la libreta, así que no hace falta que el
 * cliente filtre ni que se le abra la parametrización entera.
 */
r.get('/:id/options', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const level = (ctx.row as any).courseOffering?.course?.level ?? null
    const userId = req.user?.id ?? req.user?.sub

    const [periods, scales, activityTypes] = await Promise.all([
      prisma.academicPeriod.findMany({
        where: { schoolYearId: ctx.row.schoolYearId, isActive: true, ...(level ? { level } : {}) },
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          code: true,
          name: true,
          requiresConceptualJudgement: true,
          requiresGeneralGrade: true,
        },
      }),
      prisma.gradingScale.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { levels: { orderBy: { sortOrder: 'asc' } } },
      }),
      // Los globales del catálogo más los propios del docente (RF-041).
      prisma.activityType.findMany({
        where: {
          isActive: true,
          OR: [{ scope: 'GLOBAL' }, { scope: 'TEACHER', ownerUserId: userId }],
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, code: true, name: true, scope: true },
      }),
    ])

    return res.json({ periods, scales, activityTypes })
  } catch (error) {
    console.error('[gradebook] options:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Cierre de período y juicio conceptual (RF-051, RF-052, RF-053) ─────────

const periodGradeEntrySchema = z.object({
  studentId: z.string().uuid(),
  valueHundredths: z.number().int().nullish(),
  conceptualJudgement: z.string().trim().max(2000).nullish(),
  /** Conducta en esta asignatura. El docente la pone junto con la nota, al cerrar. */
  conductValueHundredths: z.number().int().nullish(),
})

const savePeriodGradesSchema = z.object({
  entries: z.array(periodGradeEntrySchema).min(1).max(200),
})

const reopenSchema = z.object({
  reason: z.string().trim().min(3).max(500),
})

/**
 * Carga (o crea al vuelo) el estado del período dentro de la libreta.
 *
 * Se materializa recién cuando alguien lo mira: pre-crear una fila por cada período de cada
 * libreta llenaría la tabla de filas OPEN que nunca se usan.
 */
async function ensureGradeBookPeriod(gradeBookId: string, periodId: string) {
  const existing = await prisma.gradeBookPeriod.findUnique({
    where: { gradeBookId_periodId: { gradeBookId, periodId } },
  })
  if (existing) return existing
  return prisma.gradeBookPeriod.create({ data: { gradeBookId, periodId } })
}

/** Estado de todos los períodos de la libreta, con su avance. */
r.get('/:id/periods', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const level = (ctx.row as any).courseOffering?.course?.level ?? null
    const [periods, states, counts] = await Promise.all([
      prisma.academicPeriod.findMany({
        where: { schoolYearId: ctx.row.schoolYearId, isActive: true, ...(level ? { level } : {}) },
        orderBy: { sortOrder: 'asc' },
      }),
      prisma.gradeBookPeriod.findMany({
        where: { gradeBookId: ctx.row.id },
        include: { _count: { select: { grades: true } } },
      }),
      prisma.assessment.groupBy({
        by: ['periodId'],
        where: { gradeBookId: ctx.row.id, deletedAt: null },
        _count: { _all: true },
      }),
    ])

    const stateByPeriod = new Map(states.map((row) => [row.periodId, row]))
    const assessmentsByPeriod = new Map(counts.map((row) => [row.periodId, row._count._all]))

    return res.json({
      data: periods.map((period) => {
        const state = stateByPeriod.get(period.id)
        return {
          periodId: period.id,
          code: period.code,
          name: period.name,
          closesOn: serializeYmd(period.closesOn),
          requiresGeneralGrade: period.requiresGeneralGrade,
          requiresConceptualJudgement: period.requiresConceptualJudgement,
          status: state?.status ?? 'OPEN',
          closedAt: state?.closedAt ?? null,
          closedLate: state?.closedLate ?? false,
          reopenedAt: state?.reopenedAt ?? null,
          assessmentCount: assessmentsByPeriod.get(period.id) ?? 0,
          gradedStudents: state?._count.grades ?? 0,
        }
      }),
    })
  } catch (error) {
    console.error('[gradebook] periods:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Día civil a `YYYY-MM-DD`; `serializeYmd` de la config académica no está exportado acá. */
function serializeYmd(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

/**
 * Contexto de cierre: período, estado, cohorte y lo cargado.
 * Responde el error por su cuenta y devuelve `null`.
 */
async function loadClosureContext(req: any, res: any) {
  const ctx = await loadContext(req, res)
  if (!ctx) return null

  const period = await prisma.academicPeriod.findFirst({
    where: { id: req.params.periodId, schoolYearId: ctx.row.schoolYearId, isActive: true },
  })
  if (!period) {
    res.status(404).json({ message: 'Período no encontrado en este ciclo' })
    return null
  }

  const state = await ensureGradeBookPeriod(ctx.row.id, period.id)
  const [students, saved, assessments] = await Promise.all([
    loadRosterForScope({
      schoolYearId: ctx.row.schoolYearId,
      courseOfferingId: ctx.row.courseOfferingId,
      orientationId: ctx.row.orientationId,
      courseOrientationId: ctx.row.courseOrientationId,
    }),
    prisma.periodGrade.findMany({ where: { gradeBookPeriodId: state.id } }),
    prisma.assessment.findMany({
      where: { gradeBookId: ctx.row.id, periodId: period.id, deletedAt: null },
      include: { grades: { select: { studentId: true, valueHundredths: true, isAbsent: true } }, gradingScale: { include: { levels: { orderBy: { sortOrder: 'asc' } } } } },
    }),
  ])

  return { ...ctx, period, state, students, saved, assessments }
}

/**
 * Arma la fila de cada estudiante: sus notas del período y lo ya cerrado.
 *
 * **No promedia.** El liceo es explícito: ninguna libreta del docente hace promedio automático —la
 * calificación general del período la decide el docente—. El promedio sigue existiendo en la matriz
 * institucional y en la planilla de reunión, que es donde el pliego lo pide (RF-061) y donde de
 * verdad se usa para escolaridad y abanderados.
 *
 * Sí se informa `assessmentCount`, que no es un promedio: es cuántas notas cargó, y sirve para ver
 * de un vistazo a quién le falta.
 */
function buildClosureRows(ctx: any) {
  const savedByStudent = new Map(ctx.saved.map((row: any) => [row.studentId, row]))
  // Las ausencias no cuentan como nota: no son un cero, son "no rindió".
  const valuesByStudent = new Map<string, number[]>()
  for (const assessment of ctx.assessments) {
    for (const grade of assessment.grades) {
      if (grade.isAbsent || grade.valueHundredths == null) continue
      const bucket = valuesByStudent.get(grade.studentId) ?? []
      bucket.push(grade.valueHundredths)
      valuesByStudent.set(grade.studentId, bucket)
    }
  }

  const levels = ctx.assessments[0]?.gradingScale?.levels ?? []
  return ctx.students.map((student: any) => {
    const saved: any = savedByStudent.get(student.studentId)
    const values = valuesByStudent.get(student.studentId) ?? []
    const value = saved?.valueHundredths ?? null
    return {
      studentId: student.studentId,
      lastName: student.lastName,
      firstName: student.firstName,
      assessmentCount: values.length,
      valueHundredths: value,
      conceptualJudgement: saved?.conceptualJudgement ?? null,
      conductValueHundredths: saved?.conductValueHundredths ?? null,
      descriptor: describeValue(value, levels),
    }
  })
}

/** Planilla de cierre del período. */
r.get('/:id/periods/:periodId', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadClosureContext(req, res)
    if (!ctx) return

    const rows = buildClosureRows(ctx)
    const rules = {
      requiresGeneralGrade: ctx.period.requiresGeneralGrade,
      requiresConceptualJudgement: ctx.period.requiresConceptualJudgement,
    }

    return res.json({
      period: {
        id: ctx.period.id,
        code: ctx.period.code,
        name: ctx.period.name,
        closesOn: serializeYmd(ctx.period.closesOn),
        ...rules,
      },
      state: {
        status: ctx.state.status,
        closedAt: ctx.state.closedAt,
        closedLate: ctx.state.closedLate,
        reopenedAt: ctx.state.reopenedAt,
        reopenReason: ctx.state.reopenReason,
      },
      canEdit: ctx.access.canGrade && ctx.state.status !== 'CLOSED',
      blockers: closureBlockers(rows, rules),
      students: rows,
    })
  } catch (error) {
    console.error('[gradebook] closure sheet:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:id/periods/:periodId/grades', requirePermission('gradebook.grade'), async (req: any, res) => {
  const parsed = savePeriodGradesSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadClosureContext(req, res)
    if (!ctx) return
    if (!ctx.access.canGrade) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }

    const block = periodWriteBlock({ periodStatus: ctx.state.status, gradeBookStatus: ctx.row.status })
    if (block) {
      const code = block === 'CLOSED' ? 'PERIOD_CLOSED' : 'ARCHIVED'
      return res.status(409).json({ message: GRADE_BLOCK_MESSAGES[code], code })
    }

    const rosterById = new Map(ctx.students.map((s: any) => [s.studentId, s]))
    const entries = (parsed.data.entries ?? []).map((e) => ({
      studentId: e.studentId,
      valueHundredths: e.valueHundredths ?? null,
      conceptualJudgement: e.conceptualJudgement ?? null,
      conductValueHundredths: e.conductValueHundredths ?? null,
    }))
    const strangers = entries.filter((e) => !rosterById.has(e.studentId)).map((e) => e.studentId)
    if (strangers.length > 0) {
      return res.status(409).json({
        message: 'Hay estudiantes que no pertenecen al grupo de esta libreta.',
        code: 'STUDENT_NOT_IN_ROSTER',
        detail: { studentIds: strangers },
      })
    }

    const userId = req.user?.id ?? req.user?.sub
    await prisma.$transaction(
      entries.map((entry) => {
        const student: any = rosterById.get(entry.studentId)
        const data = {
          valueHundredths: entry.valueHundredths,
          conceptualJudgement: entry.conceptualJudgement,
          conductValueHundredths: entry.conductValueHundredths ?? null,
          updatedByUserId: userId,
        }
        return prisma.periodGrade.upsert({
          where: { gradeBookPeriodId_studentId: { gradeBookPeriodId: ctx.state.id, studentId: entry.studentId } },
          update: data,
          create: {
            gradeBookPeriodId: ctx.state.id,
            studentId: entry.studentId,
            // Snapshot de identidad, igual que en las calificaciones parciales.
            studentLastName: student.lastName,
            studentFirstName: student.firstName,
            studentDocumentId: student.documentId,
            ...data,
          },
        })
      }),
    )

    return res.json({ ok: true, saved: entries.length })
  } catch (error) {
    console.error('[gradebook] period grades save:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/periods/:periodId/close', requirePermission('gradebook.close'), async (req: any, res) => {
  try {
    const ctx = await loadClosureContext(req, res)
    if (!ctx) return
    if (!ctx.access.canGrade) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }
    if (ctx.state.status === 'CLOSED') {
      return res.status(409).json({ message: 'El período ya está cerrado.', code: 'ALREADY_CLOSED' })
    }

    const rows = buildClosureRows(ctx)
    const blockers = closureBlockers(rows, {
      requiresGeneralGrade: ctx.period.requiresGeneralGrade,
      requiresConceptualJudgement: ctx.period.requiresConceptualJudgement,
    })
    if (blockers.length > 0) {
      // Se devuelven todos juntos: la UI marca las filas que faltan de una vez.
      return res.status(409).json({
        message: CLOSURE_BLOCKER_MESSAGES[blockers[0].code],
        code: blockers[0].code,
        detail: { blockers },
      })
    }

    const now = new Date()
    const closedLate = isLateClosure(ctx.period.closesOn, now)
    await prisma.gradeBookPeriod.update({
      where: { id: ctx.state.id },
      data: {
        status: 'CLOSED',
        closedByUserId: req.user?.id ?? req.user?.sub,
        closedAt: now,
        closedLate,
      },
    })

    // Cerrar es un hito reglamentario: la trazabilidad se espera, no se dispara y se olvida.
    await recordAuditEventNow({
      action: AuditAction.GRADE_PERIOD_CLOSED,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
      entityType: 'GradeBookPeriod',
      entityId: ctx.state.id,
      metadata: { gradeBookId: ctx.row.id, periodCode: ctx.period.code, closedLate, students: rows.length } as never,
    })

    return res.json({ ok: true, closedAt: now.toISOString(), closedLate })
  } catch (error) {
    console.error('[gradebook] period close:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Reapertura de un período cerrado.
 *
 * Sólo `gradebook.manage`, con motivo obligatorio. **No borra el cierre previo**: `closedAt` y
 * `closedByUserId` se conservan y la reapertura se suma como un evento más. Es lo que después
 * permite que un visado hecho sobre el cierre anterior siga existiendo (RF-083).
 */
r.post('/:id/periods/:periodId/reopen', requirePermission('gradebook.manage', 'all'), async (req: any, res) => {
  const parsed = reopenSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Hace falta un motivo para reabrir.', errors: parsed.error.errors })
  }

  try {
    const ctx = await loadClosureContext(req, res)
    if (!ctx) return
    if (ctx.state.status !== 'CLOSED') {
      return res.status(409).json({ message: 'El período no está cerrado.', code: 'NOT_CLOSED' })
    }
    if (ctx.row.status === 'ARCHIVED') {
      return res.status(409).json({ message: GRADE_BLOCK_MESSAGES.ARCHIVED, code: 'ARCHIVED' })
    }

    const now = new Date()
    await prisma.gradeBookPeriod.update({
      where: { id: ctx.state.id },
      data: {
        status: 'REOPENED',
        reopenedByUserId: req.user?.id ?? req.user?.sub,
        reopenedAt: now,
        reopenReason: parsed.data.reason,
      },
    })

    await recordAuditEventNow({
      action: AuditAction.GRADE_PERIOD_REOPENED,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
      entityType: 'GradeBookPeriod',
      entityId: ctx.state.id,
      metadata: {
        gradeBookId: ctx.row.id,
        periodCode: ctx.period.code,
        reason: parsed.data.reason,
        previousClosedAt: ctx.state.closedAt,
      } as never,
    })

    return res.json({ ok: true, reopenedAt: now.toISOString() })
  } catch (error) {
    console.error('[gradebook] period reopen:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Importación desde Moodle ───────────────────────────────────────────────

const importSchema = z.object({
  moodleGradeItemIds: z.array(z.number().int()).min(1).max(50),
  periodId: z.string().uuid(),
  gradingScaleId: z.string().uuid(),
})

/** Ids de los estudiantes de la cohorte de la libreta. */
async function rosterIdsOf(row: any): Promise<Set<string>> {
  const students = await loadRosterForScope({
    schoolYearId: row.schoolYearId,
    courseOfferingId: row.courseOfferingId,
    orientationId: row.orientationId,
    courseOrientationId: row.courseOrientationId,
  })
  return new Set(students.map((s) => s.studentId))
}

function gradeBookRefOf(row: any) {
  return {
    id: row.id,
    schoolYearId: row.schoolYearId,
    courseOfferingId: row.courseOfferingId,
    subjectId: row.subjectId,
    orientationId: row.orientationId,
    courseOrientationId: row.courseOrientationId,
  }
}

/** Qué traería la importación, sin escribir nada. */
r.get('/:id/moodle/preview', requirePermission('gradebook.grade'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return
    if (!ctx.access.canGrade) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }

    const roster = await rosterIdsOf(ctx.row)
    const preview = await buildImportPreview(gradeBookRefOf(ctx.row), roster)
    return res.json(preview)
  } catch (error) {
    if (error instanceof GradingError) {
      return res.status(error.httpStatus).json({ message: error.message, code: error.code })
    }
    console.error('[gradebook] moodle preview:', error)
    return res.status(502).json({ message: 'Error comunicándose con Moodle.', code: 'MOODLE_ERROR' })
  }
})

/**
 * Crea o actualiza la evaluación de un ítem de Moodle.
 *
 * La clave `(gradeBookId, moodleGradeItemId)` es lo que hace la importación idempotente: reimportar
 * el mismo ítem actualiza la evaluación que ya generó, nunca crea una segunda.
 */
async function upsertImportedAssessment(params: {
  gradeBookId: string
  item: { id: number; name: string }
  periodId: string
  gradingScaleId: string
  userId: string
}) {
  const existing = await prisma.assessment.findUnique({
    where: {
      gradeBookId_moodleGradeItemId: {
        gradeBookId: params.gradeBookId,
        moodleGradeItemId: params.item.id,
      },
    },
  })
  if (existing) {
    // El período y la escala no se pisan: pudo haberlos movido el docente después de importar.
    if (existing.deletedAt) {
      return prisma.assessment.update({ where: { id: existing.id }, data: { deletedAt: null } })
    }
    return existing
  }
  return prisma.assessment.create({
    data: {
      gradeBookId: params.gradeBookId,
      periodId: params.periodId,
      date: new Date(),
      title: params.item.name,
      gradingScaleId: params.gradingScaleId,
      source: 'MOODLE_IMPORT',
      moodleGradeItemId: params.item.id,
      createdByUserId: params.userId,
    },
  })
}

r.post('/:id/moodle/import', requirePermission('gradebook.grade'), async (req: any, res) => {
  const parsed = importSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return
    if (!ctx.access.canGrade) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }

    // Un período cerrado no se toca ni siquiera desde Moodle: se avisa y no se fuerza.
    const state = await prisma.gradeBookPeriod.findUnique({
      where: { gradeBookId_periodId: { gradeBookId: ctx.row.id, periodId: parsed.data.periodId } },
      select: { status: true },
    })
    const block = periodWriteBlock({
      periodStatus: state?.status ?? null,
      gradeBookStatus: ctx.row.status,
    })
    if (block) {
      const code = block === 'CLOSED' ? 'PERIOD_CLOSED' : 'ARCHIVED'
      return res.status(409).json({ message: GRADE_BLOCK_MESSAGES[code], code })
    }

    const scale = await prisma.gradingScale.findUnique({
      where: { id: parsed.data.gradingScaleId },
      include: { levels: { orderBy: { sortOrder: 'asc' } } },
    })
    if (!scale?.minValueHundredths || !scale.maxValueHundredths) {
      return res.status(400).json({
        message: 'La escala elegida no declara un rango numérico; no se puede convertir desde Moodle.',
        code: 'SCALE_WITHOUT_RANGE',
      })
    }

    const gradeBook = gradeBookRefOf(ctx.row)
    const [{ report }, students] = await Promise.all([
      loadMoodleReport(gradeBook),
      loadRosterForScope({
        schoolYearId: ctx.row.schoolYearId,
        courseOfferingId: ctx.row.courseOfferingId,
        orientationId: ctx.row.orientationId,
        courseOrientationId: ctx.row.courseOrientationId,
      }),
    ])
    const rosterIds = new Set(students.map((s) => s.studentId))
    const studentByMoodleUser = await mapMoodleUsersToStudents(report.grades)
    const wanted = new Set(parsed.data.moodleGradeItemIds ?? [])
    const userId = req.user?.id ?? req.user?.sub

    const results = []
    for (const item of report.items.filter((i) => wanted.has(i.id))) {
      const plan = buildImportPlan({
        item,
        grades: report.grades,
        studentByMoodleUser,
        rosterStudentIds: rosterIds,
        target: { minHundredths: scale.minValueHundredths, maxHundredths: scale.maxValueHundredths },
      })
      const assessment = await upsertImportedAssessment({
        gradeBookId: ctx.row.id,
        item,
        periodId: parsed.data.periodId,
        gradingScaleId: scale.id,
        userId,
      })

      const saved = plan.entries.length
        ? await saveGrades({
            assessmentId: assessment.id,
            entries: plan.entries,
            roster: students,
            scale: {
              id: scale.id,
              kind: scale.kind,
              minValueHundredths: scale.minValueHundredths,
              maxValueHundredths: scale.maxValueHundredths,
              levels: scale.levels,
            },
            actorUserId: userId,
            // Reimportar deja revisión con este origen: se puede rastrear qué nota vino de Moodle.
            origin: 'MOODLE_IMPORT',
            reason: `Importado desde Moodle (ítem ${item.id})`,
          })
        : { created: 0, updated: 0, unchanged: 0, revisions: 0 }

      results.push({
        moodleGradeItemId: item.id,
        name: item.name,
        assessmentId: assessment.id,
        skippedUnmatched: plan.skippedUnmatched,
        ...saved,
      })
    }

    await recordAuditEventNow({
      action: AuditAction.MOODLE_GRADES_IMPORTED,
      actorUserId: userId ?? null,
      req,
      entityType: 'GradeBook',
      entityId: ctx.row.id,
      metadata: { periodId: parsed.data.periodId, items: results } as never,
    })

    return res.json({ data: results })
  } catch (error) {
    if (error instanceof GradingError) {
      return res.status(error.httpStatus).json({ message: error.message, code: error.code, detail: error.details })
    }
    console.error('[gradebook] moodle import:', error)
    return res.status(502).json({ message: 'Error comunicándose con Moodle.', code: 'MOODLE_ERROR' })
  }
})

// ─── Observaciones y mensajería (RF-090, RF-091) ────────────────────────────

const messageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  periodId: z.string().uuid().nullish(),
  parentId: z.string().uuid().nullish(),
})

const MESSAGE_INCLUDE = {
  author: { select: { id: true, name: true } },
  period: { select: { id: true, name: true } },
}

/**
 * Hilos de la libreta.
 *
 * Cualquiera que pueda leer la libreta lee el intercambio: es un espacio compartido entre docente,
 * adscripción, dirección e inspección, y separarlo por rol lo volvería inútil.
 */
r.get('/:id/messages', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const messages = await prisma.gradeBookMessage.findMany({
      where: { gradeBookId: ctx.row.id },
      include: MESSAGE_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 500,
    })
    return res.json({ data: messages })
  } catch (error) {
    console.error('[gradebook] messages:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/:id/messages', requirePermission('gradebook.read'), async (req: any, res) => {
  const parsed = messageSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    if (ctx.row.status === 'ARCHIVED') {
      return res.status(409).json({
        message: GRADE_BLOCK_MESSAGES.ARCHIVED,
        code: 'SCHOOL_YEAR_CLOSED',
      })
    }

    const d = parsed.data
    if (d.parentId) {
      // Un hilo no puede cruzar libretas: responder a un mensaje de otra sería filtrar contenido.
      const parent = await prisma.gradeBookMessage.findFirst({
        where: { id: d.parentId, gradeBookId: ctx.row.id },
        select: { id: true },
      })
      if (!parent) return res.status(404).json({ message: 'El mensaje al que respondés no existe en esta libreta.' })
    }

    const userId = req.user?.id ?? req.user?.sub
    const created = await prisma.gradeBookMessage.create({
      data: {
        gradeBookId: ctx.row.id,
        periodId: d.periodId ?? null,
        authorUserId: userId,
        authorRoleCode: String(req.user?.role ?? ''),
        body: d.body,
        parentId: d.parentId ?? null,
      },
      include: MESSAGE_INCLUDE,
    })

    const recipients = await resolveGradeBookRecipients(ctx.row.id, userId)
    await notifyGradeBook(
      recipients,
      messageNotification({
        subjectName: (ctx.row as any).subject?.name ?? 'la libreta',
        authorName: created.author?.name ?? null,
        body: created.body,
        gradeBookId: ctx.row.id,
      }),
    )

    return res.status(201).json({ data: created })
  } catch (error) {
    console.error('[gradebook] message create:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Exportaciones (RF-120) ─────────────────────────────────────────────────

/** Nombre de archivo seguro: sin acentos ni separadores de ruta. */
export function exportFilename(parts: readonly string[], extension: string): string {
  const slug = parts
    .join('-')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/(?:^-|-$)/g, '')
    .toLowerCase()
  return `${slug || 'libreta'}.${extension}`
}

function metaOf(row: any): GradeBookMeta {
  return {
    schoolYearLabel: row.courseOffering.schoolYear.label,
    courseName: row.courseOffering.course.name,
    orientationName: orientationNameOf(row),
    subjectName: row.subject.name,
    teacherName: row.teacher?.name ?? null,
  }
}

/** Escala vigente de la libreta, para los decimales y los descriptores. */
async function scaleForGradeBook(gradeBookId: string) {
  const assessment = await prisma.assessment.findFirst({
    where: { gradeBookId, deletedAt: null },
    include: { gradingScale: { include: { levels: { orderBy: { sortOrder: 'asc' } } } } },
    orderBy: { createdAt: 'desc' },
  })
  if (assessment) return assessment.gradingScale
  return prisma.gradingScale.findFirst({
    where: { isActive: true },
    include: { levels: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  })
}

function sendBuffer(res: any, buffer: Buffer, filename: string, contentType: string) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', attachmentDisposition(filename))
  return res.send(buffer)
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** Excel de calificaciones y de cierre de la libreta (RF-120). */
r.get('/:id/exports/xlsx', requirePermission('exports.create'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const { row } = ctx
    const meta = metaOf(row)
    const scale = await scaleForGradeBook(row.id)
    const decimals = scale?.decimals ?? 0

    const [students, assessments, grades, periods] = await Promise.all([
      loadRosterForScope({
        schoolYearId: row.schoolYearId,
        courseOfferingId: row.courseOfferingId,
        orientationId: row.orientationId,
        courseOrientationId: row.courseOrientationId,
      }),
      prisma.assessment.findMany({
        where: { gradeBookId: row.id, deletedAt: null },
        include: { period: { select: { name: true } }, gradingScale: { select: { decimals: true } } },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      prisma.assessmentGrade.findMany({
        where: { assessment: { gradeBookId: row.id, deletedAt: null } },
        select: { assessmentId: true, studentId: true, valueHundredths: true, isAbsent: true },
      }),
      prisma.gradeBookPeriod.findMany({
        where: { gradeBookId: row.id },
        include: { period: { select: { name: true, sortOrder: true } }, grades: true },
        orderBy: { period: { sortOrder: 'asc' } },
      }),
    ])

    const workbook = new ExcelJS.Workbook()
    buildGradesSheet(
      workbook,
      meta,
      students,
      assessments.map((a) => ({
        id: a.id,
        title: a.title,
        date: a.date.toISOString().slice(0, 10),
        periodName: a.period?.name ?? null,
        decimals: a.gradingScale?.decimals ?? decimals,
      })),
      grades,
    )

    // Una hoja de cierre por período, para que el Excel sirva de archivo del año entero.
    for (const state of periods) {
      buildClosureSheet(
        workbook,
        meta,
        state.period.name,
        state.grades.map((grade) => ({
          studentId: grade.studentId,
          lastName: grade.studentLastName,
          firstName: grade.studentFirstName,
          documentId: grade.studentDocumentId,
          valueHundredths: grade.valueHundredths,
          descriptorLabel: describeValue(grade.valueHundredths, (scale?.levels ?? []) as never)?.label ?? null,
          conceptualJudgement: grade.conceptualJudgement,
        })),
        decimals,
      )
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    return sendBuffer(
      res,
      buffer,
      exportFilename([meta.subjectName, meta.courseName, meta.orientationName ?? '', meta.schoolYearLabel], 'xlsx'),
      XLSX_TYPE,
    )
  } catch (error) {
    console.error('[gradebook] export xlsx:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Arma las filas del PDF: cada estudiante con sus períodos cerrados. */
async function buildPdfStudents(row: any, levels: readonly any[], studentId?: string) {
  const periods = await prisma.gradeBookPeriod.findMany({
    where: { gradeBookId: row.id },
    include: {
      period: { select: { name: true, sortOrder: true } },
      grades: studentId ? { where: { studentId } } : true,
      endorsements: { orderBy: { occurredAt: 'desc' }, take: 1, where: { section: 'ALL' } },
    },
    orderBy: { period: { sortOrder: 'asc' } },
  })

  const byStudent = new Map<string, any>()
  for (const state of periods) {
    const endorsed = state.endorsements[0]?.status === 'ENDORSED' ? 'Visado' : null
    for (const grade of state.grades) {
      const entry = byStudent.get(grade.studentId) ?? {
        lastName: grade.studentLastName,
        firstName: grade.studentFirstName,
        documentId: grade.studentDocumentId,
        periods: [],
      }
      entry.periods.push({
        periodName: state.period.name,
        valueHundredths: grade.valueHundredths,
        descriptorLabel: describeValue(grade.valueHundredths, levels as never)?.label ?? null,
        conceptualJudgement: grade.conceptualJudgement,
        endorsementStatus: endorsed,
      })
      byStudent.set(grade.studentId, entry)
    }
  }

  return [...byStudent.values()].sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'))
}

/** PDF de la libreta completa (RF-120). */
r.get('/:id/exports/pdf', requirePermission('exports.create'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const scale = await scaleForGradeBook(ctx.row.id)
    const students = await buildPdfStudents(ctx.row, scale?.levels ?? [])
    const meta = metaOf(ctx.row)

    const buffer = await generateGradeBookPdf({ meta, students, decimals: scale?.decimals ?? 0 })
    return sendBuffer(
      res,
      buffer,
      exportFilename([meta.subjectName, meta.courseName, meta.schoolYearLabel], 'pdf'),
      'application/pdf',
    )
  } catch (error) {
    console.error('[gradebook] export pdf:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Informe individual de un estudiante (RF-120). */
r.get('/:id/exports/students/:studentId/pdf', requirePermission('exports.create'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const scale = await scaleForGradeBook(ctx.row.id)
    const students = await buildPdfStudents(ctx.row, scale?.levels ?? [], req.params.studentId)
    if (students.length === 0) {
      return res.status(404).json({ message: 'El estudiante no tiene cierres en esta libreta.' })
    }

    const meta = metaOf(ctx.row)
    const buffer = await generateStudentReportPdf({ meta, student: students[0], decimals: scale?.decimals ?? 0 })
    return sendBuffer(
      res,
      buffer,
      exportFilename([students[0].lastName, students[0].firstName, meta.subjectName], 'pdf'),
      'application/pdf',
    )
  } catch (error) {
    console.error('[gradebook] export student pdf:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Libro del Profesor: planificación y desarrollo del curso ───────────────

const planningSchema = z.object({
  formative: z.string().max(20000).nullish(),
  replanning: z.string().max(20000).nullish(),
  attachments: z.string().trim().max(2000).nullish(),
})

const developmentSchema = z.object({
  date: ymdSchema,
  hoursTaught: z.number().int().min(0).max(24).default(0),
  hoursNotTaught: z.number().int().min(0).max(24).default(0),
  description: z.string().trim().min(1).max(4000),
  attachments: z.string().trim().max(2000).nullish(),
})

/** La planificación se crea al vuelo la primera vez que alguien la abre. */
r.get('/:id/planning', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const planning = await prisma.gradeBookPlanning.findUnique({ where: { gradeBookId: ctx.row.id } })
    return res.json({
      data: planning ?? { gradeBookId: ctx.row.id, formative: null, replanning: null, attachments: null },
      canEdit: ctx.access.canGrade,
    })
  } catch (error) {
    console.error('[gradebook] planning:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/:id/planning', requirePermission('gradebook.plan'), async (req: any, res) => {
  const parsed = planningSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return
    if (!ctx.access.canPlan) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }
    if (ctx.row.status === 'ARCHIVED') {
      return res.status(409).json({ message: GRADE_BLOCK_MESSAGES.ARCHIVED, code: 'SCHOOL_YEAR_CLOSED' })
    }

    const d = parsed.data
    const data = {
      formative: d.formative ?? null,
      replanning: d.replanning ?? null,
      attachments: d.attachments ?? null,
      updatedByUserId: req.user?.id ?? req.user?.sub,
    }
    const saved = await prisma.gradeBookPlanning.upsert({
      where: { gradeBookId: ctx.row.id },
      update: data,
      create: { gradeBookId: ctx.row.id, ...data },
    })
    return res.json({ data: saved })
  } catch (error) {
    console.error('[gradebook] planning save:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Desarrollo del curso: el registro clase a clase, con el total de horas dictadas. */
r.get('/:id/development', requirePermission('gradebook.read'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return

    const from = typeof req.query.from === 'string' && isYmd(req.query.from) ? parseYmd(req.query.from) : undefined
    const to = typeof req.query.to === 'string' && isYmd(req.query.to) ? parseYmd(req.query.to) : undefined
    const search = typeof req.query.q === 'string' ? req.query.q.trim() : ''

    const entries = await prisma.courseDevelopmentEntry.findMany({
      where: {
        gradeBookId: ctx.row.id,
        ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(search ? { description: { contains: search, mode: 'insensitive' as const } } : {}),
      },
      orderBy: { date: 'desc' },
      take: 500,
    })

    // Los totales salen del conjunto completo, no del filtro: son del curso, no de la búsqueda.
    const totals = await prisma.courseDevelopmentEntry.aggregate({
      where: { gradeBookId: ctx.row.id },
      _sum: { hoursTaught: true, hoursNotTaught: true },
    })

    return res.json({
      data: entries.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) })),
      totals: {
        hoursTaught: totals._sum.hoursTaught ?? 0,
        hoursNotTaught: totals._sum.hoursNotTaught ?? 0,
      },
      canEdit: ctx.access.canGrade && ctx.row.status === 'ACTIVE',
    })
  } catch (error) {
    console.error('[gradebook] development:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

r.post('/:id/development', requirePermission('gradebook.plan'), async (req: any, res) => {
  const parsed = developmentSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return
    if (!ctx.access.canPlan) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }
    if (ctx.row.status === 'ARCHIVED') {
      return res.status(409).json({ message: GRADE_BLOCK_MESSAGES.ARCHIVED, code: 'SCHOOL_YEAR_CLOSED' })
    }

    const d = parsed.data
    const created = await prisma.courseDevelopmentEntry.create({
      data: {
        gradeBookId: ctx.row.id,
        date: parseYmd(d.date),
        hoursTaught: d.hoursTaught ?? 0,
        hoursNotTaught: d.hoursNotTaught ?? 0,
        description: d.description,
        attachments: d.attachments ?? null,
        createdByUserId: req.user?.id ?? req.user?.sub,
      },
    })
    return res.status(201).json({ data: { ...created, date: created.date.toISOString().slice(0, 10) } })
  } catch (error) {
    console.error('[gradebook] development create:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.delete('/:id/development/:entryId', requirePermission('gradebook.plan'), async (req: any, res) => {
  try {
    const ctx = await loadContext(req, res)
    if (!ctx) return
    if (!ctx.access.canPlan) {
      return res.status(403).json({ message: GRADE_BLOCK_MESSAGES.NOT_ASSIGNED, code: 'NOT_ASSIGNED' })
    }

    const deleted = await prisma.courseDevelopmentEntry.deleteMany({
      where: { id: req.params.entryId, gradeBookId: ctx.row.id },
    })
    if (deleted.count === 0) return res.status(404).json({ message: 'Registro no encontrado' })
    return res.json({ ok: true })
  } catch (error) {
    console.error('[gradebook] development delete:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
