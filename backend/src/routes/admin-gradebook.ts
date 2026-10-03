import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { attachmentDisposition } from '../services/exports/content-disposition.js'
import { requirePermission } from '../middlewares/auth.js'
import { loadAbsenceTotals } from '../services/student-attendance/absence-totals.js'
import { buildReportCard } from '../services/gradebook/report-card.js'
import { completionRequestBody } from '../services/gradebook/completeness.js'
import { periodScaleFor } from '../services/gradebook/period-scale.js'
import { loadPeriodCompleteness } from '../services/gradebook/completeness-loader.js'
import { completionRequestNotification } from '../services/gradebook/notifications.js'
import { generateReportCardPdf } from '../services/gradebook/exports/reportCardPdf.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { loadRosterForScope } from '../services/student-attendance/roster.js'
import { AuditAction } from '@prisma/client'
import { recordAuditEventNow } from '../services/audit-log.js'
import {
  endorsedNotification,
  notifyGradeBook,
  observationNotification,
  resolveGradeBookRecipients,
} from '../services/gradebook/notifications.js'
import { SECTION_LABELS } from '../services/gradebook/endorsement.js'
import { isReportCardPeriod, officialPeriodValue } from '../services/gradebook/period-closure.js'
import { userPermissionScope } from '../middlewares/auth.js'
import {
  assertCanTransition,
  assertPeriodClosed,
  blockingSections,
  canFinalize,
  currentStates,
  EndorsementError,
  MANDATORY_SECTIONS,
  pendingAgeDays,
  statusOf,
  type Section,
} from '../services/gradebook/endorsement.js'
import {
  buildMatrixRow,
  buildSubjectEvolution,
  describeCell,
  gradeBooksForGroup,
  hasSustainedDecline,
  isAtRisk,
  type MatrixCell,
  type StudentHistoryEntry,
} from '../services/gradebook/institutional.js'

/**
 * Vistas institucionales de la libreta (RF-031, RF-060, RF-061, RF-070).
 *
 * Montado bajo `/admin/gradebook` con `gradebook.read` de alcance ALL: adscripción, dirección,
 * inspección y administración. Son todas de **lectura derivada** — ningún indicador se persiste.
 */

const r = Router()


const matrixQuerySchema = z.object({
  courseOfferingId: z.string().uuid(),
  courseOrientationId: z.string().uuid().optional(),
  orientationId: z.string().uuid().optional(),
  periodId: z.string().uuid(),
})

/**
 * Períodos del ciclo para los filtros institucionales.
 *
 * Duplica en apariencia a `/admin/academic-config/periods`, pero aquel exige
 * `academic-config.manage` —sólo administración—, y adscripción, dirección e inspección necesitan
 * el desplegable sin poder editar la parametrización.
 */
