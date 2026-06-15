import { Router } from 'express'
import { z } from 'zod'
import { DateTime } from 'luxon'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { getPlannedInstances } from '../services/analytics/planInstances.js'
import { resolveAttendanceAndJustification } from '../services/analytics/resolveInstances.js'
import {
  buildDashboardBreakdowns,
  computeDashboardKpis,
  computeKpiDeltas,
  computeSeriesByGranularity,
  computeSeriesByWeek,
  computeStatusDistribution,
  computeTopRiskEvents,
  computeTopRiskPeople,
} from '../services/analytics/metrics.js'
import type { ResolvedAttendanceByInstance } from '../services/analytics/models.js'
import { prisma } from '../db/prisma.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { getAppTimezone, uruguayWallToUtc, uruguayYmdEndOfDayToUtc } from '../config/app-timezone.js'
import { timelineSortInstantOnDay } from '../services/analytics/timeline-sort.js'

const r = Router()

const timelineStatusValues = [
  'REGISTERED',
  'PRESENT',
  'LATE',
  'PENDING',
  'FREE',
  'SUSPENDED',
  'SUBSTITUTED',
  'OUT_OF_SCHEDULE',
  'UNIDENTIFIED',
  'JUSTIFIED',
  'EARLY_EXIT',
] as const

const timelineTypeValues = [
  'BIOMETRIC_ENTRY',
  'BIOMETRIC_EXIT',
  'CLASS_ATTENDANCE',
  'LATE_ARRIVAL',
  'PENDING_ABSENCE',
  'FREE_BRIDGE',
  'SUSPENDED_CLASS',
  'SUBSTITUTION',
  'OUT_OF_SCHEDULE_PUNCH',
  'UNIDENTIFIED_PUNCH',
  'JUSTIFICATION',
  'EARLY_EXIT',
] as const

const timelineStatusFilterValues = [
  'PRESENT',
  'LATE',
  'PENDING',
  'SUBSTITUTED',
  'SUSPENDED',
  'OUT_OF_SCHEDULE',
  'UNIDENTIFIED',
  'EARLY_EXIT',
] as const

const timelineTypeFilterOptions = [
  { value: 'BIOMETRIC_ENTRY', label: 'Entrada por huella' },
  { value: 'BIOMETRIC_EXIT', label: 'Salida por huella' },
  { value: 'CLASS_ATTENDANCE', label: 'Clase' },
  { value: 'SUBSTITUTION', label: 'Suplencia' },
  { value: 'JUSTIFICATION', label: 'Justificación' },
] as const

const dashboardQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  role: z.enum(['ADMIN', 'STAFF', 'TEACHER']).optional(),
  userId: z.string().uuid().optional(),
  eventType: z
    .enum(['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA'])
    .optional(),
  granularity: z.enum(['day', 'week', 'month']).optional(),
  compareToPrevious: z.union([z.literal('1'), z.literal('true'), z.literal('0'), z.literal('false')]).optional(),
  schoolYearId: z.string().uuid().optional(),
  allYears: z.union([z.literal('1'), z.literal('true')]).optional(),
})

const attendanceTimelineQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  teacherId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
  status: z.enum(timelineStatusValues).optional(),
  type: z.enum(timelineTypeValues).optional(),
  schoolYearId: z.string().uuid().optional(),
  allYears: z.union([z.literal('1'), z.literal('true')]).optional(),
})

async function scopeUserIds(params: { role?: 'ADMIN' | 'STAFF' | 'TEACHER'; userId?: string }) {
  if (params.userId) return [params.userId]
  if (!params.role) return null
  const rows = await prisma.user.findMany({
    where: { orgRole: { code: params.role } },
    select: { id: true },
  })
  return rows.map((x) => x.id)
}

type ParsedDashboardQuery = z.infer<typeof dashboardQuerySchema>

type TimelineStatus = (typeof timelineStatusValues)[number]
type TimelineType = (typeof timelineTypeValues)[number]

type TimelineItem = {
  id: string
  time: string
  sortTime: string
  type: TimelineType
  status: TimelineStatus
  title: string
  detail?: string | null
  teacher?: { id: string; name: string; email?: string | null } | null
  group?: { id: string; name: string } | null
  event?: { id: string; title: string } | null
}

