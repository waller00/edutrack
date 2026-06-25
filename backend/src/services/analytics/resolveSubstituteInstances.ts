import { prisma } from '../../db/prisma.js'
import type { AttendanceStatus, EventType } from '@prisma/client'
import { attachRoleCode, selectOrgRoleCode } from '../../identity/user-role-prisma.js'
import type { AttendanceStatusResolved, PlannedInstance, ResolvedAttendanceByInstance } from './models.js'
import { toYmdUtc } from './dateRange.js'
import { clampedOverlapMinutes } from '../attendance/coverage-spans.js'

function substituteDisplayName(u: {
  name: string | null
  username: string | null
  firstName: string | null
  lastName: string | null
}) {
  if (u.name) return u.name
  const full = `${u.firstName || ''} ${u.lastName || ''}`.trim()
  if (full) return full
  return u.username || 'Suplente'
}

type AttRow = { userId: string; eventId: string | null; date: Date; time: Date; type: string; status: string }
type AttPair = { checkIn?: AttRow; checkOut?: AttRow }

function buildSubstitutionWhere(params: {
  userId?: string
  userIds?: string[] | null
  schoolYearId?: string
  rangeStart: Date
  rangeEnd: Date
  now: Date
}) {
  const where: any = {
    date: { gte: params.rangeStart, lte: params.rangeEnd },
    endTime: { lte: params.now },
  }
  if (params.userId) {
    where.substituteUserId = params.userId
  } else if (params.userIds) {
    where.substituteUserId = { in: params.userIds }
  }
  if (params.schoolYearId) where.event = { schoolYearId: params.schoolYearId }
  return where
}

/** Indexa las marcas del suplente por usuario+evento+día, eligiendo el primer CHECK_IN y último CHECK_OUT. */
function indexSubstituteAttendances(attendances: AttRow[]): Map<string, AttPair> {
  const byKey = new Map<string, AttPair>()
  for (const att of attendances) {
    if (!att.eventId) continue
    const key = `${att.userId}|${att.eventId}|${toYmdUtc(att.date)}`
    const pair = byKey.get(key) ?? {}
    if (att.type === 'CHECK_IN') {
      if (!pair.checkIn || new Date(att.time) < new Date(pair.checkIn.time)) pair.checkIn = att
    } else if (!pair.checkOut || new Date(att.time) > new Date(pair.checkOut.time)) {
      pair.checkOut = att
    }
    byKey.set(key, pair)
  }
  return byKey
}

function toResolvedSubstituteInstance(sub: any, byKey: Map<string, AttPair>): ResolvedAttendanceByInstance {
  const ymd = toYmdUtc(sub.date)
  const rawUser = sub.substitute
  const plannedStart: Date | null = sub.startTime ? new Date(sub.startTime) : null
  const plannedEnd: Date | null = sub.endTime ? new Date(sub.endTime) : null
  const course = sub.event?.courseOffering?.course

  const planned: PlannedInstance = {
    plannedInstanceId: `sub_${sub.id}`,
    eventId: sub.eventId,
    eventTitle: sub.event?.title ?? 'Clase',
    eventType: (sub.event?.type ?? 'CLASE') as EventType,
    eventStatus: (sub.event?.status ?? 'SCHEDULED') as any,
    isRecurringInstance: false,
    plannedDate: ymd,
    plannedStartTime: plannedStart,
    plannedEndTime: plannedEnd,
    userIdRequired: sub.substituteUserId,
    courseOfferingId: sub.event?.courseOfferingId ?? null,
    courseLabel: course ? course.name || course.code || null : null,
    subjectLabel: sub.event?.subject?.name ?? null,
  }

  const pair = byKey.get(`${sub.substituteUserId}|${sub.eventId}|${ymd}`)
  const checkIn = pair?.checkIn ?? null
  const checkOut = pair?.checkOut ?? null

  // El suplente asistió → respetamos su estado registrado (PRESENT/LATE). Si no, ausencia no justificada.
  const checkInStatusResolved: AttendanceStatusResolved = checkIn
    ? (checkIn.status as AttendanceStatus as AttendanceStatusResolved)
    : 'ABSENT_NOT_JUSTIFIED'

  const actualInTime = checkIn ? new Date(checkIn.time) : null
  const actualOutTime = checkOut ? new Date(checkOut.time) : null

  return {
    planned,
    checkInStatusResolved,
    checkOutStatusResolved: checkOut
      ? (checkOut.status as AttendanceStatus as AttendanceStatusResolved)
      : checkInStatusResolved,
    hasCheckIn: Boolean(checkIn),
    hasCheckOut: Boolean(checkOut),
    actualInTime,
    actualOutTime,
    durationMinutes: clampedOverlapMinutes(actualInTime, actualOutTime, plannedStart, plannedEnd),
    // La inasistencia del suplente nunca se considera justificada (asignación manual).
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: checkIn ? null : 'Ausencia del suplente: no registró asistencia a la suplencia asignada',
    checkOutNotes: null,
    userDisplayName: rawUser ? substituteDisplayName(rawUser) : 'Suplente',
    userRole: rawUser ? attachRoleCode(rawUser).role || 'TEACHER' : 'TEACHER',
    userEmail: rawUser?.email || '',
  }
}

