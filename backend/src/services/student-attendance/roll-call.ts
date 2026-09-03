import { AuditAction, type StudentAttendanceStatus } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { uruguayWallToUtc } from '../../config/app-timezone.js'
import { recordAuditEvent, recordAuditEventNow } from '../audit-log.js'
import type { TeacherWritableStatus } from './edit-window.js'
import { eventFamilyIdOf } from './occurrence.js'
import {
  findStudentsOutsideRoster,
  overridesJustification,
  resolveIncomingEntryStatus,
} from './roll-call-rules.js'
import type { RosterStudent } from './roster.js'

/**
 * Instante que representa el día civil de una ocurrencia.
 *
 * DEBE ser byte a byte el mismo cálculo que `resolveSubstitutionOccurrence` usa para
 * `Substitution.date` (services/substitution-occurrence.ts), o el lookup por
 * `eventId_date` falla y un suplente legítimo recibe un 403 silencioso.
 * Nunca usar `new Date(ymd)`: eso interpreta el día en UTC, no en la zona institucional.
 */
export function occurrenceDateOf(ymd: string): Date {
  return uruguayWallToUtc(ymd, 0, 0)
}

export type RollCallCohort = {
  schoolYearId: string
  courseOfferingId: string | null
  orientationId: string | null
  courseOrientationId: string | null
  subjectId: string | null
}

export type IncomingEntry = {
  studentId: string
  status: TeacherWritableStatus
  note?: string | null
}

export class RollCallError extends Error {
  statusCode: number
  code: string
  details?: unknown

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.details = details
  }
}

type SaveParams = {
  event: { id: string; revisionOf?: string | null }
  occurrenceYmd: string
  startAt: Date
  endAt: Date
  cohort: RollCallCohort
  roster: RosterStudent[]
  entries: IncomingEntry[]
  source: 'MANUAL' | 'COPIED_FROM_PREVIOUS'
  copiedFromSessionId?: string | null
  notes?: string | null
  actorUserId: string
  actedAsAdmin: boolean
  outsideWindow: boolean
  req?: any
}

/** Sesión + entradas de una ocurrencia, o `null` si nunca se tomó. */
export async function findSession(eventId: string, occurrenceYmd: string, db = prisma) {
  return db.studentAttendanceSession.findUnique({
    where: { eventId_occurrenceYmd: { eventId, occurrenceYmd } },
    include: { entries: true },
  })
}

/**
 * Guarda la planilla. Las entradas se UPSERTAN una por una: nunca se borran en masa, así
 * un guardado parcial (o un alumno que se dio de baja) no destruye historial ya cargado.
 */
export async function saveRollCall(params: SaveParams) {
  const rosterIds = params.roster.map((r) => r.studentId)
  const offenders = findStudentsOutsideRoster(
    params.entries.map((e) => e.studentId),
    rosterIds,
  )
  if (offenders.length > 0) {
    throw new RollCallError(
      400,
      'STUDENT_NOT_IN_ROSTER',
      'Hay estudiantes que ya no pertenecen a este grupo.',
      { studentIds: offenders },
    )
  }

  const existing = await findSession(params.event.id, params.occurrenceYmd)
  const previousStatusByStudent = new Map<string, StudentAttendanceStatus>(
    (existing?.entries ?? []).map((e) => [e.studentId, e.status]),
  )
  const rosterByStudent = new Map(params.roster.map((r) => [r.studentId, r]))

  const resolved = params.entries.map((incoming) => {
    const previous = previousStatusByStudent.get(incoming.studentId) ?? null
    return {
      ...incoming,
      previous,
      status: resolveIncomingEntryStatus(previous, incoming.status),
      revertedJustification: overridesJustification(previous, incoming.status),
    }
  })

  const now = new Date()
  const occurrenceDate = occurrenceDateOf(params.occurrenceYmd)

  const session = await prisma.$transaction(async (tx) => {
    const header = await tx.studentAttendanceSession.upsert({
      where: { eventId_occurrenceYmd: { eventId: params.event.id, occurrenceYmd: params.occurrenceYmd } },
      create: {
        eventId: params.event.id,
        eventFamilyId: eventFamilyIdOf(params.event),
        occurrenceYmd: params.occurrenceYmd,
        occurrenceDate,
        startAt: params.startAt,
        endAt: params.endAt,
        schoolYearId: params.cohort.schoolYearId,
        courseOfferingId: params.cohort.courseOfferingId,
        orientationId: params.cohort.orientationId,
        courseOrientationId: params.cohort.courseOrientationId,
        subjectId: params.cohort.subjectId,
        status: 'TAKEN',
        source: params.source,
        copiedFromSessionId: params.copiedFromSessionId ?? null,
        takenByUserId: params.actorUserId,
        takenAt: now,
        rosterSize: params.roster.length,
        notes: params.notes ?? null,
      },
      update: {
        status: 'TAKEN',
        // Quien tomó la lista originalmente no se pisa en una edición posterior.
        takenByUserId: existing?.takenByUserId ?? params.actorUserId,
        takenAt: existing?.takenAt ?? now,
        rosterSize: params.roster.length,
        startAt: params.startAt,
        endAt: params.endAt,
        ...(params.notes === undefined ? {} : { notes: params.notes }),
      },
    })

    for (const entry of resolved) {
      const student = rosterByStudent.get(entry.studentId)
      if (!student) continue
      await tx.studentAttendanceEntry.upsert({
        where: { sessionId_studentId: { sessionId: header.id, studentId: entry.studentId } },
        create: {
          sessionId: header.id,
          studentId: entry.studentId,
          studentEnrollmentId: student.studentEnrollmentId,
          status: entry.status,
          note: entry.note?.trim() || null,
          studentLastName: student.lastName,
          studentFirstName: student.firstName,
          studentDocumentId: student.documentId,
          markedByUserId: params.actorUserId,
          markedAt: now,
        },
        update: {
          status: entry.status,
          note: entry.note?.trim() || null,
          markedByUserId: params.actorUserId,
          markedAt: now,
        },
      })
    }

    return header
  })

  const isFirstTake = !existing
  const metadata = {
    eventId: params.event.id,
    occurrenceYmd: params.occurrenceYmd,
    sessionId: session.id,
    entries: resolved.length,
    rosterSize: params.roster.length,
    source: params.source,
    outsideWindow: params.outsideWindow,
    byAdmin: params.actedAsAdmin,
    revertedJustifications: resolved.filter((e) => e.revertedJustification).map((e) => e.studentId),
  }
  const auditInput = {
    action: isFirstTake ? AuditAction.STUDENT_ROLL_CALL_TAKEN : AuditAction.STUDENT_ROLL_CALL_UPDATED,
    actorUserId: params.actorUserId,
    req: params.req,
    entityType: 'StudentAttendanceSession',
    entityId: session.id,
    metadata,
  }
  // Fuera de ventana o por administración la trazabilidad es obligatoria: se espera el write.
  if (params.outsideWindow || params.actedAsAdmin) await recordAuditEventNow(auditInput)
  else recordAuditEvent(auditInput)

  return session
}