function todayYmdUruguay() {
  return DateTime.now().setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

function displayName(user?: { name?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null } | null) {
  if (!user) return 'Sin docente'
  if (user.name) return user.name
  const full = `${user.firstName || ''} ${user.lastName || ''}`.trim()
  return full || user.email || 'Sin docente'
}

function courseLabel(course?: { name?: string | null; code?: string | null } | null) {
  if (!course) return null
  return course.code ? `${course.name || course.code}` : course.name || null
}

function subjectCourseTitle(params: {
  title: string
  subject?: { name?: string | null } | null
  course?: { name?: string | null; code?: string | null } | null
}) {
  const subject = params.subject?.name
  const course = courseLabel(params.course)
  if (subject && course) return `${subject} ${course}`
  return subject || course || params.title
}

function formatTimeLabel(at?: Date | string | null) {
  if (!at) return ''
  return DateTime.fromJSDate(new Date(at), { zone: 'utc' }).setZone(getAppTimezone()).toFormat('HH:mm')
}

function timelineStatusLabel(status: string) {
  const labels: Record<string, string> = {
    REGISTERED: 'Registrado',
    PRESENT: 'Presente',
    LATE: 'Tarde',
    PENDING: 'Pendiente',
    FREE: 'Libre',
    SUSPENDED: 'Suspendida',
    SUBSTITUTED: 'Ausencia prevista',
    OUT_OF_SCHEDULE: 'Fuera de horario',
    UNIDENTIFIED: 'No identificada',
    JUSTIFIED: 'Justificado',
    EARLY_EXIT: 'Retiro anticipado',
  }
  return labels[status] ?? status
}

async function computeAttendanceTimeline(data: z.infer<typeof attendanceTimelineQuerySchema>) {
  const date = data.date || todayYmdUruguay()
  const dayStart = uruguayWallToUtc(date, 0, 0)
  const dayEnd = uruguayYmdEndOfDayToUtc(date)
  const schoolYearId = data.allYears
    ? undefined
    : await resolveSchoolYearIdForList(prisma, {
        role: 'ADMIN',
        requestedSchoolYearId: data.schoolYearId,
      })

  const plannedInstances = await getPlannedInstances({
    from: date,
    to: date,
    eventType: 'CLASE' as any,
    userId: data.teacherId,
    schoolYearId: schoolYearId || undefined,
  })

  const eventIds = Array.from(new Set(plannedInstances.map((p) => p.eventId)))
  const events = eventIds.length
    ? await prisma.event.findMany({
        where: {
          id: { in: eventIds },
          ...(data.groupId ? { courseOffering: { courseId: data.groupId } } : null),
        },
        select: {
          id: true,
          title: true,
          status: true,
          startTime: true,
          endTime: true,
          assignedUserId: true,
          assignedUser: { select: { id: true, name: true, email: true, firstName: true, lastName: true } },
          subject: { select: { id: true, name: true } },
          courseOffering: {
            select: { courseId: true, course: { select: { id: true, name: true, code: true } } },
          },
        },
      })
    : []
  const eventById = new Map(events.map((event) => [event.id, event]))
  const filteredPlanned = plannedInstances.filter((planned) => eventById.has(planned.eventId))
  const resolved = await resolveAttendanceAndJustification({ plannedInstances: filteredPlanned })

  const items: TimelineItem[] = []

  const teachers = new Map<string, { id: string; name: string; email?: string | null }>()
  const groups = new Map<string, { id: string; name: string }>()

  for (const event of events) {
    if (event.assignedUser) {
      teachers.set(event.assignedUser.id, {
        id: event.assignedUser.id,
        name: displayName(event.assignedUser),
        email: event.assignedUser.email,
      })
    }
    const course = event.courseOffering?.course
    if (course?.id) groups.set(course.id, { id: course.id, name: courseLabel(course) || course.id })
  }

  for (const row of resolved) {
    const event = eventById.get(row.planned.eventId)
    if (!event) continue
    const teacher = event.assignedUser
      ? { id: event.assignedUser.id, name: displayName(event.assignedUser), email: event.assignedUser.email }
      : null
    const group = event.courseOffering?.course?.id
      ? { id: event.courseOffering.course.id, name: courseLabel(event.courseOffering.course) || event.courseOffering.course.id }
      : null
    const classTitle = subjectCourseTitle({ title: event.title, subject: event.subject, course: event.courseOffering?.course })
    const start = row.planned.plannedStartTime || event.startTime || dayStart

    let status: TimelineStatus = 'PRESENT'
    let type: TimelineType = 'CLASS_ATTENDANCE'
    if (row.checkInStatusResolved === 'LATE') {
      status = 'LATE'
      type = 'LATE_ARRIVAL'
    } else if (row.checkInStatusResolved === 'ABSENT_NOT_JUSTIFIED') {
      status = 'PENDING'
      type = 'PENDING_ABSENCE'
    } else if (row.checkInStatusResolved === 'ABSENT_JUSTIFIED' || row.checkInStatusResolved === 'JUSTIFIED') {
      status = 'JUSTIFIED'
      type = 'JUSTIFICATION'
    } else if (row.checkInStatusResolved === 'SUBSTITUTED') {
      status = 'SUBSTITUTED'
      type = 'SUBSTITUTION'
    } else if (row.checkInStatusResolved === 'SUSPENDED') {
      status = 'SUSPENDED'
      type = 'SUSPENDED_CLASS'
    }

    items.push({
      id: `class:${row.planned.plannedInstanceId}`,
      time: formatTimeLabel(start),
      sortTime: timelineSortInstantOnDay(date, start).toISOString(),
      type,
      status,
      title:
        status === 'SUBSTITUTED'
          ? `${teacher?.name || row.userDisplayName} tiene ausencia prevista sin justificar en ${classTitle}`
          : `${classTitle} - ${teacher?.name || row.userDisplayName}`,
      detail:
        status === 'PENDING'
          ? 'No registró asistencia'
          : status === 'LATE'
            ? 'Llegada tarde vinculada al bloque horario'
            : status === 'SUBSTITUTED'
              ? 'Clase cubierta por suplencia; ausencia sin justificar'
              : 'Clase vinculada a marcación biométrica',
      teacher,
      group,
      event: { id: event.id, title: event.title },
    })

    if (row.checkOutStatusResolved === 'EARLY_EXIT') {
      const at = row.actualOutTime || row.planned.plannedEndTime || start
      items.push({
        id: `early-exit:${row.planned.plannedInstanceId}`,
        time: formatTimeLabel(at),
        sortTime: timelineSortInstantOnDay(date, at).toISOString(),
        type: 'EARLY_EXIT',
        status: 'EARLY_EXIT',
        title: `${teacher?.name || row.userDisplayName} registró retiro anticipado`,
        detail: classTitle,
        teacher,
        group,
        event: { id: event.id, title: event.title },
      })
    }
  }

  const byTeacher = new Map<string, typeof resolved>()
  for (const row of resolved) {
    const userId = row.planned.userIdRequired
    if (!userId) continue
    if (!byTeacher.has(userId)) byTeacher.set(userId, [])
    byTeacher.get(userId)!.push(row)
  }
  for (const rows of byTeacher.values()) {
    const sorted = [...rows].sort((a, b) => {
      const at = a.planned.plannedStartTime?.getTime() ?? 0
      const bt = b.planned.plannedStartTime?.getTime() ?? 0
      return at - bt
    })
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const current = sorted[i]!
      const next = sorted[i + 1]!
      if (!current.planned.plannedEndTime || !next.planned.plannedStartTime) continue
      const gapMs = next.planned.plannedStartTime.getTime() - current.planned.plannedEndTime.getTime()
      if (gapMs <= 0) continue
      const teacher = teachers.get(current.planned.userIdRequired || '')
      items.push({
        id: `bridge:${current.planned.plannedInstanceId}:${next.planned.plannedInstanceId}`,
        time: formatTimeLabel(current.planned.plannedEndTime),
        sortTime: timelineSortInstantOnDay(date, current.planned.plannedEndTime).toISOString(),
        type: 'FREE_BRIDGE',
        status: 'FREE',
        title: `${teacher?.name || current.userDisplayName} tiene puente libre`,
        detail: `Hasta ${formatTimeLabel(next.planned.plannedStartTime)}`,
        teacher: teacher || null,
        group: null,
        event: null,
      })
    }
  }

  const attendanceRows = await prisma.attendance.findMany({
    where: {
      date: { gte: dayStart, lte: dayEnd },
      ...(data.teacherId ? { userId: data.teacherId } : null),
      OR: [{ status: 'OUT_OF_SCHEDULE' as any }, { eventId: { in: eventIds.length ? eventIds : ['__none__'] } }],
    },
    select: {
      id: true,
      type: true,
      status: true,
      time: true,
      notes: true,
      user: { select: { id: true, name: true, email: true, firstName: true, lastName: true } },
      event: {
        select: {
          id: true,
          title: true,
          subject: { select: { name: true } },
          courseOffering: { select: { course: { select: { id: true, name: true, code: true } } } },
        },
      },
    },
  })

  for (const row of attendanceRows) {
    const teacher = row.user ? { id: row.user.id, name: displayName(row.user), email: row.user.email } : null
    const course = row.event?.courseOffering?.course
    const group = course?.id ? { id: course.id, name: courseLabel(course) || course.id } : null
    const rowStatus = String(row.status)
    if (data.groupId && group?.id !== data.groupId && rowStatus !== 'OUT_OF_SCHEDULE') continue
    if (teacher) teachers.set(teacher.id, teacher)
    if (group) groups.set(group.id, group)

    const isOut = rowStatus === 'OUT_OF_SCHEDULE'
    items.push({
      id: `attendance:${row.id}`,
      time: formatTimeLabel(row.time),
      sortTime: new Date(row.time).toISOString(),
      type: isOut ? 'OUT_OF_SCHEDULE_PUNCH' : row.type === 'CHECK_OUT' ? 'BIOMETRIC_EXIT' : 'BIOMETRIC_ENTRY',
      status: isOut ? 'OUT_OF_SCHEDULE' : 'REGISTERED',
      title: `${teacher?.name || 'Docente'} ${row.type === 'CHECK_OUT' ? 'registró salida por huella' : 'registró entrada por huella'}`,
      detail: isOut ? 'Marcación sin horario asignado' : row.event?.title || 'Marcación biométrica',
      teacher,
      group,
      event: row.event ? { id: row.event.id, title: row.event.title } : null,
    })
  }

  const unidentifiedPunches = await prisma.biometricPunch.findMany({
    where: {
      occurredAt: { gte: dayStart, lte: dayEnd },
      OR: [{ userId: null }, { punchType: 'UNKNOWN' as any }, { processStatus: 'FAILED' as any }],
    },
    select: { id: true, occurredAt: true, deviceUserId: true, processError: true },
    orderBy: { occurredAt: 'asc' },
  })
  for (const punch of unidentifiedPunches) {
    items.push({
      id: `unidentified:${punch.id}`,
      time: formatTimeLabel(punch.occurredAt),
      sortTime: new Date(punch.occurredAt).toISOString(),
      type: 'UNIDENTIFIED_PUNCH',
      status: 'UNIDENTIFIED',
      title: 'Marcación no identificada',
      detail: punch.processError || `PIN ${punch.deviceUserId}`,
      teacher: null,
      group: null,
      event: null,
    })
  }

  const suspendedEvents = await prisma.event.findMany({
    where: {
      type: 'CLASE' as any,
      status: 'CANCELLED' as any,
      startTime: { gte: dayStart, lte: dayEnd },
      ...(data.teacherId ? { assignedUserId: data.teacherId } : null),
      ...(data.groupId ? { courseOffering: { courseId: data.groupId } } : null),
      ...(schoolYearId ? { schoolYearId } : null),
    },
    select: {
      id: true,
      title: true,
      startTime: true,
      assignedUser: { select: { id: true, name: true, email: true, firstName: true, lastName: true } },
      subject: { select: { name: true } },
      courseOffering: { select: { course: { select: { id: true, name: true, code: true } } } },
    },
  })
  for (const event of suspendedEvents) {
    const teacher = event.assignedUser ? { id: event.assignedUser.id, name: displayName(event.assignedUser), email: event.assignedUser.email } : null
    const course = event.courseOffering?.course
    const group = course?.id ? { id: course.id, name: courseLabel(course) || course.id } : null
    items.push({
      id: `suspended:${event.id}`,
      time: formatTimeLabel(event.startTime),
      sortTime: timelineSortInstantOnDay(date, event.startTime || dayStart).toISOString(),
      type: 'SUSPENDED_CLASS',
      status: 'SUSPENDED',
      title: `${subjectCourseTitle({ title: event.title, subject: event.subject, course })} - clase suspendida`,
      detail: teacher?.name || null,
      teacher,
      group,
      event: { id: event.id, title: event.title },
    })
  }

  const substitutionRows = await prisma.$queryRaw<
    {
      id: string
      eventId: string
      startTime: Date
      reason: string
      eventTitle: string
      originalId: string
      originalName: string | null
      originalEmail: string | null
      substituteId: string
      substituteName: string | null
      substituteEmail: string | null
      courseId: string | null
      courseName: string | null
      courseCode: string | null
      subjectName: string | null
    }[]
  >`
    SELECT
      s."id",
      s."eventId",
      s."startTime",
      s."reason",
      e."title" AS "eventTitle",
      original."id" AS "originalId",
      original."name" AS "originalName",
      original."email" AS "originalEmail",
      substitute."id" AS "substituteId",
      substitute."name" AS "substituteName",
      substitute."email" AS "substituteEmail",
      c."id" AS "courseId",
      c."name" AS "courseName",
      c."code" AS "courseCode",
      subj."name" AS "subjectName"
    FROM "Substitution" s
    JOIN "Event" e ON e."id" = s."eventId"
    JOIN "User" original ON original."id" = s."originalTeacherUserId"
    JOIN "User" substitute ON substitute."id" = s."substituteUserId"
    LEFT JOIN "CourseOffering" co ON co."id" = e."courseOfferingId"
    LEFT JOIN "Course" c ON c."id" = co."courseId"
    LEFT JOIN "asignaturas" subj ON subj."id" = e."subjectId"
    WHERE s."date" >= ${dayStart}
      AND s."date" <= ${dayEnd}
      AND (${data.teacherId || null}::text IS NULL OR s."originalTeacherUserId" = ${data.teacherId || null} OR s."substituteUserId" = ${data.teacherId || null})
      AND (${data.groupId || null}::text IS NULL OR c."id" = ${data.groupId || null})
  `
  for (const row of substitutionRows) {
    const teacher = { id: row.substituteId, name: row.substituteName || row.substituteEmail || 'Suplente', email: row.substituteEmail }
    const group = row.courseId ? { id: row.courseId, name: row.courseName || row.courseCode || row.courseId } : null
    teachers.set(teacher.id, teacher)
    if (group) groups.set(group.id, group)
    items.push({
      id: `substitution:${row.id}`,
      time: formatTimeLabel(row.startTime),
      sortTime: timelineSortInstantOnDay(date, row.startTime).toISOString(),
      type: 'SUBSTITUTION',
      status: 'SUBSTITUTED',
      title: `${teacher.name} cubre ${row.subjectName || row.eventTitle}`,
      detail: `Titular: ${row.originalName || row.originalEmail || 'Docente'} · ${row.reason}`,
      teacher,
      group,
      event: { id: row.eventId, title: row.eventTitle },
    })
  }

  const justificationRows = await prisma.$queryRaw<
    {
      id: string
      createdAt: Date
      reason: string
      userId: string
      userName: string | null
      userEmail: string | null
      eventId: string | null
      eventTitle: string | null
      courseId: string | null
      courseName: string | null
      courseCode: string | null
    }[]
  >`
    SELECT
      j."id",
      j."createdAt",
      j."reason",
      a."userId",
      u."name" AS "userName",
      u."email" AS "userEmail",
      e."id" AS "eventId",
      e."title" AS "eventTitle",
      c."id" AS "courseId",
      c."name" AS "courseName",
      c."code" AS "courseCode"
    FROM "AttendanceJustification" j
    JOIN "Attendance" a ON a."id" = j."attendanceId"
    JOIN "User" u ON u."id" = a."userId"
    LEFT JOIN "Event" e ON e."id" = a."eventId"
    LEFT JOIN "CourseOffering" co ON co."id" = e."courseOfferingId"
    LEFT JOIN "Course" c ON c."id" = co."courseId"
    WHERE a."date" >= ${dayStart}
      AND a."date" <= ${dayEnd}
      AND (${data.teacherId || null}::text IS NULL OR a."userId" = ${data.teacherId || null})
      AND (${data.groupId || null}::text IS NULL OR c."id" = ${data.groupId || null})
  `
  for (const row of justificationRows) {
    const teacher = { id: row.userId, name: row.userName || row.userEmail || 'Docente', email: row.userEmail }
    const group = row.courseId ? { id: row.courseId, name: row.courseName || row.courseCode || row.courseId } : null
    teachers.set(teacher.id, teacher)
    if (group) groups.set(group.id, group)
    items.push({
      id: `justification:${row.id}`,
      time: formatTimeLabel(row.createdAt),
      sortTime: new Date(row.createdAt).toISOString(),
      type: 'JUSTIFICATION',
      status: 'JUSTIFIED',
      title: `${teacher.name} tiene justificación registrada`,
      detail: row.reason,
      teacher,
      group,
      event: row.eventId && row.eventTitle ? { id: row.eventId, title: row.eventTitle } : null,
    })
  }

  const summary = {
    expectedTeachers: new Set(filteredPlanned.map((p) => p.userIdRequired).filter(Boolean)).size,
    presentTeachers: new Set(
      resolved
        .filter((r) => r.checkInStatusResolved === 'PRESENT' || r.checkInStatusResolved === 'LATE')
        .map((r) => r.planned.userIdRequired)
        .filter(Boolean),
    ).size,
    lateArrivals: resolved.filter((r) => r.checkInStatusResolved === 'LATE').length,
    pendingAbsences: resolved.filter((r) => r.checkInStatusResolved === 'ABSENT_NOT_JUSTIFIED').length,
    expectedAbsences: resolved.filter((r) => r.checkInStatusResolved === 'SUBSTITUTED').length,
    substitutions: substitutionRows.length,
    suspendedClasses: suspendedEvents.length,
    outOfSchedulePunches: attendanceRows.filter((r) => String(r.status) === 'OUT_OF_SCHEDULE').length,
    unidentifiedPunches: unidentifiedPunches.length,
  }

  let filteredItems = items
  if (data.teacherId) filteredItems = filteredItems.filter((item) => item.teacher?.id === data.teacherId)
  if (data.groupId) filteredItems = filteredItems.filter((item) => item.group?.id === data.groupId)
  if (data.status) filteredItems = filteredItems.filter((item) => item.status === data.status)
  if (data.type) filteredItems = filteredItems.filter((item) => item.type === data.type)

  filteredItems = [...filteredItems]
    .sort((a, b) => new Date(a.sortTime).getTime() - new Date(b.sortTime).getTime())
    .slice(0, 80)

  return {
    date,
    summary,
    items: filteredItems.map(({ sortTime, ...item }) => ({
      ...item,
      statusLabel: timelineStatusLabel(item.status),
    })),
    filters: {
      teachers: [...teachers.values()].sort((a, b) => a.name.localeCompare(b.name)),
      groups: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
      statuses: timelineStatusFilterValues.map((value) => ({ value, label: timelineStatusLabel(value) })),
      types: timelineTypeFilterOptions,
    },
  }
}