/**
 * Instancias resueltas del SUPLENTE. Una suplencia asigna al suplente la obligación de cubrir la
 * clase: si registró asistencia cuenta como presente/tarde, y si no lo hizo es una ausencia no
 * justificada propia (fue asignado manualmente). El titular ya figura aparte como SUBSTITUTED.
 *
 * Se modela como instancia independiente (plannedInstanceId `sub_<id>`) para no chocar con la
 * instancia del titular (mismo evento+fecha) y poder sumarse al resto de métricas del dashboard.
 */
export async function resolveSubstituteInstances(params: {
  from: string
  to: string
  userId?: string
  userIds?: string[] | null
  eventType?: EventType
  schoolYearId?: string
  now?: Date
}): Promise<ResolvedAttendanceByInstance[]> {
  // Las suplencias sólo existen sobre clases.
  if (params.eventType && params.eventType !== 'CLASE') return []

  const now = params.now ?? new Date()
  const rangeStart = new Date(`${params.from}T00:00:00.000Z`)
  const rangeEnd = new Date(`${params.to}T23:59:59.999Z`)

  const subs = await (prisma as any).substitution.findMany({
    where: buildSubstitutionWhere({
      userId: params.userId,
      userIds: params.userIds,
      schoolYearId: params.schoolYearId,
      rangeStart,
      rangeEnd,
      now,
    }),
    include: {
      substitute: {
        select: { id: true, name: true, username: true, firstName: true, lastName: true, email: true, ...selectOrgRoleCode },
      },
      event: {
        select: {
          id: true,
          title: true,
          type: true,
          status: true,
          courseOfferingId: true,
          courseOffering: { select: { course: { select: { name: true, code: true } } } },
          subject: { select: { name: true } },
        },
      },
    },
  })
  if (subs.length === 0) return []

  const subUserIds: string[] = Array.from(new Set<string>(subs.map((s: any) => s.substituteUserId)))
  const subEventIds: string[] = Array.from(new Set<string>(subs.map((s: any) => s.eventId)))

  const attendances = await prisma.attendance.findMany({
    where: {
      userId: { in: subUserIds },
      eventId: { in: subEventIds },
      type: { in: ['CHECK_IN', 'CHECK_OUT'] },
      date: { gte: rangeStart, lte: rangeEnd },
    },
    select: { userId: true, eventId: true, date: true, time: true, type: true, status: true },
  })

  const byKey = indexSubstituteAttendances(attendances as AttRow[])
  return subs.map((sub: any) => toResolvedSubstituteInstance(sub, byKey))
}
