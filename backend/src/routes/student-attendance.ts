import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { authGuard, requirePermission, userPermissionScope } from '../middlewares/auth.js'
import { expandRecurringEvent } from '../events/events-query.js'
import { isYmdDateString } from '../config/app-timezone.js'
import { todayUruguayYmd } from '../services/events/event-versioning.js'
import { occurrenceYmdOf } from '../services/events/occurrence-instant.js'
import { findNonWorkingDayForDate } from '../services/non-working-days.js'
import { getStudentRollCallSettings } from '../config/system-settings.js'
import {
  classifyOccurrence,
  isOccurrenceOk,
  OCCURRENCE_ERROR_MESSAGE,
  type OccurrenceErrorCode,
} from '../services/student-attendance/occurrence.js'
import { resolveRollCallPermissions } from '../services/student-attendance/edit-window.js'
import { canResolveRoster, loadRosterForScope } from '../services/student-attendance/roster.js'
import {
  findSession,
  type IncomingEntry,
  occurrenceDateOf,
  RollCallError,
  saveRollCall,
} from '../services/student-attendance/roll-call.js'
import { findPreviousSession, projectPreviousStatuses } from '../services/student-attendance/copy-previous.js'

const r = Router()
r.use(authGuard)

const EVENT_INCLUDE = {
  subject: { select: { id: true, name: true, code: true } },
  orientation: { select: { id: true, name: true, code: true } },
  courseOrientation: { select: { id: true, orientation: { select: { id: true, name: true, code: true } } } },
  courseOffering: { select: { id: true, course: { select: { id: true, name: true, code: true } } } },
  assignedUser: { select: { id: true, name: true, username: true } },
  childEvents: true,
} as const

const rollCallEntrySchema = z.object({
  studentId: z.string().uuid(),
  // El docente no puede escribir ABSENT_JUSTIFIED: ese estado solo se alcanza justificando,
  // lo que siempre deja una fila de transición. La invariante vive en el schema, no en un if.
  status: z.enum(['PRESENT', 'LATE', 'ABSENT']),
  note: z.string().trim().max(280).nullish(),
})

const rollCallSaveSchema = z.object({
  entries: z.array(rollCallEntrySchema).min(1).max(200),
  source: z.enum(['MANUAL', 'COPIED_FROM_PREVIOUS']).default('MANUAL'),
  copiedFromSessionId: z.string().uuid().nullish(),
  notes: z.string().trim().max(1000).nullish(),
})

/** `:eventId` se valida como uuid para que el compuesto `uuid_ymd` falle con 400 y no con un 404 confuso. */
const paramsSchema = z.object({
  eventId: z.string().uuid('Identificador de clase inválido'),
  ymd: z.string().refine(isYmdDateString, 'Fecha inválida'),
})

const OCCURRENCE_ERROR_STATUS: Record<OccurrenceErrorCode, number> = {
  NOT_A_CLASS: 400,
  IS_EXCEPTION_CHILD: 400,
  EVENT_CANCELLED: 409,
  NO_OCCURRENCE: 409,
  OCCURRENCE_SUSPENDED: 409,
  OUT_OF_EFFECTIVE_WINDOW: 409,
}

function courseLabelOf(event: any): string | null {
  return event.courseOffering?.course?.name ?? null
}

function orientationLabelOf(event: any): string | null {
  return event.courseOrientation?.orientation?.name ?? event.orientation?.name ?? null
}

function cohortOf(event: any) {
  return {
    schoolYearId: event.schoolYearId as string,
    courseOfferingId: (event.courseOfferingId ?? null) as string | null,
    orientationId: (event.orientationId ?? null) as string | null,
    courseOrientationId: (event.courseOrientationId ?? null) as string | null,
    subjectId: (event.subjectId ?? null) as string | null,
  }
}

/** ¿Quien pide es titular de la clase, o suplente oficial ese día? */
async function isResponsibleTeacher(event: any, userId: string, occurrenceYmd: string): Promise<boolean> {
  if (event.assignedUserId === userId) return true
  const substitution = await (prisma as any).substitution.findUnique({
    where: { eventId_date: { eventId: event.id, date: occurrenceDateOf(occurrenceYmd) } },
    select: { substituteUserId: true },
  })
  return substitution?.substituteUserId === userId
}

type OccurrenceContext = {
  event: any
  ymd: string
  startAt: Date
  endAt: Date
  scope: 'own' | 'all'
  isAssigned: boolean
}