type ResolveScope = {
  userId?: string
  userIds?: string[]
  eventType?: ParsedDashboardQuery['eventType']
  schoolYearId?: string
}

async function resolveInstancesForRange(
  from: string,
  to: string,
  scope: ResolveScope,
): Promise<ResolvedAttendanceByInstance[]> {
  const plannedInstances = await getPlannedInstances({
    from,
    to,
    userId: scope.userId,
    userIds: scope.userIds,
    eventType: scope.eventType,
    schoolYearId: scope.schoolYearId,
  })
  return resolveAttendanceAndJustification({ plannedInstances })
}

/** Rango previo de igual longitud, inmediatamente anterior a [from, to]. */
function previousRangeOf(from: string, to: string) {
  const fromD = new Date(`${from}T00:00:00.000Z`)
  const toD = new Date(`${to}T00:00:00.000Z`)
  const days = Math.round((toD.getTime() - fromD.getTime()) / 86_400_000) + 1
  const prevTo = new Date(fromD)
  prevTo.setUTCDate(prevTo.getUTCDate() - 1)
  const prevFrom = new Date(prevTo)
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1))
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { previousFrom: fmt(prevFrom), previousTo: fmt(prevTo) }
}

async function computeAdminAnalyticsBody(data: ParsedDashboardQuery) {
  const { from, to, role, userId, eventType } = data
  const granularity = data.granularity || 'week'
  const compareToPrevious = data.compareToPrevious !== '0' && data.compareToPrevious !== 'false'

  const userIds = await scopeUserIds({ role, userId })
  const schoolYearId = data.allYears
    ? undefined
    : await resolveSchoolYearIdForList(prisma, {
        role: 'ADMIN',
        requestedSchoolYearId: data.schoolYearId,
      })

  const scope: ResolveScope = {
    userId,
    userIds: userIds || undefined,
    eventType,
    schoolYearId: schoolYearId || undefined,
  }

  const resolvedInstances = await resolveInstancesForRange(from, to, scope)
  const kpis = await computeDashboardKpis({ from, to, resolvedInstances })

  // Serie legacy (semanal) para no romper consumidores existentes.
  const seriesRaw = computeSeriesByWeek(resolvedInstances, from, to)
  const series = {
    lateRateByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.lateRate })),
    aopByPeriod: seriesRaw.map((s) => ({ period: s.period, value: s.aop })),
  }
  const seriesMulti = computeSeriesByGranularity(resolvedInstances, from, to, granularity)

  const breakdowns = buildDashboardBreakdowns(resolvedInstances)
  const statusDistribution = computeStatusDistribution(resolvedInstances)

  const topRiskPeople = computeTopRiskPeople(resolvedInstances, { limit: 10 })
  const topRiskEvents = computeTopRiskEvents(resolvedInstances, { limit: 10 })

  let comparison: {
    previousFrom: string
    previousTo: string
    current: typeof kpis
    previous: typeof kpis
    deltas: typeof kpis
  } | null = null
  if (compareToPrevious) {
    const { previousFrom, previousTo } = previousRangeOf(from, to)
    const prevResolved = await resolveInstancesForRange(previousFrom, previousTo, scope)
    const prevKpis = await computeDashboardKpis({ from: previousFrom, to: previousTo, resolvedInstances: prevResolved })
    comparison = {
      previousFrom,
      previousTo,
      current: kpis,
      previous: prevKpis,
      deltas: computeKpiDeltas(kpis, prevKpis),
    }
  }

  return {
    meta: {
      resolvedInstanceCount: resolvedInstances.length,
      rangeFrom: data.from,
      rangeTo: data.to,
      roleFilter: role ?? null,
      eventTypeFilter: eventType ?? null,
      schoolYearId: schoolYearId ?? null,
      allYears: Boolean(data.allYears),
      granularity,
      generatedAt: new Date().toISOString(),
    },
    kpis,
    series,
    seriesMulti,
    breakdowns,
    statusDistribution,
    comparison,
    topLists: { topRiskPeople, topRiskEvents },
  }
}

