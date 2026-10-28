import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { attachmentDisposition } from '../services/exports/content-disposition.js'
import { requirePermission } from '../middlewares/auth.js'
import { loadAbsenceTotals } from '../services/student-attendance/absence-totals.js'
import { loadReportCards } from '../services/gradebook/report-card-loader.js'
import { loadStudentFileExtras } from '../services/gradebook/student-file.js'
import { completionRequestBody, isStageComplete, stageDetail } from '../services/gradebook/completeness.js'
import { conductOptions, conductScale, isConductValue, periodScaleFor } from '../services/gradebook/period-scale.js'
import { loadPeriodCompleteness, type CompletenessGroup } from '../services/gradebook/completeness-loader.js'
import { completionDigestNotification, completionRequestNotification } from '../services/gradebook/notifications.js'
import { generateReportCardPdf, generateReportCardsPdf } from '../services/gradebook/exports/reportCardPdf.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { loadRosterForScope } from '../services/student-attendance/roster.js'
import { AuditAction, type Prisma } from '@prisma/client'
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
  statusOf,
  type ActorScopes,
  type Section,
} from '../services/gradebook/endorsement.js'
import { ENDORSEMENT_ROW_INCLUDE, serializeEndorsementRow } from '../services/gradebook/endorsement-view.js'
import { alertRulesForYear, alertSubjectsThreshold } from '../services/gradebook/alert-rules.js'
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
    // `reportCard`: la pantalla de control y visado ofrece la carga y el cierre sólo en estas.
    const rows = periods.map((period) => ({ ...period, reportCard: isReportCardPeriod(period) }))
    return res.json({ data: onlyReportCards ? rows.filter((period) => period.reportCard) : rows })
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

    const [students, states, scale, rules] = await Promise.all([
      loadRosterForScope({ schoolYearId: offering.schoolYearId, ...scope }),
      prisma.gradeBookPeriod.findMany({
        where: { periodId: parsed.data.periodId, gradeBookId: { in: books.map((b) => b.id) } },
        include: { grades: true },
      }),
      // Los descriptores salen de la escala del nivel: es con la que se ponen C y R.
      periodScaleFor(offering.course?.level),
      // El mismo umbral que los indicadores: "en alerta" tiene que significar lo mismo en los dos.
      alertRulesForYear(offering.schoolYearId),
    ])
    const riskThreshold = alertSubjectsThreshold(rules)

    const levels = scale?.levels ?? []
    const stateByBook = new Map(states.map((s) => [s.gradeBookId, s]))

    // La reunión mira tres cosas juntas: rendimiento, conducta e inasistencias. Las dos últimas no
    // viven en la libreta —son del estudiante, no de la materia— así que se traen acá.
    const studentIds = students.map((s) => s.studentId)
    const [conductRows, absenceByStudent, conduct] = await Promise.all([
      (prisma as any).studentConductRecord.findMany({
        where: { periodId: parsed.data.periodId, studentId: { in: studentIds } },
        select: { studentId: true, valueHundredths: true },
      }),
      loadAbsenceTotals(studentIds, offering.schoolYear.id, offering.course?.level),
      conductScale(),
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
        atRisk: isAtRisk(row, { alertSubjectsThreshold: riskThreshold }),
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
      /** Asignaturas en alerta que marcan al estudiante; `null` si la regla está apagada. */
      alertSubjectsThreshold: Number.isFinite(riskThreshold) ? riskThreshold : null,
      /** Tramos de la escala de conducta: rotulan la columna y son las opciones al cargarla. */
      conductLevels: conductOptions(conduct?.levels ?? []),
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
          schoolYear: { select: { id: true, code: true, label: true } },
          courseOffering: { include: { course: { select: { name: true, level: true } } } },
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

    // Faltas, conducta y reuniones con boletín de cada año: la reunión mira las tres cosas juntas.
    const extras = await loadStudentFileExtras(
      student.id,
      enrollments.map((e) => ({ schoolYearId: e.schoolYearId, level: e.courseOffering.course.level ?? null })),
    )

    return res.json({
      student,
      enrollments: enrollments.map((e) => ({
        schoolYearId: e.schoolYearId,
        schoolYearCode: e.schoolYear.code,
        schoolYearLabel: e.schoolYear.label,
        courseName: e.courseOffering.course.name,
        orientationName: e.courseOrientation?.orientation.name ?? e.orientation?.name ?? null,
        status: e.enrollmentStatus,
        ...extras.byYear.get(e.schoolYearId),
      })),
      history,
      evolutionByYear,
      decisions: extras.decisions,
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

/**
 * Decisiones de la reunión de profesores (RF-070).
 *
 * El grupo es oferta **más orientación**: sin filtrar la orientación, las decisiones de
 * "5.º Científico" aparecían en la reunión de "5.º Humanístico" del mismo curso.
 */
r.get('/meeting-records', async (req: any, res) => {
  try {
    const where: Record<string, unknown> = {}
    if (typeof req.query.courseOfferingId === 'string') {
      where.courseOfferingId = req.query.courseOfferingId
      where.courseOrientationId = typeof req.query.courseOrientationId === 'string' ? req.query.courseOrientationId : null
    }
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

// Registrar decisiones es de quien conduce la reunión (adscripción, dirección); leerlas, de todos.
r.post('/meeting-records', requirePermission('gradebook.review', 'all'), async (req: any, res) => {
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
  section: z.enum(['GRADES', 'CLOSURE', 'JUDGEMENTS', 'PLANNING', 'GROUP_REPORT', 'ALL']),
  status: z.enum(['OBSERVED', 'CORRECTED', 'ENDORSED']),
  observations: z.string().trim().max(2000).nullish(),
})

type Actor = { userId: string; scopes: ActorScopes }

/** Atribuciones de quien pide, para decidir qué transiciones puede registrar. */
async function endorsementScopes(req: any): Promise<Actor> {
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
    const result = await loadPeriodCompleteness(periodId, { group: groupFilter(req.query) })
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

const completionRequestSchema = z.object({
  periodId: z.string().uuid(),
  /** Antes de la reunión: evaluaciones, C y juicio. Después: R y cierre del período. */
  stage: z.enum(['before', 'after']).default('before'),
  /** "Avisar a todos" con un grupo elegido avisa sólo por las libretas de ese grupo. */
  courseOfferingId: z.string().uuid().optional(),
  courseOrientationId: z.string().uuid().nullish(),
})

/** El grupo del filtro, como lo mandan la consulta o el cuerpo; `null` si no se eligió. */
function groupFilter(source: Record<string, unknown> | undefined): CompletenessGroup | null {
  const offering = source?.courseOfferingId
  if (typeof offering !== 'string' || !offering) return null
  const orientation = source?.courseOrientationId
  return {
    courseOfferingId: offering,
    courseOrientationId: typeof orientation === 'string' && orientation ? orientation : null,
  }
}

function groupLabel(row: { courseName: string; orientationName?: string | null; subjectName: string }) {
  return `${row.courseName}${row.orientationName ? ` ${row.orientationName}` : ''} · ${row.subjectName}`
}

/**
 * Avisa al docente, por notificación interna, qué le falta en una libreta para la reunión —o,
 * después de ella, qué le falta para cerrar—. El texto lo arma el backend con el mismo cálculo
 * que ve administración: así el aviso no puede decir algo distinto de la pantalla.
 */
r.post('/completeness/:gradeBookId/request', requirePermission('gradebook.review', 'all'), async (req: any, res) => {
  const parsed = completionRequestSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ message: 'Falta el período' })
  const { periodId, stage } = parsed.data

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
    if (isStageComplete(row, stage)) {
      const message = stage === 'after' ? 'La libreta ya cerró el período' : 'La libreta ya está completa'
      return res.status(409).json({ message, code: 'ALREADY_COMPLETE' })
    }

    const actorUserId = req.user?.id ?? req.user?.sub ?? null
    const detail = completionRequestBody(row, result.period.name, stage)
    const sent = await notifyGradeBook(
      await resolveGradeBookRecipients(book.id, actorUserId),
      completionRequestNotification({
        subjectName: book.subject?.name ?? 'la libreta',
        detail,
        gradeBookId: book.id,
        periodId,
        stage,
      }),
    )
    await recordAuditEventNow({
      action: AuditAction.GRADEBOOK_COMPLETION_REQUESTED,
      actorUserId,
      req,
      entityType: 'GradeBook',
      entityId: book.id,
      metadata: { periodId, stage, detail, notified: sent },
    })
    return res.json({ ok: true, notified: sent, detail })
  } catch (error) {
    console.error('[admin-gradebook] completeness request:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * "Avisar a todos": un aviso por docente con todas sus libretas pendientes de la reunión, en vez
 * de una notificación por materia. Cada libreta avisada queda en la auditoría como si se hubiera
 * avisado de a una, así la pantalla muestra "Avisado el…" igual.
 */
r.post('/completeness/request-all', requirePermission('gradebook.review', 'all'), async (req: any, res) => {
  const parsed = completionRequestSchema.safeParse(req.body ?? {})
  if (!parsed.success) return res.status(400).json({ message: 'Falta el período' })
  const { periodId, stage } = parsed.data

  try {
    const result = await loadPeriodCompleteness(periodId, { group: groupFilter(parsed.data) })
    if (!result) return res.status(404).json({ message: 'Período no encontrado' })

    const actorUserId = req.user?.id ?? req.user?.sub ?? null
    const pending = result.rows.filter((row) => !isStageComplete(row, stage))
    const byTeacher = new Map<string, typeof pending>()
    for (const row of pending) {
      // Sin titular no hay a quién; y nadie necesita que le avisen lo que le falta a sí mismo.
      if (!row.teacherUserId || row.teacherUserId === actorUserId) continue
      byTeacher.set(row.teacherUserId, [...(byTeacher.get(row.teacherUserId) ?? []), row])
    }

    let gradeBooks = 0
    for (const [teacherUserId, rows] of byTeacher) {
      const sent = await notifyGradeBook(
        [{ userId: teacherUserId }],
        completionDigestNotification({
          periodName: result.period.name,
          stage,
          items: rows.map((row) => ({ label: groupLabel(row), detail: stageDetail(row, stage) })),
        }),
      )
      for (const row of rows) {
        await recordAuditEventNow({
          action: AuditAction.GRADEBOOK_COMPLETION_REQUESTED,
          actorUserId,
          req,
          entityType: 'GradeBook',
          entityId: row.gradeBookId,
          metadata: { periodId, stage, detail: completionRequestBody(row, result.period.name, stage), notified: sent, bulk: true },
        })
      }
      gradeBooks += rows.length
    }

    return res.json({
      teachers: byTeacher.size,
      gradeBooks,
      withoutTeacher: pending.filter((row) => !row.teacherUserId).length,
    })
  } catch (error) {
    console.error('[admin-gradebook] completeness request-all:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// ─── Boletín ────────────────────────────────────────────────────────────────

/**
 * Matrícula del estudiante en el ciclo del período. Primero la activa; si ya no lo está (se fue,
 * egresó), la más reciente de ese año: el boletín de un período pasado sigue siendo suyo.
 */
async function enrollmentForYear(studentId: string, schoolYearId: string) {
  const rows = await prisma.studentEnrollment.findMany({
    where: { studentId, schoolYearId },
    select: {
      enrollmentStatus: true,
      courseOfferingId: true,
      courseOrientationId: true,
      orientationId: true,
      courseOffering: { select: { course: { select: { level: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  })
  return rows.find((row) => row.enrollmentStatus === 'ACTIVE') ?? rows[0] ?? null
}

async function reportCardPeriod(periodId: string) {
  return prisma.academicPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, name: true, schoolYearId: true, level: true },
  })
}

function sendPdf(res: any, pdf: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', attachmentDisposition(filename))
  return res.send(pdf)
}

/**
 * Boletín del estudiante para un período: todas sus asignaturas en un solo documento.
 *
 * Es la única salida transversal del sistema — el resto de las exportaciones son por libreta, o
 * sea de una materia sola. Reúne lo que el liceo pidió que llegue a la familia: nota y juicio de
 * cada asignatura, conducta, promedio e inasistencias, con el encabezado del estudiante. El grupo
 * sale de la matrícula del ciclo del período, no de la de hoy.
 */
r.get('/report-card/:studentId', requirePermission('gradebook.export'), async (req: any, res) => {
  const periodId = typeof req.query.periodId === 'string' ? req.query.periodId : null
  if (!periodId) return res.status(400).json({ message: 'Falta el período' })

  try {
    const student = await prisma.student.findUnique({
      where: { id: req.params.studentId },
      select: { id: true, firstName: true, lastName: true, documentId: true, birthDate: true },
    })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const period = await reportCardPeriod(periodId)
    if (!period) return res.status(404).json({ message: 'Período no encontrado' })

    const enrollment = await enrollmentForYear(student.id, period.schoolYearId)
    if (!enrollment) {
      return res.status(409).json({ message: 'El estudiante no estaba matriculado en ese ciclo', code: 'NO_ENROLLMENT' })
    }
    if (enrollment.courseOffering?.course?.level && enrollment.courseOffering.course.level !== period.level) {
      return res.status(409).json({ message: 'El período no es del nivel del estudiante', code: 'LEVEL_MISMATCH' })
    }

    const { cards, decimals } = await loadReportCards({
      group: {
        schoolYearId: period.schoolYearId,
        courseOfferingId: enrollment.courseOfferingId,
        courseOrientationId: enrollment.courseOrientationId,
        orientationId: enrollment.orientationId,
      },
      period,
      students: [student],
    })
    const pdf = await generateReportCardPdf(cards[0], decimals)
    return sendPdf(res, pdf, `boletin-${student.lastName}-${student.firstName}.pdf`)
  } catch (error) {
    console.error('[admin-gradebook] report-card:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const groupReportCardsSchema = z.object({
  courseOfferingId: z.string().uuid(),
  courseOrientationId: z.string().uuid().optional(),
  periodId: z.string().uuid(),
})

/**
 * Boletines de todo un grupo en un solo PDF, cada uno en su hoja: es lo que se imprime para la
 * entrega a las familias. Los estudiantes son los matriculados hoy en el grupo.
 */
r.get('/report-cards', requirePermission('gradebook.export'), async (req: any, res) => {
  const parsed = groupReportCardsSchema.safeParse(req.query)
  if (!parsed.success) return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })

  try {
    const { courseOfferingId, courseOrientationId, periodId } = parsed.data
    const [period, offering] = await Promise.all([
      reportCardPeriod(periodId),
      prisma.courseOffering.findUnique({
        where: { id: courseOfferingId },
        select: { schoolYearId: true, course: { select: { name: true, level: true } } },
      }),
    ])
    if (!period || !offering) return res.status(404).json({ message: 'Grupo o período no encontrado' })
    if (offering.schoolYearId !== period.schoolYearId || offering.course?.level !== period.level) {
      return res.status(409).json({ message: 'El período no corresponde a ese grupo', code: 'PERIOD_MISMATCH' })
    }

    const group = { schoolYearId: period.schoolYearId, courseOfferingId, courseOrientationId: courseOrientationId ?? null, orientationId: null }
    const roster = await loadRosterForScope(group)
    if (roster.length === 0) return res.status(404).json({ message: 'El grupo no tiene estudiantes matriculados', code: 'EMPTY_GROUP' })

    const birthDates = await prisma.student.findMany({
      where: { id: { in: roster.map((s) => s.studentId) } },
      select: { id: true, birthDate: true },
    })
    const birthById = new Map(birthDates.map((row) => [row.id, row.birthDate]))
    const students = roster.map((s) => ({
      id: s.studentId,
      firstName: s.firstName,
      lastName: s.lastName,
      documentId: s.documentId,
      birthDate: birthById.get(s.studentId) ?? null,
    }))

    const { cards, decimals } = await loadReportCards({ group, period, students })
    const pdf = await generateReportCardsPdf(cards, decimals)
    return sendPdf(res, pdf, `boletines-${offering.course?.name ?? 'grupo'}-${period.name}.pdf`)
  } catch (error) {
    console.error('[admin-gradebook] report-cards:', error)
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
    const [period, conduct] = await Promise.all([
      prisma.academicPeriod.findFirst({ where: { id: d.periodId, schoolYearId: d.schoolYearId }, select: { id: true } }),
      conductScale(),
    ])
    if (!period) return res.status(404).json({ message: 'El período no es de ese ciclo', code: 'PERIOD_NOT_FOUND' })
    // Conducta numérica del 1 al 10, aunque aún no se haya actualizado el catálogo.
    const levels = conduct?.levels ?? []
    if (d.entries.some((entry) => !isConductValue(entry.valueHundredths, levels))) {
      return res.status(400).json({ message: 'La conducta tiene que ser una nota entera del 1 al 10.', code: 'CONDUCT_OUT_OF_SCALE' })
    }

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

const queryString = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

/**
 * Grilla de visado (RF-080): qué libretas y períodos esperan revisión.
 *
 * Sin tope de filas: un `take` antes de filtrar las pendientes dejaba afuera justo las más nuevas
 * en cuanto el ciclo juntaba más períodos cerrados que el tope. Con un grupo elegido se ven sus
 * libretas más las de tronco común, igual que en la matriz de reunión.
 */
r.get('/endorsements', async (req: any, res) => {
  try {
    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: queryString(req.query.schoolYearId),
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const periodId = queryString(req.query.periodId)
    const courseOfferingId = queryString(req.query.courseOfferingId)
    const courseOrientationId = queryString(req.query.courseOrientationId)

    const rows = await prisma.gradeBookPeriod.findMany({
      where: {
        gradeBook: { schoolYearId, ...(courseOfferingId ? { courseOfferingId } : {}) },
        // Sólo lo cerrado llega a la grilla: un período abierto no tiene nada firme que visar. Y
        // sólo lo que tiene reunión: los tramos se cierran junto con su entrega y no se visan.
        status: 'CLOSED',
        period: { isMeeting: true },
        ...(periodId ? { periodId } : {}),
      },
      include: ENDORSEMENT_ROW_INCLUDE,
      orderBy: [{ closedAt: 'asc' }],
    })

    const inGroup =
      courseOfferingId && courseOrientationId
        ? new Set(
            gradeBooksForGroup(rows.map((row) => row.gradeBook) as never[], {
              courseOfferingId,
              courseOrientationId,
              orientationId: null,
            }).map((book: any) => book.id),
          )
        : null

    const now = new Date()
    const pendingOnly = req.query.pending === 'true'
    const data = rows
      .filter((row) => !inGroup || inGroup.has(row.gradeBookId))
      .map((row) => serializeEndorsementRow(row, now))
      .filter((row) => !pendingOnly || row.overallStatus !== 'ENDORSED')

    return res.json({ schoolYearId, data })
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
        ...ENDORSEMENT_ROW_INCLUDE,
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

/**
 * Quién abrió la libreta y cuándo (RF-100). Se escribía en cada apertura y no había dónde
 * leerlo. Las últimas 100, de la más nueva a la más vieja; queda en supervisión por el montaje
 * (`gradebook.read` de alcance total).
 */
r.get('/gradebooks/:gradeBookId/access-log', async (req: any, res) => {
  try {
    const rows = await prisma.gradeBookAccessLog.findMany({
      where: { gradeBookId: req.params.gradeBookId },
      include: { user: { select: { name: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    })
    return res.json({
      data: rows.map((row) => ({
        id: row.id,
        userName: row.user?.name ?? null,
        roleCode: row.roleCode,
        ip: row.ip,
        occurredAt: row.occurredAt.toISOString(),
      })),
    })
  } catch (error) {
    console.error('[admin-gradebook] access log:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const ENDORSEMENT_TARGET_INCLUDE = {
  endorsements: { orderBy: { occurredAt: 'asc' as const } },
  period: { select: { code: true, name: true } },
  gradeBook: { select: { id: true, status: true, subject: { select: { name: true } } } },
}

type EndorsementTarget = Prisma.GradeBookPeriodGetPayload<{ include: typeof ENDORSEMENT_TARGET_INCLUDE }>

/** El docente se entera de que le observaron o visaron la libreta sin tener que entrar a mirar (RF-091). */
async function notifyEndorsement(
  row: EndorsementTarget,
  actorUserId: string,
  section: Section,
  status: string,
  observations: string,
) {
  const subjectName = row.gradeBook.subject.name
  const recipients = await resolveGradeBookRecipients(row.gradeBook.id, actorUserId)
  if (status === 'ENDORSED') {
    await notifyGradeBook(
      recipients,
      endorsedNotification({ subjectName, periodName: row.period.name, gradeBookId: row.gradeBook.id }),
    )
  } else if (status === 'OBSERVED') {
    await notifyGradeBook(
      recipients,
      observationNotification({
        subjectName,
        periodName: row.period.name,
        sectionLabel: SECTION_LABELS[section],
        observations,
        gradeBookId: row.gradeBook.id,
      }),
    )
  }
}

/**
 * Valida y registra un acto de visado. Lanza `EndorsementError` si no corresponde.
 *
 * Es el mismo camino de a uno y en lote: visar en lote no puede saltearse ninguna regla.
 */
async function registerEndorsement(params: {
  req: any
  row: EndorsementTarget
  actor: Actor
  section: Section
  status: 'OBSERVED' | 'CORRECTED' | 'ENDORSED'
  observations?: string | null
}) {
  const { req, row, actor, section, status } = params

  // RF-110/111: un ciclo pasado a histórico es de sólo lectura, también para el visado. Si hay
  // que visar algo de un año cerrado, hay que reabrir el ciclo — y eso queda auditado.
  if (row.gradeBook.status === 'ARCHIVED') {
    throw new EndorsementError(409, 'SCHOOL_YEAR_CLOSED', 'El ciclo lectivo está cerrado: la libreta es de sólo lectura.')
  }

  assertPeriodClosed(row.status as never)

  const states = currentStates(row.endorsements)
  assertCanTransition({ currentStatus: statusOf(states, section), nextStatus: status, scopes: actor.scopes })

  // RF-082: el visado del período exige que ninguna sección obligatoria quede observada.
  if (section === 'ALL' && status === 'ENDORSED' && !canFinalize(states)) {
    throw new EndorsementError(
      409,
      'SECTIONS_OBSERVED',
      'Hay secciones observadas sin corregir: no se puede visar el período.',
      { blockingSections: blockingSections(states), mandatory: MANDATORY_SECTIONS },
    )
  }

  const observations = (params.observations ?? '').trim()
  if (status === 'OBSERVED' && !observations) {
    throw new EndorsementError(400, 'OBSERVATION_REQUIRED', 'Una observación necesita decir qué corregir.')
  }

  const created = await prisma.endorsement.create({
    data: {
      gradeBookPeriodId: row.id,
      section,
      status,
      actorUserId: actor.userId,
      // Se congela el rol: si mañana cambia, el evento sigue diciendo con qué atribución se visó.
      actorRoleCode: String(req.user?.role ?? ''),
      observations: observations || null,
    },
  })

  // Observar y visar son actos reglamentarios: la trazabilidad se espera, no se dispara y olvida.
  await recordAuditEventNow({
    action: status === 'ENDORSED' ? AuditAction.GRADEBOOK_ENDORSED : AuditAction.GRADEBOOK_OBSERVED,
    actorUserId: actor.userId ?? null,
    req,
    entityType: 'GradeBookPeriod',
    entityId: row.id,
    metadata: { section, status, periodCode: row.period.code } as never,
  })

  // El aviso nunca puede hacer fallar el acto de visado, que ya quedó firme.
  await notifyEndorsement(row, actor.userId, section, status, observations)
  return created
}

function endorsementErrorResponse(res: any, error: EndorsementError) {
  return res.status(error.httpStatus).json({ message: error.message, code: error.code, detail: error.details })
}

r.post('/endorsements', async (req: any, res) => {
  const parsed = endorsementSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const d = parsed.data
    const row = await prisma.gradeBookPeriod.findUnique({
      where: { id: d.gradeBookPeriodId },
      include: ENDORSEMENT_TARGET_INCLUDE,
    })
    if (!row) return res.status(404).json({ message: 'Período de libreta no encontrado' })

    const created = await registerEndorsement({
      req,
      row,
      actor: await endorsementScopes(req),
      section: d.section,
      status: d.status,
      observations: d.observations,
    })
    return res.status(201).json({ data: created })
  } catch (error) {
    if (error instanceof EndorsementError) return endorsementErrorResponse(res, error)
    console.error('[admin-gradebook] endorsement create:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const bulkEndorsementSchema = z.object({
  gradeBookPeriodIds: z.array(z.string().uuid()).min(1).max(300),
})

/** Por qué una fila del lote no se visa. `null` si está lista. */
function bulkSkipCode(row: EndorsementTarget | undefined): string | null {
  if (!row) return 'NOT_FOUND'
  if (row.gradeBook.status === 'ARCHIVED') return 'SCHOOL_YEAR_CLOSED'
  if (row.status !== 'CLOSED') return 'PERIOD_NOT_CLOSED'
  const states = currentStates(row.endorsements)
  if (statusOf(states, 'ALL') === 'ENDORSED') return 'ALREADY_ENDORSED'
  if (!canFinalize(states)) return 'SECTIONS_OBSERVED'
  return null
}

/**
 * Visado en lote: Dirección visa de una vez lo que ya está listo (cerrado y sin observaciones).
 * Lo que no está listo queda afuera con su motivo; cada libreta se visa, audita y avisa igual que
 * de a una.
 */
r.post('/endorsements/bulk', async (req: any, res) => {
  const parsed = bulkEndorsementSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  try {
    const actor = await endorsementScopes(req)
    if (!actor.scopes.canEndorse) {
      return res.status(403).json({ message: 'Sólo Dirección puede visar una libreta.', code: 'CANNOT_ENDORSE' })
    }

    const ids = [...new Set(parsed.data.gradeBookPeriodIds)]
    const rows = await prisma.gradeBookPeriod.findMany({
      where: { id: { in: ids } },
      include: ENDORSEMENT_TARGET_INCLUDE,
    })
    const byId = new Map(rows.map((row) => [row.id, row]))

    let endorsed = 0
    const skipped: Array<{ gradeBookPeriodId: string; code: string }> = []
    for (const id of ids) {
      const row = byId.get(id)
      const code = bulkSkipCode(row)
      if (code || !row) {
        skipped.push({ gradeBookPeriodId: id, code: code ?? 'NOT_FOUND' })
        continue
      }
      try {
        await registerEndorsement({ req, row, actor, section: 'ALL', status: 'ENDORSED' })
        endorsed++
      } catch (error) {
        if (!(error instanceof EndorsementError)) throw error
        skipped.push({ gradeBookPeriodId: id, code: error.code })
      }
    }

    return res.json({ endorsed, skipped })
  } catch (error) {
    console.error('[admin-gradebook] endorsement bulk:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
