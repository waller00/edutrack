import { Router } from 'express'
import { requirePermission } from '../middlewares/auth.js'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { applyEventStartDateFilter, expandRecurringEvent } from '../events/events-query.js'
import { isYmdDateString } from '../config/app-timezone.js'
import { todayUruguayYmd } from '../services/events/event-versioning.js'
import { occurrenceYmdOf } from '../services/events/occurrence-instant.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { FULL_ABSENCE, HALF_ABSENCE } from '../services/student-attendance/absence-weight.js'
import { AuditAction } from '@prisma/client'
import { recordAuditEventNow } from '../services/audit-log.js'
import {
  clampPendingRange,
  selectPendingOccurrences,
  sessionKey,
  type ExpandedOccurrence,
} from '../services/student-attendance/pending.js'
import { justifyStudentAbsence } from '../services/student-attendance/justify.js'
import {
  consolidateRange,
  overallTotals,
  totalsBySubject,
  type AttendanceCell,
} from '../services/student-attendance/consolidation.js'
import { getStudentRollCallSettings } from '../config/system-settings.js'
import { RollCallError } from '../services/student-attendance/roll-call.js'

const r = Router()

const pendingQuerySchema = z.object({
  from: z.string().refine(isYmdDateString, 'Fecha desde inválida').optional(),
  to: z.string().refine(isYmdDateString, 'Fecha hasta inválida').optional(),
  courseOfferingId: z.string().uuid().optional(),
  subjectId: z.string().uuid().optional(),
  teacherUserId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

const justifySchema = z.object({
  type: z.enum(['ABSENCE', 'LATE_ARRIVAL', 'OTHER']).default('ABSENCE'),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(1000).nullish(),
  attachment: z.string().trim().max(2000).nullish(),
  /**
   * Cuánto pesa la falta: 100 (entera) o 50 (media). Lo decide adscripción caso por caso — el
   * liceo no tiene una regla automática— y por eso viaja acá y no se deriva del estado.
   */
  absenceWeightHundredths: z
    .union([z.literal(FULL_ABSENCE), z.literal(HALF_ABSENCE)], {
      errorMap: () => ({ message: 'La falta vale 100 (entera) o 50 (media)' }),
    })
    .nullish(),
})

/**
 * Listas sin pasar en un rango.
 *
 * No hay filas PENDING pre-creadas (la recurrencia no se materializa), así que el pendiente
 * se calcula: se expanden las ocurrencias del rango y se restan las sesiones ya tomadas.
 * Los días no laborables y las sesiones se traen en UNA consulta cada uno, nunca por ocurrencia.
 */
r.get('/pending', async (req: any, res) => {
  try {
    const parsed = pendingQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
    }
    const today = todayUruguayYmd()
    const requestedFrom = parsed.data.from ?? today
    const requestedTo = parsed.data.to ?? today
    if (requestedTo < requestedFrom) {
      return res.status(400).json({ message: 'El rango de fechas es inválido' })
    }
    const { from, to, clamped } = clampPendingRange(requestedFrom, requestedTo)

    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })
    if (!schoolYearId) return res.status(400).json({ message: 'No hay ciclo lectivo activo' })

    const where: Record<string, unknown> = {
      type: 'CLASE',
      status: { not: 'CANCELLED' },
      parentEventId: null,
      schoolYearId,
      ...(parsed.data.courseOfferingId ? { courseOfferingId: parsed.data.courseOfferingId } : {}),
      ...(parsed.data.subjectId ? { subjectId: parsed.data.subjectId } : {}),
      ...(parsed.data.teacherUserId ? { assignedUserId: parsed.data.teacherUserId } : {}),
    }
    applyEventStartDateFilter(where, from, to)

    const events = await prisma.event.findMany({
      where: where as never,
      include: {
        subject: { select: { name: true } },
        orientation: { select: { name: true } },
        courseOrientation: { select: { orientation: { select: { name: true } } } },
        courseOffering: { select: { course: { select: { name: true } } } },
        assignedUser: { select: { id: true, name: true, username: true } },
        childEvents: true,
      },
      orderBy: { startTime: 'asc' },
    })

    const occurrences: ExpandedOccurrence[] = events.flatMap((event: any) =>
      (expandRecurringEvent(event, from, to) as any[]).map((occ) => {
        const startAt = new Date(occ.startTime ?? occ.startDate)
        return {
          eventId: event.id,
          ymd: occurrenceYmdOf(startAt),
          startAt,
          endAt: new Date(occ.endTime ?? occ.startDate),
          title: event.title,
          subject: event.subject?.name ?? null,
          course: event.courseOffering?.course?.name ?? null,
          orientation: event.courseOrientation?.orientation?.name ?? event.orientation?.name ?? null,
          teacher: event.assignedUser
            ? { id: event.assignedUser.id, name: event.assignedUser.name, username: event.assignedUser.username }
            : null,
        }
      }),
    )

    const [nonWorkingRows, sessionRows] = await Promise.all([
      (prisma as any).nonWorkingDay.findMany({
        where: { date: { gte: new Date(`${from}T00:00:00.000Z`), lte: new Date(`${to}T00:00:00.000Z`) } },
        select: { date: true },
      }),
      prisma.studentAttendanceSession.findMany({
        where: { occurrenceYmd: { gte: from, lte: to }, eventId: { in: events.map((e) => e.id) } },
        select: { id: true, eventId: true, occurrenceYmd: true, status: true },
      }),
    ])

    const nonWorkingYmds = new Set<string>(
      nonWorkingRows.map((row: { date: Date }) => new Date(row.date).toISOString().slice(0, 10)),
    )
    const sessions = new Map(
      sessionRows.map((s) => [sessionKey(s.eventId, s.occurrenceYmd), { id: s.id, status: s.status as string }]),
    )

    const rows = selectPendingOccurrences({ occurrences, sessions, nonWorkingYmds, now: new Date() })
    const start = (parsed.data.page - 1) * parsed.data.pageSize

    return res.json({
      total: rows.length,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      rangeClamped: clamped,
      from,
      to,
      data: rows.slice(start, start + parsed.data.pageSize),
    })
  } catch (error) {
    console.error('[admin-student-attendance] pending:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.post('/entries/:entryId/justify', requirePermission('student-attendance.justify', 'all'), async (req: any, res) => {
  try {
    const parsed = justifySchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })
    }
    const result = await justifyStudentAbsence({
      entryId: String(req.params.entryId),
      type: parsed.data.type,
      reason: parsed.data.reason,
      notes: parsed.data.notes ?? null,
      attachment: parsed.data.attachment ?? null,
      absenceWeightHundredths: parsed.data.absenceWeightHundredths ?? null,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
    })
    return res.json({ ...result, message: 'Justificación registrada correctamente' })
  } catch (error) {
    if (error instanceof RollCallError) {
      return res.status(error.statusCode).json({ message: error.message, code: error.code })
    }
    console.error('[admin-student-attendance] justify:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/** Reabre una planilla cerrada para que el docente pueda corregirla. */
r.post('/sessions/:sessionId/reopen', requirePermission('student-attendance.manage', 'all'), async (req: any, res) => {
  try {
    const reason = String(req.body?.reason ?? '').trim()
    if (reason.length < 3) return res.status(400).json({ message: 'Indicá el motivo de la reapertura' })

    const session = await prisma.studentAttendanceSession.findUnique({ where: { id: String(req.params.sessionId) } })
    if (!session) return res.status(404).json({ message: 'Planilla no encontrada' })

    const updated = await prisma.studentAttendanceSession.update({
      where: { id: session.id },
      data: { lockedAt: null, lockedByUserId: null },
    })

    await recordAuditEventNow({
      action: AuditAction.STUDENT_ROLL_CALL_REOPENED,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
      entityType: 'StudentAttendanceSession',
      entityId: session.id,
      metadata: { reason, eventId: session.eventId, occurrenceYmd: session.occurrenceYmd },
    })

    return res.json({ ok: true, sessionId: updated.id })
  } catch (error) {
    console.error('[admin-student-attendance] reopen:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

const historyQuerySchema = z.object({
  from: z.string().refine(isYmdDateString, 'Fecha desde inválida').optional(),
  to: z.string().refine(isYmdDateString, 'Fecha hasta inválida').optional(),
})

/**
 * Ficha de asistencia de un estudiante.
 *
 * Todo lo agregado se DERIVA de las marcas por clase: no hay contadores persistidos que
 * puedan quedar desfasados. Las clases sin lista tomada no existen como filas, así que no
 * entran en ningún denominador.
 */
r.get('/students/:studentId', async (req: any, res) => {
  try {
    const parsed = historyQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
    }

    const student = await prisma.student.findUnique({
      where: { id: String(req.params.studentId) },
      select: { id: true, firstName: true, lastName: true, documentId: true },
    })
    if (!student) return res.status(404).json({ message: 'Estudiante no encontrado' })

    const schoolYearId = await resolveSchoolYearIdForList(prisma, {
      role: req.user?.role,
      requestedSchoolYearId: req.query.schoolYearId ? String(req.query.schoolYearId) : undefined,
    })

    const entries = await prisma.studentAttendanceEntry.findMany({
      where: {
        studentId: student.id,
        session: {
          ...(schoolYearId ? { schoolYearId } : {}),
          ...(parsed.data.from || parsed.data.to
            ? {
                occurrenceYmd: {
                  ...(parsed.data.from ? { gte: parsed.data.from } : {}),
                  ...(parsed.data.to ? { lte: parsed.data.to } : {}),
                },
              }
            : {}),
        },
      },
      select: {
        id: true,
        status: true,
        note: true,
        session: {
          select: {
            id: true,
            occurrenceYmd: true,
            startAt: true,
            endAt: true,
            subjectId: true,
            subject: { select: { name: true } },
            event: { select: { title: true } },
          },
        },
      },
      orderBy: { session: { occurrenceYmd: 'asc' } },
    })

    const cells: AttendanceCell[] = entries.map((entry) => ({
      ymd: entry.session.occurrenceYmd,
      status: entry.status,
      subjectId: entry.session.subjectId,
      subjectName: entry.session.subject?.name ?? null,
    }))

    const settings = await getStudentRollCallSettings()
    const opts = { thresholdPercent: settings.dailyAbsenceThresholdPercent }

    return res.json({
      student,
      bySubject: totalsBySubject(cells),
      daily: consolidateRange(cells, opts),
      overall: overallTotals(cells, opts),
      entries: entries.map((entry) => ({
        entryId: entry.id,
        status: entry.status,
        note: entry.note,
        ymd: entry.session.occurrenceYmd,
        startAt: entry.session.startAt,
        endAt: entry.session.endAt,
        subject: entry.session.subject?.name ?? null,
        title: entry.session.event?.title ?? null,
      })),
    })
  } catch (error) {
    console.error('[admin-student-attendance] student history:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