r.get('/dashboard', authGuard, requirePermission('analytics.read', 'all'), async (req, res) => {
  try {
    const parsed = dashboardQuerySchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const body = await computeAdminAnalyticsBody(parsed.data)

    return res.json(body)
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})

r.get('/attendance-timeline', authGuard, requirePermission('analytics.read', 'all'), async (req, res) => {
  try {
    const parsed = attendanceTimelineQuerySchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const body = await computeAttendanceTimeline(parsed.data)
    return res.json(body)
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})

// Fase 1: endpoints con retorno vacío para mantener contrato en UI (se completan en Fase 2).
r.get('/metrics', authGuard, requirePermission('analytics.read', 'all'), async (req, res) => {
  return res.json({ ok: true, message: 'metrics endpoint (Fase 2: expandir agregaciones)' })
})
r.get('/rankings', authGuard, requirePermission('analytics.read', 'all'), async (req, res) => {
  try {
    const parsed = dashboardQuerySchema.safeParse(req.query)
    if (!parsed.success) return res.status(400).json({ message: 'Parametros inválidos', errors: parsed.error.errors })

    const { topLists } = await computeAdminAnalyticsBody(parsed.data)
    return res.json({ people: topLists.topRiskPeople, events: topLists.topRiskEvents })
  } catch (error: any) {
    return res.status(500).json({ message: 'Error interno del servidor', error: error?.message || String(error) })
  }
})
r.get('/alerts/critical', authGuard, requirePermission('analytics.read', 'all'), async (_req, res) => {
  return res.json({ alerts: [] })
})
r.get('/anomalies', authGuard, requirePermission('analytics.read', 'all'), async (_req, res) => {
  return res.json({ anomalies: [] })
})

export default r