r.get('/periods', async (req: any, res) => {
  try {
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const level = ['EBI', 'EMS'].includes(String(req.query.level)) ? String(req.query.level) : undefined
    // La reunión, el control y el boletín trabajan sobre los períodos con reunión (entregas,
    // diciembre, febrero): los tramos de trabajo no tienen R y no se informan. `all=true` los trae.
    // `reportCard=true` deja sólo las reuniones de boletín (entregas, semestres): es lo que mira
    // el control de libretas y los reportes, sin exámenes ni APE.
    const onlyMeetings = req.query.all !== 'true'
    const onlyReportCards = req.query.reportCard === 'true'
    const periods = await prisma.academicPeriod.findMany({
      where: {
        schoolYearId,
        isActive: true,
        ...(level ? { level: level as never } : {}),
        ...(onlyMeetings ? { isMeeting: true } : {}),
      },
      orderBy: [{ level: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        code: true,
        name: true,
        level: true,
        closesOn: true,
        kind: true,
        isMeeting: true,
        requiresGeneralGrade: true,
        requiresConceptualJudgement: true,
      },
    })
    return res.json({ data: onlyReportCards ? periods.filter(isReportCardPeriod) : periods })
  } catch (error) {
    console.error('[admin-gradebook] periods:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Grupos del ciclo: oferta más orientación, que es como se define un grupo en EduTrack. */
r.get('/groups', async (req: any, res) => {
  try {
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const offerings = await prisma.courseOffering.findMany({
      where: { schoolYearId, isActive: true, isOffered: true, visibleInFilters: true, course: { isActive: true } },
      include: {
        course: { select: { id: true, name: true, code: true, level: true, sortOrder: true } },
      },
      orderBy: { course: { sortOrder: 'asc' } },
    })
    const orientations = await prisma.courseOrientation.findMany({
      where: { schoolYearId, isActive: true, isOffered: true, visibleInFilters: true },
      include: { orientation: { select: { id: true, name: true } } },
    })

    const groups = offerings.flatMap((offering) => {
      const own = orientations.filter((o) => o.courseId === offering.courseId)
      const base = {
        courseOfferingId: offering.id,
        courseId: offering.courseId,
        courseName: offering.course.name,
        level: offering.course.level,
      }
      if (own.length === 0) return [{ ...base, courseOrientationId: null, orientationName: null }]
      return own.map((o) => ({
        ...base,
        courseOrientationId: o.id,
        orientationName: o.orientation.name,
      }))
    })

    return res.json({ schoolYearId, data: groups })
  } catch (error) {
    console.error('[admin-gradebook] groups:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Matriz Estudiante × Asignatura de un grupo en un período (RF-060). */
r.get('/group-matrix', async (req: any, res) => {
  const parsed = matrixQuerySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }

  try {
    const scope = {
      courseOfferingId: parsed.data.courseOfferingId,
      orientationId: parsed.data.orientationId ?? null,
      courseOrientationId: parsed.data.courseOrientationId ?? null,
    }

    const offering = await prisma.courseOffering.findUnique({
      where: { id: scope.courseOfferingId },
      include: { course: true, schoolYear: true },
    })
    if (!offering) return res.status(404).json({ message: 'Grupo no encontrado' })

    const allBooks = await prisma.gradeBook.findMany({
      where: { schoolYearId: offering.schoolYearId, courseOfferingId: scope.courseOfferingId },
      include: {
        subject: { select: { id: true, name: true, sortOrder: true } },
        teacher: { select: { id: true, name: true } },
      },
    })
    // Las de la orientación MÁS las de tronco común: es la contracara del roster.
    const books = gradeBooksForGroup(allBooks as never, scope).sort(
      (a: any, b: any) => a.subject.sortOrder - b.subject.sortOrder || a.subject.name.localeCompare(b.subject.name, 'es'),
    ) as any[]

    const [students, states, scale] = await Promise.all([
      loadRosterForScope({ schoolYearId: offering.schoolYearId, ...scope }),
      prisma.gradeBookPeriod.findMany({
        where: { periodId: parsed.data.periodId, gradeBookId: { in: books.map((b) => b.id) } },
        include: { grades: true },
      }),
      // Los descriptores salen de la escala del nivel: es con la que se ponen C y R.
      periodScaleFor(offering.course?.level),
    ])

    const levels = scale?.levels ?? []
    const stateByBook = new Map(states.map((s) => [s.gradeBookId, s]))

    // La reunión mira tres cosas juntas: rendimiento, conducta e inasistencias. Las dos últimas no
    // viven en la libreta —son del estudiante, no de la materia— así que se traen acá.
    const studentIds = students.map((s) => s.studentId)
    const [conductRows, absenceByStudent] = await Promise.all([
      (prisma as any).studentConductRecord.findMany({
        where: { periodId: parsed.data.periodId, studentId: { in: studentIds } },
        select: { studentId: true, valueHundredths: true },
      }),
      loadAbsenceTotals(studentIds, offering.schoolYear.id, offering.course?.level),
    ])
    const conductByStudent = new Map<string, number | null>(
      conductRows.map((row: any) => [row.studentId, row.valueHundredths ?? null]),
    )

    const rows = students.map((student) => {
      const cells: MatrixCell[] = books.map((book) => {
        const state = stateByBook.get(book.id)
        const grade = state?.grades.find((g: any) => g.studentId === student.studentId)
        // La nota oficial es R. Mientras la reunión no la fije, la celda muestra la C como
        // propuesta, pero no cuenta para el promedio ni para las alertas.
        const value = officialPeriodValue(grade)
        return {
          gradeBookId: book.id,
          subjectId: book.subjectId,
          valueHundredths: value,
          proposedValueHundredths: grade?.valueHundredths ?? null,
          conceptualJudgement: grade?.conceptualJudgement ?? null,
          conductValueHundredths: grade?.conductValueHundredths ?? null,
          descriptor: describeCell(value, levels),
          periodStatus: (state?.status as any) ?? null,
          pending: value == null,
        }
      })
      const row = buildMatrixRow({
        student: { studentId: student.studentId, lastName: student.lastName, firstName: student.firstName },
        cells,
      })
      return {
        ...row,
        atRisk: isAtRisk(row),
        /** Conducta institucional del período: la pone adscripción, no el docente. */
        conductValueHundredths: conductByStudent.get(student.studentId) ?? null,
        /** Faltas del ciclo en todo el liceo, en centésimos (150 = una falta y media). */
        absenceHundredths: absenceByStudent.get(student.studentId)?.absenceHundredths ?? 0,
      }
    })

    return res.json({
      group: {
        courseOfferingId: offering.id,
        courseName: offering.course.name,
        schoolYear: { id: offering.schoolYear.id, label: offering.schoolYear.label },
      },
      subjects: books.map((b) => ({
        gradeBookId: b.id,
        subjectId: b.subjectId,
        name: b.subject.name,
        teacher: b.teacher?.name ?? null,
        periodStatus: stateByBook.get(b.id)?.status ?? null,
      })),
      students: rows,
      /** Rótulo obligatorio del promedio (RF-061). */
      averageLabel: 'Indicador automático / promedio orientativo',
      /**
       * Decimales del promedio. El liceo lo pide con **al menos uno**: se usa para escolaridad y
       * para elegir abanderados, donde un entero no alcanza para desempatar.
       */
      averageDecimals: 1,
    })
  } catch (error) {
    console.error('[admin-gradebook] group-matrix:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Ficha académica del estudiante (RF-031): trayectoria por año, materia y período. */
r.get('/students/:studentId', async (req: any, res) => {
  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      select: { id: true, firstName: true, lastName: true, documentId: true, email: true },
    })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const [enrollments, grades] = await Promise.all([
      prisma.studentEnrollment.findMany({
        where: { studentId: student.id },
        include: {
          schoolYear: { select: { code: true, label: true } },
          courseOffering: { include: { course: { select: { name: true } } } },
          orientation: { select: { name: true } },
          courseOrientation: { include: { orientation: { select: { name: true } } } },
        },
        orderBy: { schoolYear: { code: 'desc' } },
      }),
      prisma.periodGrade.findMany({
        where: { studentId: student.id },
        include: {
          gradeBookPeriod: {
            include: {
              period: { select: { code: true, name: true, sortOrder: true, isMeeting: true } },
              gradeBook: {
                include: {
                  subject: { select: { name: true } },
                  schoolYear: { select: { code: true, label: true } },
                  courseOffering: { include: { course: { select: { name: true } } } },
                  courseOrientation: { include: { orientation: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
    ])

    // La trayectoria es la oficial: los períodos con reunión y su R. Las notas de trabajo de un
    // tramo no son un resultado del estudiante.
    const official = grades.filter((row) => row.gradeBookPeriod.period.isMeeting)
    const history: StudentHistoryEntry[] = official.map((row) => {
      const book = row.gradeBookPeriod.gradeBook
      return {
        schoolYearCode: book.schoolYear.code,
        schoolYearLabel: book.schoolYear.label,
        courseName: book.courseOffering.course.name,
        orientationName: book.courseOrientation?.orientation.name ?? null,
        periodCode: row.gradeBookPeriod.period.code,
        periodName: row.gradeBookPeriod.period.name,
        periodSortOrder: row.gradeBookPeriod.period.sortOrder,
        subjectName: book.subject.name,
        valueHundredths: officialPeriodValue(row),
        conceptualJudgement: row.conceptualJudgement,
      }
    })

    // La evolución se arma por ciclo: mezclar años distintos en una serie no dice nada.
    const years = [...new Set(history.map((h) => h.schoolYearCode))].sort((a, b) => b - a)
    const evolutionByYear = years.map((code) => {
      const evolution = buildSubjectEvolution(history.filter((h) => h.schoolYearCode === code))
      return {
        schoolYearCode: code,
        subjects: evolution.map((subject) => ({
          ...subject,
          sustainedDecline: hasSustainedDecline(subject.points),
        })),
      }
    })

    return res.json({
      student,
      enrollments: enrollments.map((e) => ({
        schoolYearCode: e.schoolYear.code,
        schoolYearLabel: e.schoolYear.label,
        courseName: e.courseOffering.course.name,
        orientationName: e.courseOrientation?.orientation.name ?? e.orientation?.name ?? null,
        status: e.enrollmentStatus,
      })),
      history,
      evolutionByYear,
    })
  } catch (error) {
    console.error('[admin-gradebook] student file:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const meetingSchema = z.object({
  courseOfferingId: z.string().uuid(),
  courseOrientationId: z.string().uuid().nullish(),
  periodId: z.string().uuid(),
  studentId: z.string().uuid().nullish(),
  decision: z.string().trim().min(3).max(2000),
})

/** Decisiones de la reunión de profesores (RF-070). */
r.get('/meeting-records', async (req: any, res) => {
  try {
    const where: Record<string, unknown> = {}
    if (typeof req.query.courseOfferingId === 'string') where.courseOfferingId = req.query.courseOfferingId
    if (typeof req.query.periodId === 'string') where.periodId = req.query.periodId

    const records = await prisma.teacherMeetingRecord.findMany({
      where: where as never,
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    return res.json({ data: records })
  } catch (error) {
    console.error('[admin-gradebook] meeting records:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/meeting-records', async (req: any, res) => {
  const parsed = meetingSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const offering = await prisma.courseOffering.findUnique({
      where: { id: parsed.data.courseOfferingId },
      select: { schoolYearId: true },
    })
    if (!offering) return res.status(404).json({ message: 'Grupo no encontrado' })

    const d = parsed.data
    const created = await prisma.teacherMeetingRecord.create({
      data: {
        schoolYearId: offering.schoolYearId,
        courseOfferingId: d.courseOfferingId,
        courseOrientationId: d.courseOrientationId ?? null,
        periodId: d.periodId,
        studentId: d.studentId ?? null,
        decision: d.decision,
        createdByUserId: req.user?.id ?? req.user?.sub,
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        createdBy: { select: { id: true, name: true } },
      },
    })
    return res.status(201).json({ data: created })
  } catch (error) {
    console.error('[admin-gradebook] meeting record create:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Visado (RF-080 a RF-083) ───────────────────────────────────────────────

const endorsementSchema = z.object({
  gradeBookPeriodId: z.string().uuid(),
  section: z.enum(['GRADES', 'CLOSURE', 'JUDGEMENTS', 'ALL']),
  status: z.enum(['OBSERVED', 'CORRECTED', 'ENDORSED']),
  observations: z.string().trim().max(2000).nullish(),
})

/** Atribuciones de quien pide, para decidir qué transiciones puede registrar. */
async function endorsementScopes(req: any) {
  const userId = req.user?.id ?? req.user?.sub
  const [review, endorse, inspect] = await Promise.all([
    userPermissionScope(userId, 'gradebook.review', req.user?.role),
    userPermissionScope(userId, 'gradebook.endorse', req.user?.role),
    userPermissionScope(userId, 'gradebook.inspect', req.user?.role),
  ])
  return {
    userId,
    scopes: { canReview: review !== null, canEndorse: endorse !== null, canInspect: inspect !== null },
  }
}

const GRADEBOOK_PERIOD_INCLUDE = {
  endorsements: { orderBy: { occurredAt: 'asc' as const } },
  period: { select: { id: true, code: true, name: true, sortOrder: true } },
  gradeBook: {
    include: {
      subject: { select: { id: true, name: true } },
      teacher: { select: { id: true, name: true } },
      courseOffering: { include: { course: { select: { name: true } } } },
      courseOrientation: { include: { orientation: { select: { name: true } } } },
    },
  },
}

type EndorsementDetail = {
  section: Section
  status: 'PENDING' | 'OBSERVED' | 'CORRECTED' | 'ENDORSED'
  occurredAt: Date
  observations: string | null
  actorRoleCode: string
}

function serializeEndorsementRow(row: any, now: Date) {
  // `row` es `any` (viene de un include de Prisma), así que se fija el genérico a mano: si no,
  // `currentStates` infiere el tipo base y se pierden `observations` y `actorRoleCode`.
  const states = currentStates<EndorsementDetail>(row.endorsements as EndorsementDetail[])
  const sections = (['GRADES', 'CLOSURE', 'JUDGEMENTS', 'ALL'] as Section[]).map((section) => {
    const current = states.get(section)
    return {
      section,
      status: statusOf(states, section),
      occurredAt: current?.occurredAt ?? null,
      observations: current?.observations ?? null,
      actorRoleCode: current?.actorRoleCode ?? null,
    }
  })
  const lastChange = row.endorsements.at(-1)?.occurredAt ?? row.closedAt ?? row.updatedAt

  return {
    gradeBookPeriodId: row.id,
    gradeBookId: row.gradeBookId,
    periodStatus: row.status,
    closedAt: row.closedAt,
    closedLate: row.closedLate,
    period: row.period,
    subject: row.gradeBook.subject,
    teacher: row.gradeBook.teacher,
    courseName: row.gradeBook.courseOffering.course.name,
    orientationName: row.gradeBook.courseOrientation?.orientation.name ?? null,
    sections,
    overallStatus: statusOf(states, 'ALL'),
    lastChangeAt: lastChange,
    /** Antigüedad del pendiente, para priorizar en la grilla (§5.9). */
    pendingAgeDays: statusOf(states, 'ALL') === 'ENDORSED' ? null : pendingAgeDays(lastChange, now),
    blockingSections: blockingSections(states),
    canFinalize: canFinalize(states),
  }
}

/** Grilla de visado (RF-080): qué libretas y períodos esperan revisión. */
// ─── Control de adscripción ─────────────────────────────────────────────────

/**
 * Qué le falta a cada libreta del ciclo en un período.
 *
 * Lo pide adscripción, que hasta ahora no tenía forma de verlo: `closureBlockers` respondía la
 * misma pregunta pero de a una libreta y sólo por la ruta del docente. Va con `gradebook.review`
 * —controlar es justamente su atribución— y no con `academic-analytics.read`, que adscripción no
 * tiene.
 */
r.get('/completeness', requirePermission('gradebook.review', 'all'), async (req: any, res) => {
  const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : null
  if (!periodId) return res.status(400).json({ message: 'Falta el período' })

  try {
    const result = await loadPeriodCompleteness(periodId)
    if (!result) return res.status(404).json({ message: 'Período no encontrado' })
    return res.json({
      period: { id: result.period.id, name: result.period.name, level: result.period.level },
      data: result.rows,
    })
  } catch (error) {
    console.error('[admin-gradebook] completeness:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Avisa al docente, por notificación interna, qué le falta en una libreta para la reunión.
 * El texto lo arma el backend con el mismo cálculo que ve administración: así el aviso no puede
 * decir algo distinto de la pantalla.
 */
r.post('/completeness/:gradeBookId/request', requirePermission('gradebook.review', 'all'), async (req: any, res) => {
  const periodId = typeof req.body?.periodId === 'string' ? req.body.periodId : null
  if (!periodId) return res.status(400).json({ message: 'Falta el período' })

  try {
    const book = await prisma.gradeBook.findUnique({
      where: { id: req.params.gradeBookId },
      include: { subject: { select: { name: true } } },
    })
    if (!book) return res.status(404).json({ message: 'Libreta no encontrada' })
    if (!book.teacherUserId) {
      return res.status(409).json({ message: 'La libreta no tiene docente titular', code: 'NO_TEACHER' })
    }

    const result = await loadPeriodCompleteness(periodId, { gradeBookId: book.id })
    if (!result) return res.status(404).json({ message: 'Período no encontrado' })
    const row = result.rows[0]
    if (!row) {
      return res.status(409).json({ message: 'La libreta no corresponde a esa reunión', code: 'LEVEL_MISMATCH' })
    }
    if (row.complete) {
      return res.status(409).json({ message: 'La libreta ya está completa', code: 'ALREADY_COMPLETE' })
    }

    const actorUserId = req.user?.id ?? req.user?.sub ?? null
    const detail = completionRequestBody(row, result.period.name)
    const sent = await notifyGradeBook(
      await resolveGradeBookRecipients(book.id, actorUserId),
      completionRequestNotification({
        subjectName: book.subject?.name ?? 'la libreta',
        detail,
        gradeBookId: book.id,
        periodId,
      }),
    )
    await recordAuditEventNow({
      action: AuditAction.GRADEBOOK_COMPLETION_REQUESTED,
      actorUserId,
      req,
      entityType: 'GradeBook',
      entityId: book.id,
      metadata: { periodId, detail, notified: sent },
    })
    return res.json({ ok: true, notified: sent, detail })
  } catch (error) {
    console.error('[admin-gradebook] completeness request:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Boletín ────────────────────────────────────────────────────────────────

/**
 * Boletín del estudiante para un período: todas sus asignaturas en un solo documento.
 *
 * Es la única salida transversal del sistema — el resto de las exportaciones son por libreta, o
 * sea de una materia sola. Reúne lo que el liceo pidió que llegue a la familia: nota y juicio de
 * cada asignatura, conducta, promedio e inasistencias, con el encabezado del estudiante.
 */
r.get('/report-card/:studentId', requirePermission('exports.create'), async (req: any, res) => {
  const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : null
  if (!periodId) return res.status(400).json({ message: 'Falta el período' })

  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      select: { id: true, firstName: true, lastName: true, documentId: true, birthDate: true },
    })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const enrollment = await prisma.studentEnrollment.findFirst({
      where: { studentId: student.id, enrollmentStatus: 'ACTIVE' },
      include: {
        schoolYear: { select: { id: true, label: true } },
        courseOffering: { include: { course: { select: { name: true, level: true } } } },
        courseOrientation: { include: { orientation: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (!enrollment?.courseOffering) {
      return res.status(409).json({ message: 'El estudiante no tiene matrícula activa', code: 'NO_ENROLLMENT' })
    }

    const books = await prisma.gradeBook.findMany({
      where: { courseOfferingId: enrollment.courseOfferingId },
      include: { subject: { select: { name: true, sortOrder: true } }, teacher: { select: { name: true } } },
    })
    const relevant = gradeBooksForGroup(books as any, {
      courseOfferingId: enrollment.courseOfferingId,
      courseOrientationId: enrollment.courseOrientationId,
      orientationId: enrollment.orientationId,
    })
    relevant.sort((a: any, b: any) => (a.subject?.sortOrder ?? 0) - (b.subject?.sortOrder ?? 0))

    const [states, scale, conduct, attendance] = await Promise.all([
      prisma.gradeBookPeriod.findMany({
        where: { periodId, gradeBookId: { in: relevant.map((b: any) => b.id) } },
        include: { grades: { where: { studentId: student.id } } },
      }),
      periodScaleFor(enrollment.courseOffering.course?.level),
      (prisma as any).studentConductRecord.findUnique({
        where: { studentId_periodId: { studentId: student.id, periodId } },
        select: { valueHundredths: true },
      }),
      loadAbsenceTotals([student.id], enrollment.schoolYearId, enrollment.courseOffering.course?.level),
    ])

    const levels = scale?.levels ?? []
    const stateByBook = new Map(states.map((st) => [st.gradeBookId, st]))
    const period = await prisma.academicPeriod.findUnique({ where: { id: periodId }, select: { name: true } })

    const card = buildReportCard({
      student: {
        firstName: student.firstName,
        lastName: student.lastName,
        documentId: student.documentId,
        birthDate: student.birthDate,
      },
      group: {
        courseName: enrollment.courseOffering.course.name,
        orientationName: enrollment.courseOrientation?.orientation.name ?? null,
        schoolYearLabel: enrollment.schoolYear?.label ?? '',
      },
      period: { name: period?.name ?? '' },
      subjects: relevant.map((book: any) => {
        const grade = stateByBook.get(book.id)?.grades?.[0]
        // Al boletín va siempre R: sin reunión, la materia figura pendiente.
        const value = officialPeriodValue(grade)
        return {
          subjectName: book.subject?.name ?? '—',
          teacherName: book.teacher?.name ?? null,
          valueHundredths: value,
          descriptor: describeCell(value, levels)?.label ?? null,
          conceptualJudgement: grade?.conceptualJudgement ?? null,
          conductValueHundredths: grade?.conductValueHundredths ?? null,
        }
      }),
      conductValueHundredths: conduct?.valueHundredths ?? null,
      attendance: {
        absenceHundredths: attendance.get(student.id)?.absenceHundredths ?? 0,
        justifiedCount: attendance.get(student.id)?.justified ?? 0,
      },
    })

    const pdf = await generateReportCardPdf(card, scale?.decimals ?? 1)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      attachmentDisposition(`boletin-${student.lastName}-${student.firstName}.pdf`),
    )
    return res.send(pdf)
  } catch (error) {
    console.error('[admin-gradebook] report-card:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Conducta institucional ─────────────────────────────────────────────────

/**
 * La conducta que lleva adscripción a la reunión: una sola nota por estudiante y período, sobre
 * todo el liceo. Es distinta de la que cada docente pone en su asignatura (`PeriodGrade`): el
 * liceo usa las dos, y en la reunión se ven juntas.
 */
const conductSchema = z.object({
  schoolYearId: z.string().uuid(),
  periodId: z.string().uuid(),
  entries: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        valueHundredths: z.number().int().nullish(),
        notes: z.string().trim().max(2000).nullish(),
      }),
    )
    .min(1)
    .max(200),
})

r.get('/conduct', async (req: any, res) => {
  const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : null
  if (!periodId) return res.status(400).json({ message: 'Falta el período' })
  try {
    const rows = await (prisma as any).studentConductRecord.findMany({
      where: { periodId },
      include: { student: { select: { id: true, firstName: true, lastName: true } } },
    })
    return res.json({ data: rows })
  } catch (error) {
    console.error('[admin-gradebook] conduct GET:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/conduct', requirePermission('gradebook.review', 'all'), async (req: any, res) => {
  const parsed = conductSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })
  }
  try {
    const d = parsed.data
    const userId = req.user?.id ?? req.user?.sub ?? null
    await prisma.$transaction(
      d.entries.map((entry) =>
        (prisma as any).studentConductRecord.upsert({
          where: { studentId_periodId: { studentId: entry.studentId, periodId: d.periodId } },
          update: {
            valueHundredths: entry.valueHundredths ?? null,
            notes: entry.notes ?? null,
            updatedByUserId: userId,
          },
          create: {
            studentId: entry.studentId,
            schoolYearId: d.schoolYearId,
            periodId: d.periodId,
            valueHundredths: entry.valueHundredths ?? null,
            notes: entry.notes ?? null,
            updatedByUserId: userId,
          },
        }),
      ),
    )
    return res.json({ ok: true, saved: d.entries.length })
  } catch (error) {
    console.error('[admin-gradebook] conduct PUT:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/endorsements', async (req: any, res) => {
  try {
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const rows = await prisma.gradeBookPeriod.findMany({
      where: {
        gradeBook: { schoolYearId },
        // Sólo lo cerrado llega a la grilla: un período abierto no tiene nada firme que visar. Y
        // sólo lo que tiene reunión: los tramos se cierran junto con su entrega y no se visan.
        status: 'CLOSED',
        period: { isMeeting: true },
        ...(typeof req.query.periodId === 'string' ? { periodId: req.query.periodId } : {}),
        ...(typeof req.query.courseOfferingId === 'string'
          ? { gradeBook: { schoolYearId, courseOfferingId: req.query.courseOfferingId } }
          : {}),
      },
      include: GRADEBOOK_PERIOD_INCLUDE,
      orderBy: [{ closedAt: 'asc' }],
      take: 500,
    })

    const now = new Date()
    const data = rows.map((row) => serializeEndorsementRow(row, now))
    const pendingOnly = req.query.pending === 'true'

    return res.json({
      schoolYearId,
      data: pendingOnly ? data.filter((row) => row.overallStatus !== 'ENDORSED') : data,
    })
  } catch (error) {
    console.error('[admin-gradebook] endorsements:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Historial completo de un período: todas las filas, no sólo el estado vigente (RF-083). */
r.get('/endorsements/:gradeBookPeriodId', async (req: any, res) => {
  try {
    const row = await prisma.gradeBookPeriod.findUnique({
      where: { id: req.params.gradeBookPeriodId },
      include: {
        ...GRADEBOOK_PERIOD_INCLUDE,
        endorsements: {
          orderBy: { occurredAt: 'asc' as const },
          include: { actor: { select: { id: true, name: true } } },
        },
      },
    })
    if (!row) return res.status(404).json({ message: 'Período de libreta no encontrado' })

    return res.json({
      ...serializeEndorsementRow(row, new Date()),
      history: row.endorsements,
    })
  } catch (error) {
    console.error('[admin-gradebook] endorsement detail:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/endorsements', async (req: any, res) => {
  const parsed = endorsementSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const d = parsed.data
    const row = await prisma.gradeBookPeriod.findUnique({
      where: { id: d.gradeBookPeriodId },
      include: {
        endorsements: { orderBy: { occurredAt: 'asc' } },
        period: { select: { code: true, name: true } },
        gradeBook: { select: { id: true, status: true, subject: { select: { name: true } } } },
      },
    })
    if (!row) return res.status(404).json({ message: 'Período de libreta no encontrado' })

    // RF-110/111: un ciclo pasado a histórico es de sólo lectura, también para el visado. Si hay
    // que visar algo de un año cerrado, hay que reabrir el ciclo — y eso queda auditado.
    if (row.gradeBook.status === 'ARCHIVED') {
      return res.status(409).json({
        message: 'El ciclo lectivo está cerrado: la libreta es de sólo lectura.',
        code: 'SCHOOL_YEAR_CLOSED',
      })
    }

    assertPeriodClosed(row.status as never)

    const { userId, scopes } = await endorsementScopes(req)
    const states = currentStates(row.endorsements)
    assertCanTransition({
      currentStatus: statusOf(states, d.section),
      nextStatus: d.status,
      scopes,
    })

    // RF-082: el visado del período exige que ninguna sección obligatoria quede observada.
    if (d.section === 'ALL' && d.status === 'ENDORSED' && !canFinalize(states)) {
      return res.status(409).json({
        message: 'Hay secciones observadas sin corregir: no se puede visar el período.',
        code: 'SECTIONS_OBSERVED',
        detail: { blockingSections: blockingSections(states), mandatory: MANDATORY_SECTIONS },
      })
    }

    if (d.status === 'OBSERVED' && !(d.observations ?? '').trim()) {
      return res.status(400).json({
        message: 'Una observación necesita decir qué corregir.',
        code: 'OBSERVATION_REQUIRED',
      })
    }

    const created = await prisma.endorsement.create({
      data: {
        gradeBookPeriodId: row.id,
        section: d.section,
        status: d.status,
        actorUserId: userId,
        // Se congela el rol: si mañana cambia, el evento sigue diciendo con qué atribución se visó.
        actorRoleCode: String(req.user?.role ?? ''),
        observations: d.observations ?? null,
      },
    })

    // Observar y visar son actos reglamentarios: la trazabilidad se espera, no se dispara y olvida.
    await recordAuditEventNow({
      action: d.status === 'ENDORSED' ? AuditAction.GRADEBOOK_ENDORSED : AuditAction.GRADEBOOK_OBSERVED,
      actorUserId: userId ?? null,
      req,
      entityType: 'GradeBookPeriod',
      entityId: row.id,
      metadata: { section: d.section, status: d.status, periodCode: row.period.code } as never,
    })

    // RF-091: el docente se entera de que le observaron o visaron la libreta sin tener que
    // entrar a mirar. El aviso nunca puede hacer fallar el acto de visado, que ya quedó firme.
    const subjectName = row.gradeBook.subject.name
    const recipients = await resolveGradeBookRecipients(row.gradeBook.id, userId)
    if (d.status === 'ENDORSED') {
      await notifyGradeBook(recipients, endorsedNotification({
        subjectName,
        periodName: row.period.name,
        gradeBookId: row.gradeBook.id,
      }))
    } else if (d.status === 'OBSERVED') {
      await notifyGradeBook(recipients, observationNotification({
        subjectName,
        periodName: row.period.name,
        sectionLabel: SECTION_LABELS[d.section],
        observations: d.observations ?? '',
        gradeBookId: row.gradeBook.id,
      }))
    }

    return res.status(201).json({ data: created })
  } catch (error) {
    if (error instanceof EndorsementError) {
      return res.status(error.httpStatus).json({ message: error.message, code: error.code, detail: error.details })
    }
    console.error('[admin-gradebook] endorsement create:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