/**
 * Carga el evento, valida la ocurrencia y resuelve autorización.
 * Devuelve `null` tras haber respondido el error, para que el handler solo haga `if (!ctx) return`.
 */
async function loadOccurrenceContext(req: any, res: any): Promise<OccurrenceContext | null> {
  const parsed = paramsSchema.safeParse(req.params)
  if (!parsed.success) {
    res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
    return null
  }
  const { eventId, ymd } = parsed.data

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: EVENT_INCLUDE })
  if (!event) {
    res.status(404).json({ message: 'Clase no encontrada' })
    return null
  }

  const occurrence = classifyOccurrence(event as any, ymd)
  if (!isOccurrenceOk(occurrence)) {
    const body: Record<string, unknown> = {
      message: OCCURRENCE_ERROR_MESSAGE[occurrence.code],
      code: occurrence.code,
    }
    // Una edición de la serie crea una versión nueva: sin este puntero el cliente que
    // guarda el id viejo vería un 409 que parece pérdida de datos.
    if (occurrence.code === 'OUT_OF_EFFECTIVE_WINDOW') {
      const sibling = await prisma.event.findFirst({
        where: { OR: [{ id: (event as any).revisionOf ?? event.id }, { revisionOf: (event as any).revisionOf ?? event.id }] },
        select: { id: true, effectiveFrom: true, effectiveUntil: true },
      })
      if (sibling && sibling.id !== event.id) body.redirectEventId = sibling.id
    }
    res.status(OCCURRENCE_ERROR_STATUS[occurrence.code]).json(body)
    return null
  }

  const nonWorking = await findNonWorkingDayForDate(new Date(`${ymd}T00:00:00.000Z`))
  if (nonWorking) {
    res.status(409).json({
      message: `No se pasa lista en un día no laborable: ${nonWorking.reason}`,
      code: 'NON_WORKING_DAY',
    })
    return null
  }

  const user = req.user
  const scope = (await userPermissionScope(user.sub, 'student-attendance.take', user.role)) ?? 'own'
  const isAssigned = await isResponsibleTeacher(event, user.sub, ymd)
  if (scope !== 'all' && !isAssigned) {
    res.status(403).json({ message: 'No sos el docente de esta clase.' })
    return null
  }

  return { event, ymd, startAt: occurrence.startAt, endAt: occurrence.endAt, scope, isAssigned }
}

function serializeEntries(session: any, roster: { studentId: string; firstName: string; lastName: string; documentId: string | null }[]) {
  const byStudent = new Map<string, any>((session?.entries ?? []).map((e: any) => [e.studentId, e]))
  return roster.map((student) => {
    const entry = byStudent.get(student.studentId)
    return {
      studentId: student.studentId,
      firstName: student.firstName,
      lastName: student.lastName,
      documentId: student.documentId,
      entryId: entry?.id ?? null,
      status: entry?.status ?? null,
      note: entry?.note ?? null,
      markedAt: entry?.markedAt ?? null,
    }
  })
}

async function buildSheetResponse(ctx: OccurrenceContext) {
  const cohort = cohortOf(ctx.event)
  const settings = await getStudentRollCallSettings()
  const session = await findSession(ctx.event.id, ctx.ymd)

  const roster = canResolveRoster(ctx.event)
    ? await loadRosterForScope({
        schoolYearId: cohort.schoolYearId,
        courseOfferingId: cohort.courseOfferingId as string,
        orientationId: cohort.orientationId,
        courseOrientationId: cohort.courseOrientationId,
      })
    : []

  const permissions = resolveRollCallPermissions({
    scope: ctx.scope,
    isAssignedTeacher: ctx.isAssigned,
    occurrenceEndAt: ctx.endAt,
    takenAt: session?.takenAt ?? null,
    lockedAt: session?.lockedAt ?? null,
    windowHours: settings.editWindowHours,
  })

  return {
    eventId: ctx.event.id,
    ymd: ctx.ymd,
    title: ctx.event.title,
    subject: ctx.event.subject?.name ?? null,
    course: courseLabelOf(ctx.event),
    orientation: orientationLabelOf(ctx.event),
    startAt: ctx.startAt,
    endAt: ctx.endAt,
    rollCall: {
      sessionId: session?.id ?? null,
      status: session?.status ?? 'PENDING',
      source: session?.source ?? null,
      takenAt: session?.takenAt ?? null,
      notes: session?.notes ?? null,
      canEdit: permissions.canEdit,
      blockedReason: permissions.blockedReason,
      editableUntil: permissions.editableUntil,
      copyPreviousEnabled: settings.copyPreviousEnabled,
    },
    students: serializeEntries(session, roster),
  }
}

