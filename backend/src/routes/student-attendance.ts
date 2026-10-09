import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/prisma.js'
import { authGuard, requirePermission, userPermissionScope } from '../middlewares/auth.js'
import { isYmdDateString } from '../config/app-timezone.js'
import { todayUruguayYmd } from '../services/events/event-versioning.js'
import { findNonWorkingDayForDate } from '../services/non-working-days.js'
import { getStudentRollCallSettings } from '../config/system-settings.js'
import {
  classifyOccurrence,
  isOccurrenceOk,
  OCCURRENCE_ERROR_MESSAGE,
  type OccurrenceErrorCode,
} from '../services/student-attendance/occurrence.js'
import { resolveRollCallPermissions, rollCallBlockedMessage } from '../services/student-attendance/edit-window.js'
import { canResolveRoster, loadRosterForScope } from '../services/student-attendance/roster.js'
import {
  findSession,
  type IncomingEntry,
  occurrenceDateOf,
  RollCallError,
  saveRollCall,
} from '../services/student-attendance/roll-call.js'
import { findPreviousSession, projectPreviousStatuses } from '../services/student-attendance/copy-previous.js'
import {
  CLASS_EVENT_INCLUDE,
  courseLabelOf,
  loadClassesForDay,
  loadRollCallReminders,
  orientationLabelOf,
} from '../services/student-attendance/my-classes.js'
import { PERSON_SELECT, personRef } from '../services/student-attendance/person.js'

const r = Router()
r.use(authGuard)

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

function cohortOf(event: any) {
  return {
    schoolYearId: event.schoolYearId as string,
    courseOfferingId: (event.courseOfferingId ?? null) as string | null,
    orientationId: (event.orientationId ?? null) as string | null,
    courseOrientationId: (event.courseOrientationId ?? null) as string | null,
    subjectId: (event.subjectId ?? null) as string | null,
  }
}

/** Suplencia del día, con quién cubre: la planilla lo muestra y decide quién es responsable. */
async function findDaySubstitution(eventId: string, occurrenceYmd: string) {
  return (prisma as any).substitution.findUnique({
    where: { eventId_date: { eventId, date: occurrenceDateOf(occurrenceYmd) } },
    select: { substituteUserId: true, substitute: { select: PERSON_SELECT } },
  })
}

type OccurrenceContext = {
  event: any
  ymd: string
  startAt: Date
  endAt: Date
  scope: 'own' | 'all'
  isAssigned: boolean
  substitute: { id: string; name: string } | null
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

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: CLASS_EVENT_INCLUDE })
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
  const substitution = await findDaySubstitution(event.id, ymd)
  // Responsable: el titular, o el suplente oficial ese día.
  const isAssigned = event.assignedUserId === user.sub || substitution?.substituteUserId === user.sub
  if (scope !== 'all' && !isAssigned) {
    res.status(403).json({ message: 'No sos el docente de esta clase.' })
    return null
  }

  return {
    event,
    ymd,
    startAt: occurrence.startAt,
    endAt: occurrence.endAt,
    scope,
    isAssigned,
    substitute: personRef(substitution?.substitute),
  }
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
    occurrenceStartAt: ctx.startAt,
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
    teacher: personRef(ctx.event.assignedUser),
    substitute: ctx.substitute,
    rollCall: {
      sessionId: session?.id ?? null,
      status: session?.status ?? 'PENDING',
      source: session?.source ?? null,
      takenAt: session?.takenAt ?? null,
      takenBy: personRef((session as any)?.takenBy)?.name ?? null,
      notes: session?.notes ?? null,
      canEdit: permissions.canEdit,
      blockedReason: permissions.blockedReason,
      opensAt: permissions.opensAt,
      editableUntil: permissions.editableUntil,
      copyPreviousEnabled: settings.copyPreviousEnabled,
    },
    students: serializeEntries(session, roster),
  }
}

/**
 * Clases del día del docente, con el estado de su pase de lista y quién da cada una.
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
    return res.json(await loadClassesForDay({ userId, scope, ymd: rawDate }))
  } catch (error) {
    console.error('[student-attendance] my-classes:', error)
    return res.status(500).json({ message: 'Error interno del servidor' })
  }
})

/**
 * Listas que quien pide tiene que pasar hoy, para el aviso que la app muestra arriba durante la
 * clase. Siempre las propias, aunque tenga alcance total: administración no da esas clases.
 */
r.get('/reminder', requirePermission('student-attendance.take'), async (req: any, res) => {
  try {
    const items = await loadRollCallReminders({ userId: req.user.sub, ymd: todayUruguayYmd() })
    return res.json({ items })
  } catch (error) {
    console.error('[student-attendance] reminder:', error)
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
      occurrenceStartAt: ctx.startAt,
      occurrenceEndAt: ctx.endAt,
      takenAt: session?.takenAt ?? null,
      lockedAt: session?.lockedAt ?? null,
      windowHours: settings.editWindowHours,
    })
    if (!permissions.canEdit) {
      return res.status(409).json({
        message: rollCallBlockedMessage(permissions),
        code: permissions.blockedReason,
        opensAt: permissions.opensAt,
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