/**
 * Clases del día del docente, con el estado de su pase de lista.
 *
 * Devuelve `eventId` y `ymd` como campos SEPARADOS: el id compuesto `uuid_ymd` que produce
 * la expansión de recurrencia nunca llega al cliente, así no puede reenviarlo como eventId.
 */
r.get('/my-classes', requirePermission('student-attendance.take'), async (req: any, res) => {
  try {
    const rawDate = req.query.date ? String(req.query.date) : todayUruguayYmd()
    if (!isYmdDateString(rawDate)) return res.status(400).json({ message: 'Fecha inválida' })

    const userId = req.user.sub
    const scope = (await userPermissionScope(userId, 'student-attendance.take', req.user.role)) ?? 'own'
    const occurrenceDate = occurrenceDateOf(rawDate)

    const substitutions = await (prisma as any).substitution.findMany({
      where: { substituteUserId: userId, date: occurrenceDate },
      select: { eventId: true },
    })
    const substitutedEventIds = substitutions.map((s: { eventId: string }) => s.eventId)

    const events = await prisma.event.findMany({
      where: {
        type: 'CLASE',
        status: { not: 'CANCELLED' },
        parentEventId: null,
        ...(scope === 'all'
          ? {}
          : { OR: [{ assignedUserId: userId }, { id: { in: substitutedEventIds } }] }),
      },
      include: EVENT_INCLUDE,
      orderBy: { startTime: 'asc' },
    })

    const settings = await getStudentRollCallSettings()
    const nonWorking = await findNonWorkingDayForDate(new Date(`${rawDate}T00:00:00.000Z`))

    const occurrences = events
      .map((event) => ({ event, occurrence: classifyOccurrence(event as any, rawDate) }))
      .filter((row) => isOccurrenceOk(row.occurrence))
      .map((row) => ({ event: row.event, startAt: row.occurrence.startAt!, endAt: row.occurrence.endAt! }))

    const sessions = await prisma.studentAttendanceSession.findMany({
      where: { occurrenceYmd: rawDate, eventId: { in: occurrences.map((o) => o.event.id) } },
    })
    const sessionByEvent = new Map(sessions.map((s) => [s.eventId, s]))

    const rows = occurrences
      .map(({ event, startAt, endAt }) => {
        const session = sessionByEvent.get(event.id) ?? null
        const permissions = resolveRollCallPermissions({
          scope,
          isAssignedTeacher: event.assignedUserId === userId || substitutedEventIds.includes(event.id),
          occurrenceEndAt: endAt,
          takenAt: session?.takenAt ?? null,
          lockedAt: session?.lockedAt ?? null,
          windowHours: settings.editWindowHours,
        })
        return {
          eventId: event.id,
          ymd: rawDate,
          title: event.title,
          subject: (event as any).subject?.name ?? null,
          course: courseLabelOf(event),
          orientation: orientationLabelOf(event),
          startAt,
          endAt,
          isSubstitution: event.assignedUserId !== userId && substitutedEventIds.includes(event.id),
          nonWorkingDay: nonWorking ? nonWorking.reason : null,
          rollCall: {
            sessionId: session?.id ?? null,
            status: session?.status ?? 'PENDING',
            takenAt: session?.takenAt ?? null,
            rosterSize: session?.rosterSize ?? null,
            canEdit: permissions.canEdit,
            blockedReason: permissions.blockedReason,
            editableUntil: permissions.editableUntil,
          },
        }
      })
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())

    return res.json(rows)
  } catch (error) {
    console.error('[student-attendance] my-classes:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.get('/sessions/:eventId/:ymd', requirePermission('student-attendance.take'), async (req: any, res) => {
  try {
    const ctx = await loadOccurrenceContext(req, res)
    if (!ctx) return
    return res.json(await buildSheetResponse(ctx))
  } catch (error) {
    console.error('[student-attendance] get session:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

r.put('/sessions/:eventId/:ymd', requirePermission('student-attendance.take'), async (req: any, res) => {
  try {
    const ctx = await loadOccurrenceContext(req, res)
    if (!ctx) return

    const parsed = rollCallSaveSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })
    }

    const cohort = cohortOf(ctx.event)
    if (!canResolveRoster(ctx.event)) {
      return res.status(409).json({
        message: 'La clase no tiene curso asignado; no hay lista que pasar.',
        code: 'NO_COHORT',
      })
    }

    const settings = await getStudentRollCallSettings()
    const session = await findSession(ctx.event.id, ctx.ymd)
    const permissions = resolveRollCallPermissions({
      scope: ctx.scope,
      isAssignedTeacher: ctx.isAssigned,
      occurrenceEndAt: ctx.endAt,
      takenAt: session?.takenAt ?? null,
      lockedAt: session?.lockedAt ?? null,
      windowHours: settings.editWindowHours,
    })
    if (!permissions.canEdit) {
      return res.status(409).json({
        message:
          permissions.blockedReason === 'LOCKED'
            ? 'La planilla fue cerrada por administración.'
            : 'Se venció el plazo para editar esta lista. Pedile el cambio a administración.',
        code: permissions.blockedReason,
        editableUntil: permissions.editableUntil,
      })
    }

    const roster = await loadRosterForScope({
      schoolYearId: cohort.schoolYearId,
      courseOfferingId: cohort.courseOfferingId as string,
      orientationId: cohort.orientationId,
      courseOrientationId: cohort.courseOrientationId,
    })

    await saveRollCall({
      event: ctx.event,
      occurrenceYmd: ctx.ymd,
      startAt: ctx.startAt,
      endAt: ctx.endAt,
      cohort,
      roster,
      entries: parsed.data.entries as IncomingEntry[],
      source: parsed.data.source,
      copiedFromSessionId: parsed.data.copiedFromSessionId ?? null,
      notes: parsed.data.notes ?? null,
      actorUserId: req.user.sub,
      actedAsAdmin: ctx.scope === 'all' && !ctx.isAssigned,
      // Admin escribiendo pasada la ventana: se permite, pero se audita.
      outsideWindow: ctx.scope === 'all' && new Date() > permissions.editableUntil,
      req,
    })

    return res.json(await buildSheetResponse(ctx))
  } catch (error) {
    if (error instanceof RollCallError) {
      return res.status(error.statusCode).json({
        message: error.message,
        code: error.code,
        detail: error.details,
      })
    }
    console.error('[student-attendance] save session:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Sugerencia de "copiar la hora anterior": la última lista TOMADA del mismo grupo ese día.
 * Nunca se aplica sola — el cliente la muestra y el docente confirma.
 */
r.get('/sessions/:eventId/:ymd/previous', requirePermission('student-attendance.take'), async (req: any, res) => {
  try {
    const ctx = await loadOccurrenceContext(req, res)
    if (!ctx) return

    const settings = await getStudentRollCallSettings()
    if (!settings.copyPreviousEnabled) {
      return res.json({ available: false, reason: 'DISABLED', sourceSession: null, suggestions: [], newStudentIds: [] })
    }

    const cohort = cohortOf(ctx.event)
    if (!canResolveRoster(ctx.event)) {
      return res.json({ available: false, reason: 'NO_COHORT', sourceSession: null, suggestions: [], newStudentIds: [] })
    }

    const current = await findSession(ctx.event.id, ctx.ymd)
    const previous = await findPreviousSession({
      occurrenceYmd: ctx.ymd,
      currentStartAt: ctx.startAt,
      currentSessionId: current?.id ?? null,
      courseOfferingId: cohort.courseOfferingId,
      courseOrientationId: cohort.courseOrientationId,
    })
    if (!previous) {
      return res.json({ available: false, reason: 'NO_PREVIOUS', sourceSession: null, suggestions: [], newStudentIds: [] })
    }

    const roster = await loadRosterForScope({
      schoolYearId: cohort.schoolYearId,
      courseOfferingId: cohort.courseOfferingId as string,
      orientationId: cohort.orientationId,
      courseOrientationId: cohort.courseOrientationId,
    })
    const projection = projectPreviousStatuses(previous.entries, roster)

    return res.json({
      available: true,
      reason: null,
      sourceSession: {
        id: previous.id,
        subject: previous.subject?.name ?? null,
        startAt: previous.startAt,
        endAt: previous.endAt,
        takenBy: previous.takenBy?.name ?? previous.takenBy?.username ?? null,
      },
      ...projection,
    })
  } catch (error) {
    console.error('[student-attendance] previous:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
