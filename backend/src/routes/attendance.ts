import { Router, type Request } from 'express';
import { z } from 'zod';
import { DateTime } from 'luxon';
import { prisma } from '../db/prisma.js';
import { authGuard, requirePermission, userPermissionScope } from '../middlewares/auth.js';
import {
  getDuplicateAttendanceMessage,
  getAttendanceStatus,
} from '../attendance/attendance-logic.js';
import { findApprovedLicenseCoveringEventTime } from '../services/medicalLeaveReconciliation.js';
import { attachRoleCode, selectOrgRoleCode } from '../identity/user-role-prisma.js';
import { attachResolvedSchoolYearToAttendanceWhere } from '../attendance/attendance-school-year.js';
import { resolveSchoolYearIdForList } from '../services/school-year-service.js';
import { findNonWorkingDayForDate } from '../services/non-working-days.js';
import { getAttendanceOperationalSettings } from '../config/system-settings.js';
import {
  getAppTimezone,
  isYmdDateString,
  uruguayStartOfDayFromInstant,
  uruguayWallToUtc,
  uruguayYmdEndOfDayToUtc,
} from '../config/app-timezone.js';
import { justifyAttendance } from '../services/attendance-justifications.js';
import { recordAuditEventNow } from '../services/audit-log.js';
import { getPlannedInstances } from '../services/analytics/planInstances.js';
import { resolveAttendanceAndJustification } from '../services/analytics/resolveInstances.js';
import { buildPayrollAttendanceData } from '../services/analytics/exports/payrollAttendanceReport.js';

function mapAttendanceUser<T extends { user?: Parameters<typeof attachRoleCode>[0] }>(row: T) {
  if (!row.user) return row;
  return { ...row, user: attachRoleCode(row.user) };
}

const r = Router();

// Esquemas de validación
const attendanceSchema = z.object({
  type: z.enum(['CHECK_IN', 'CHECK_OUT']),
  date: z.string().datetime(),
  time: z.string().datetime(),
  notes: z.string().optional(),
  eventId: z.string().uuid(), // Ahora es obligatorio
});

const attendanceUpdateSchema = z.object({
  status: z.enum([
    'PRESENT',
    'LATE',
    'ABSENT_NOT_JUSTIFIED',
    'ABSENT_JUSTIFIED',
    'EXIT',
    'EARLY_EXIT',
    'JUSTIFIED',
    'FREE',
    'PENDING_REVIEW',
    'SUBSTITUTED',
    'SUSPENDED',
    'OUT_OF_SCHEDULE',
    'UNIDENTIFIED_PUNCH',
  ]).optional(),
  notes: z.string().optional(),
  reason: z.string().optional(),
});

const attendanceJustificationSchema = z.object({
  type: z.enum(['ABSENCE', 'LATE_ARRIVAL', 'EARLY_EXIT', 'OTHER']).optional(),
  reason: z.string().min(1),
  notes: z.string().optional(),
  attachment: z.string().optional(),
});

const materializeAbsenceSchema = z.object({
  userId: z.string().uuid(),
  eventId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(['ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'SUBSTITUTED']).optional(),
  notes: z.string().optional(),
});

function normalizeAttendanceDate(date: string) {
  return new Date(date)
}

function parseAttendanceRangeStart(value: unknown) {
  const raw = typeof value === 'string' ? value : value != null ? String(value) : ''
  if (isYmdDateString(raw)) return uruguayWallToUtc(raw, 0, 0)
  return new Date(raw)
}

function parseAttendanceRangeEnd(value: unknown) {
  const raw = typeof value === 'string' ? value : value != null ? String(value) : ''
  if (isYmdDateString(raw)) return uruguayYmdEndOfDayToUtc(raw)
  return new Date(raw)
}

function applyDateRangeFilter(where: any, startDate?: unknown, endDate?: unknown) {
  if (!startDate && !endDate) return

  where.date = {}

  if (startDate) {
    where.date.gte = parseAttendanceRangeStart(startDate)
  }

  if (endDate) {
    where.date.lte = parseAttendanceRangeEnd(endDate)
  }
}

function attendanceDayRangeForInstant(value: string | Date) {
  const start = uruguayStartOfDayFromInstant(typeof value === 'string' ? new Date(value) : value)
  const end = new Date(start)
  end.setUTCHours(23, 59, 59, 999)
  return { start, end }
}

function buildAdminAttendanceWhere(query: Record<string, unknown>) {
  const { startDate, endDate, userId, eventId, eventType, type, status, role } = query
  const where: any = {}

  applyDateRangeFilter(where, startDate, endDate)

  if (userId) {
    where.userId = userId
  }

  if (eventId) {
    where.eventId = eventId
  }

  if (eventType) {
    where.event = {
      type: eventType as any,
    }
    where.eventId = {
      ...(where.eventId ? { equals: where.eventId } : {}),
      not: null,
    }
  }

  if (type) {
    where.type = type
  }

  if (status === 'ABSENCES') {
    // Centinela: las tres clases de ausencia en un solo filtro.
    where.status = { in: ['ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'SUBSTITUTED'] }
  } else if (status) {
    where.status = status
  }

  if (role) {
    where.user = {
      orgRole: { code: String(role).toUpperCase() },
    };
  }

  return where
}

function wantsIncidentRows(query: Record<string, unknown>) {
  return query.includeIncidents === '1' || query.includeIncidents === 'true'
}

function buildAdminAttendanceIncidentWhere(query: Record<string, unknown>, attendanceWhere: any) {
  const { startDate, endDate, userId, eventId, eventType, role } = query
  const where: any = {
    type: 'TEACHER_NO_SHOW',
    status: 'OPEN',
  }

  if (startDate || endDate) {
    where.detectedAt = {}
    if (startDate) where.detectedAt.gte = new Date(startDate as string)
    if (endDate) where.detectedAt.lte = new Date(endDate as string)
  }

  if (userId) where.userId = userId
  if (eventId) where.eventId = eventId

  if (eventType || attendanceWhere.event) {
    where.event = {
      ...(attendanceWhere.event && typeof attendanceWhere.event === 'object' ? attendanceWhere.event : {}),
      ...(eventType ? { type: eventType as any } : {}),
    }
    where.eventId = {
      ...(where.eventId ? { equals: where.eventId } : {}),
      not: null,
    }
  }

  if (role) {
    where.user = {
      orgRole: { code: String(role).toUpperCase() },
    }
  }

  return where
}

function mapAttendanceIncidentAsFeedRow(row: any) {
  const when = row.detectedAt ?? row.createdAt
  return {
    id: `incident:${row.id}`,
    kind: 'INCIDENT',
    incidentId: row.id,
    incidentType: row.type,
    incidentStatus: row.status,
    severity: row.severity,
    title: row.title,
    description: row.description,
    type: 'INCIDENT',
    status: 'ABSENT_NOT_JUSTIFIED',
    date: when,
    time: when,
    notes: row.description ?? null,
    user: row.user ? attachRoleCode(row.user) : row.user,
    event: row.event,
  }
}

function shouldCountIncidentAbsencesInStats(query: Record<string, unknown>) {
  if (!wantsIncidentRows(query)) return false
  if (query.type && query.type !== 'CHECK_IN') return false
  if (query.status && query.status !== 'ABSENT_NOT_JUSTIFIED' && query.status !== 'ABSENCES') return false
  return true
}

const ABSENCE_RESOLVED_STATUSES = ['ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'SUBSTITUTED'] as const

function queryDateToUruguayYmd(value: unknown, fallback: Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value ? new Date(String(value)) : fallback
  const safeDate = Number.isNaN(date.getTime()) ? fallback : date
  return DateTime.fromJSDate(safeDate, { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

function feedItemYmd(value: Date | string): string {
  return DateTime.fromJSDate(new Date(value), { zone: 'utc' }).setZone(getAppTimezone()).toFormat('yyyy-MM-dd')
}

type AttendanceFeedItem = { time: number; rows: any[] }

/**
 * Agrupa las marcas en items de feed: la entrada y la salida de un mismo
 * usuario/evento/dia forman UN item, para que la paginacion nunca separe el par
 * (la causa de que se vea "salida sin entrada" al cortar entre paginas).
 * Incidencias y ausencias virtuales son items de una sola fila.
 */
function buildAttendanceFeedItems(rows: any[]): AttendanceFeedItem[] {
  const groups = new Map<string, AttendanceFeedItem>()
  for (const row of rows) {
    const key = `${row.user?.id ?? 'sin-usuario'}|${row.event?.id ?? 'sin-evento'}|${feedItemYmd(row.date)}`
    const time = new Date(row.time ?? row.date).getTime()
    const group = groups.get(key)
    if (group) {
      group.rows.push(row)
      if (time > group.time) group.time = time
    } else {
      groups.set(key, { time, rows: [row] })
    }
  }
  return [...groups.values()]
}

function queryAllowsVirtualAbsenceRows(query: Record<string, unknown>) {
  if (!wantsIncidentRows(query)) return false
  if (query.type && query.type !== 'CHECK_IN') return false
  if (query.status && query.status !== 'ABSENCES' && !ABSENCE_RESOLVED_STATUSES.includes(query.status as any)) return false
  return true
}

async function userIdsForRole(role: unknown) {
  if (!role) return undefined
  const rows = await prisma.user.findMany({
    where: { orgRole: { code: String(role).toUpperCase() } },
    select: { id: true },
  })
  return rows.map((row) => row.id)
}

function mapResolvedAbsenceAsFeedRow(row: Awaited<ReturnType<typeof resolveAttendanceAndJustification>>[number]) {
  const plannedStart = row.planned.plannedStartTime ?? new Date(`${row.planned.plannedDate}T00:00:00.000Z`)
  const plannedEnd = row.planned.plannedEndTime ?? plannedStart
  const status = row.checkInStatusResolved
  return {
    id: `absence:${row.planned.plannedInstanceId}`,
    kind: 'VIRTUAL_ABSENCE',
    type: 'CHECK_IN',
    status,
    date: new Date(`${row.planned.plannedDate}T00:00:00.000Z`),
    time: plannedStart,
    notes:
      status === 'ABSENT_JUSTIFIED'
        ? 'Ausencia justificada por licencia médica para este evento vencido'
        : 'Ausencia pendiente: no se registró asistencia para este evento vencido',
    user: {
      id: row.planned.userIdRequired,
      name: row.userDisplayName,
      email: row.userEmail,
      role: row.userRole,
    },
    event: {
      id: row.planned.eventId,
      title: row.planned.eventTitle,
      type: row.planned.eventType,
      startTime: plannedStart,
      endTime: plannedEnd,
    },
  }
}

async function buildVirtualAbsenceRows(query: Record<string, unknown>, attendanceWhere: any) {
  if (!queryAllowsVirtualAbsenceRows(query)) return []

  const now = new Date()
  const to = queryDateToUruguayYmd(query.endDate, now)
  // Sin startDate explícito, derivamos desde el inicio del año del `to` (no solo "hoy"),
  // para que las ausencias virtuales de días pasados también aparezcan en el panel.
  const from =
    typeof query.startDate === 'string' && query.startDate
      ? queryDateToUruguayYmd(query.startDate, now)
      : `${to.slice(0, 4)}-01-01`
  const schoolYearId = typeof attendanceWhere.schoolYearId === 'string' ? attendanceWhere.schoolYearId : undefined
  const userIds = query.userId ? undefined : await userIdsForRole(query.role)
  const plannedInstances = await getPlannedInstances({
    from,
    to,
    userId: typeof query.userId === 'string' ? query.userId : undefined,
    userIds,
    eventType: typeof query.eventType === 'string' ? (query.eventType as any) : undefined,
    schoolYearId,
  })

  const filteredPlannedInstances = plannedInstances.filter((planned) => {
    if (typeof query.eventId === 'string' && planned.eventId !== query.eventId) return false
    if (!planned.userIdRequired) return false
    if (!planned.plannedEndTime) return false
    return new Date(planned.plannedEndTime).getTime() <= now.getTime()
  })

  const resolved = await resolveAttendanceAndJustification({ plannedInstances: filteredPlannedInstances })
  return resolved
    .filter((row) => {
      // Si la instancia ya tiene una marca registrada, la trae la consulta de Attendance:
      // no emitir una ausencia virtual para no duplicarla en el feed.
      if (row.hasCheckIn) return false
      if (!ABSENCE_RESOLVED_STATUSES.includes(row.checkInStatusResolved as any)) return false
      if (query.status && query.status !== 'ABSENCES' && row.checkInStatusResolved !== query.status) return false
      return true
    })
    .map(mapResolvedAbsenceAsFeedRow)
}

// Registrar asistencia (CHECK_IN o CHECK_OUT) — alta de un registro propio.
r.post('/register', authGuard, requirePermission('attendance.create'), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const parsed = attendanceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const { type, date, time, notes, eventId } = parsed.data;

    // Obtener el evento para calcular el status
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        startDate: true,
        startTime: true,
        endTime: true,
        type: true,
        status: true,
        assignedUserId: true,
        schoolYearId: true,
      },
    });

    if (!event) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    if (event.type !== 'CLASE' || !event.startTime || !event.endTime || event.status === 'CANCELLED') {
      return res.status(400).json({ message: 'No se puede generar asistencia para un horario inexistente o suspendido' });
    }

    const attendanceDateForSubstitution = uruguayStartOfDayFromInstant(new Date(date))
    const substitutionRows = await prisma.$queryRaw<{ id: string; startTime: Date; endTime: Date }[]>`
      SELECT "id", "startTime", "endTime"
      FROM "Substitution"
      WHERE "eventId" = ${eventId}
        AND "substituteUserId" = ${user.sub}
        AND "date" = ${attendanceDateForSubstitution}
      LIMIT 1
    `;

    // Verificar que el usuario esté asignado al evento o sea suplente oficial
    if (event.assignedUserId !== user.sub && substitutionRows.length === 0) {
      return res.status(403).json({ message: 'No estás asignado a este evento' });
    }
    const substitutionSchedule = event.assignedUserId !== user.sub ? substitutionRows[0] : null

    // Un mismo usuario no debe tener más de una entrada/salida para el mismo evento
    // en el mismo día civil. La hora exacta puede variar entre UI, biométrico y API.
    const duplicateDay = attendanceDayRangeForInstant(date)
    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        userId: user.sub,
        type,
        date: { gte: duplicateDay.start, lte: duplicateDay.end },
        eventId: eventId,
      },
    });

    if (existingAttendance) {
      return res.status(409).json({ message: getDuplicateAttendanceMessage(type) });
    }

    const evStart = substitutionSchedule?.startTime ?? (event.startTime ? new Date(event.startTime) : new Date(event.startDate))
    const evEnd = substitutionSchedule?.endTime ?? (event.endTime ? new Date(event.endTime) : evStart)
    const nonWorkingDay = await findNonWorkingDayForDate(evStart)
    if (nonWorkingDay) {
      return res.status(403).json({
        message: `No se puede registrar asistencia: ${nonWorkingDay.reason}`,
        code: 'ATTENDANCE_BLOCKED_BY_NON_WORKING_DAY',
        nonWorkingDayId: nonWorkingDay.id,
      })
    }

    const blockingLicense = await findApprovedLicenseCoveringEventTime(user.sub, evStart, evEnd)
    if (blockingLicense) {
      return res.status(403).json({
        message:
          'No se puede registrar asistencia presencial en este evento: el horario está cubierto por una licencia activa. La inasistencia debe figurar como justificada (reconciliación automática).',
        code: 'ATTENDANCE_BLOCKED_BY_LICENSE',
        licenseId: blockingLicense.id,
      })
    }

    const actualTime = new Date(time);
    const runtimeSettings = await getAttendanceOperationalSettings();
    const status = getAttendanceStatus({
      type,
      actualTime,
      startTime: evStart,
      endTime: evEnd,
      hasApprovedLicense: false,
      lateToleranceMinutes:
        type === 'CHECK_OUT' ? runtimeSettings.earlyExitToleranceMinutes : runtimeSettings.lateToleranceMinutes,
    });

    const attendance = await prisma.attendance.create({
      data: {
        userId: user.sub,
        type,
        date: new Date(date),
        time: actualTime,
        notes,
        eventId,
        schoolYearId: event.schoolYearId,
        status: status as any,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        event: {
          select: { id: true, title: true, type: true, startTime: true, endTime: true }
        }
      }
    });

    res.json(mapAttendanceUser(attendance as any));
  } catch (error) {
    console.error('Error registrando asistencia:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Obtener asistencias del usuario actual
r.get('/my-attendances', authGuard, requirePermission('attendance.read'), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const { startDate, endDate, type, status, includeAbsences } = req.query;

    const where: any = {
      userId: user.sub,
    };

    applyDateRangeFilter(where, startDate, endDate)

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    const attendances = await prisma.attendance.findMany({
      where,
      include: {
        event: {
          select: { id: true, title: true, type: true, startTime: true, endTime: true }
        }
      },
      orderBy: { date: 'desc' },
    });

    const wantsAbsences = includeAbsences === '1' || includeAbsences === 'true'
    if (!wantsAbsences || (type && type !== 'CHECK_IN')) {
      return res.json(attendances);
    }

    // Faltas derivadas del propio usuario (mismas que ve el admin en /all), sin duplicar marcas reales.
    const virtualQuery: Record<string, unknown> = {
      includeIncidents: 'true',
      userId: user.sub,
      type: 'CHECK_IN',
    }
    if (startDate) virtualQuery.startDate = startDate
    if (endDate) virtualQuery.endDate = endDate
    if (status) virtualQuery.status = status
    const virtualAbsences = await buildVirtualAbsenceRows(virtualQuery, {})

    const realKeys = new Set(
      attendances
        .filter((a) => a.type === 'CHECK_IN' && a.eventId)
        .map((a) => `${a.eventId}:${new Date(a.date).toISOString().slice(0, 10)}`),
    )
    const dedupedAbsences = virtualAbsences.filter((row: any) => {
      const ymd = new Date(row.date).toISOString().slice(0, 10)
      return !realKeys.has(`${row.event?.id}:${ymd}`)
    })

    const merged = [...attendances, ...dedupedAbsences].sort(
      (a: any, b: any) => new Date(b.time ?? b.date).getTime() - new Date(a.time ?? a.date).getTime(),
    )
    res.json(merged);
  } catch (error) {
    console.error('Error obteniendo asistencias:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Obtener todas las asistencias (solo ADMIN)
r.get('/all', authGuard, requirePermission('attendance.read', 'all'), async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);
    const q = req.query as Record<string, unknown>;
    const where = buildAdminAttendanceWhere(q)
    await attachResolvedSchoolYearToAttendanceWhere(prisma, where, q, req.user?.role ?? 'ADMIN')

    if (wantsIncidentRows(q)) {
      const incidentWhere = buildAdminAttendanceIncidentWhere(q, where)
      const [attendanceRows, incidentRows, virtualAbsenceRows] = await Promise.all([
        prisma.attendance.findMany({
          where,
          include: {
            user: {
              select: { id: true, name: true, email: true, ...selectOrgRoleCode }
            },
            event: {
              select: { id: true, title: true, type: true, startTime: true, endTime: true }
            }
          },
          orderBy: [{ date: 'desc' }, { time: 'asc' }],
        }),
        prisma.attendanceIncident.findMany({
          where: incidentWhere,
          include: {
            user: {
              select: { id: true, name: true, email: true, ...selectOrgRoleCode }
            },
            event: {
              select: { id: true, title: true, type: true, startTime: true, endTime: true }
            },
          },
          orderBy: { detectedAt: 'desc' },
        }),
        buildVirtualAbsenceRows(q, where),
      ]);

      // Paginar por ITEMS (un par entrada+salida = 1 item) para no cortar pares
      // entre paginas. total = cantidad de items mostrados, no de filas crudas.
      const attendanceItems = buildAttendanceFeedItems(attendanceRows.map(mapAttendanceUser))
      const otherItems: AttendanceFeedItem[] = [
        ...incidentRows.map(mapAttendanceIncidentAsFeedRow),
        ...virtualAbsenceRows,
      ].map((row: any) => ({ time: new Date(row.time ?? row.date).getTime(), rows: [row] }))

      const items = [...attendanceItems, ...otherItems].sort((a, b) => b.time - a.time)
      const data = items
        .slice((page - 1) * pageSize, page * pageSize)
        .flatMap((item) =>
          [...item.rows].sort((a, b) => new Date(a.time ?? a.date).getTime() - new Date(b.time ?? b.date).getTime()),
        )

      return res.json({ total: items.length, page, pageSize, data });
    }

    const [total, attendances] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, ...selectOrgRoleCode }
          },
          event: {
            select: { id: true, title: true, type: true, startTime: true, endTime: true }
          }
        },
        orderBy: { date: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({ total, page, pageSize, data: attendances });
  } catch (error) {
    console.error('Error obteniendo todas las asistencias:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
})

class AttendanceActionError extends Error {
  constructor(message: string, public statusCode = 400) {
    super(message);
  }
}

/**
 * Crea (o reutiliza si ya existe) una marca de ausencia para una persona en un evento+fecha.
 * Idempotente: si ya hay un CHECK_IN ese día para ese evento, devuelve el existente sin tocarlo.
 * Reutilizado por POST /materialize-absence y POST /justify-range.
 */
async function materializeAbsenceRecord(
  params: z.infer<typeof materializeAbsenceSchema>,
  actor: { actorUserId: string | null; req?: Request },
): Promise<{ attendance: any; created: boolean }> {
  const { userId, eventId, date, status = 'ABSENT_NOT_JUSTIFIED', notes } = params;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      type: true,
      startTime: true,
      endTime: true,
      assignedUserId: true,
      schoolYearId: true,
    },
  });

  if (!event) throw new AttendanceActionError('Evento no encontrado', 404);
  if (event.assignedUserId !== userId) {
    throw new AttendanceActionError('La persona no está asignada a este evento', 400);
  }

  const attendanceDate = uruguayWallToUtc(date, 0, 0);
  // En eventos recurrentes "startTime" arrastra la fecha de la primera ocurrencia de la
  // serie: la marca debe llevar el día de ESTA ocurrencia con la hora planificada.
  const plannedClock = event.startTime
    ? DateTime.fromJSDate(new Date(event.startTime), { zone: 'utc' }).setZone(getAppTimezone())
    : null;
  const absenceTime = plannedClock
    ? uruguayWallToUtc(date, plannedClock.hour, plannedClock.minute)
    : attendanceDate;
  const includeUserEvent = {
    user: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } },
    event: { select: { id: true, title: true, type: true, startTime: true, endTime: true } },
  };
  const existing = await prisma.attendance.findFirst({
    where: { userId, eventId, date: attendanceDate, type: 'CHECK_IN' },
    include: includeUserEvent,
  });

  if (existing) {
    return { attendance: existing, created: false };
  }

  const attendance = await prisma.attendance.create({
    data: {
      userId,
      eventId,
      type: 'CHECK_IN',
      status: status as any,
      date: attendanceDate,
      time: absenceTime,
      schoolYearId: event.schoolYearId,
      notes: notes?.trim() || 'Ausencia registrada manualmente desde gestión de asistencias',
    },
    include: includeUserEvent,
  });

  await recordAuditEventNow({
    action: 'ATTENDANCE_MANUAL_UPDATED' as any,
    actorUserId: actor.actorUserId,
    req: actor.req,
    entityType: 'Attendance',
    entityId: attendance.id,
    metadata: {
      reason: 'Materialización manual de ausencia virtual',
      previousStatus: null,
      newStatus: attendance.status,
      eventId,
      userId,
    },
  });

  return { attendance, created: true };
}

r.post('/materialize-absence', authGuard, requirePermission('attendance.update', 'all'), async (req, res) => {
  try {
    const parsed = materializeAbsenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const { attendance, created } = await materializeAbsenceRecord(parsed.data, {
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
    });

    return res.status(created ? 201 : 200).json(mapAttendanceUser(attendance as any));
  } catch (error) {
    if (error instanceof AttendanceActionError) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    console.error('Error materializando ausencia:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

const justifyRangeSchema = z.object({
  userId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.enum(['ABSENCE', 'LATE_ARRIVAL', 'EARLY_EXIT', 'OTHER']).optional(),
  reason: z.string().min(1),
  notes: z.string().optional(),
  includeLate: z.boolean().optional(),
});

// Justifica de una sola vez todas las faltas (y opcionalmente tardanzas) de una persona en un rango.
r.post('/justify-range', authGuard, requirePermission('attendance.update', 'all'), async (req, res) => {
  try {
    const parsed = justifyRangeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const { userId, from, to, type, reason, notes, includeLate } = parsed.data;
    const actorUserId = req.user?.id ?? req.user?.sub ?? null;
    const now = new Date();

    const plannedInstances = await getPlannedInstances({ from, to, userId });
    const due = plannedInstances.filter(
      (planned) =>
        planned.userIdRequired === userId &&
        planned.plannedEndTime &&
        new Date(planned.plannedEndTime).getTime() <= now.getTime(),
    );
    const resolved = await resolveAttendanceAndJustification({ plannedInstances: due });

    const targetStatuses = includeLate ? ['ABSENT_NOT_JUSTIFIED', 'LATE'] : ['ABSENT_NOT_JUSTIFIED'];
    const targets = resolved.filter((row) => targetStatuses.includes(row.checkInStatusResolved as any));

    let justified = 0;
    let created = 0;
    let skipped = 0;
    for (const row of targets) {
      try {
        const { attendance, created: wasCreated } = await materializeAbsenceRecord(
          { userId, eventId: row.planned.eventId, date: row.planned.plannedDate, status: 'ABSENT_NOT_JUSTIFIED', notes },
          { actorUserId, req },
        );
        if (wasCreated) created += 1;
        if (attendance.status === 'ABSENT_NOT_JUSTIFIED' || attendance.status === 'LATE') {
          await justifyAttendance({ attendanceId: attendance.id, type, reason, notes, actorUserId, req });
          justified += 1;
        } else {
          skipped += 1;
        }
      } catch {
        skipped += 1;
      }
    }

    res.json({ total: targets.length, justified, created, skipped });
  } catch (error) {
    console.error('Error justificando rango de asistencias:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

function summaryRangeFromQuery(q: Record<string, unknown>) {
  const now = new Date();
  const to = queryDateToUruguayYmd(q.to ?? q.endDate, now);
  const rawFrom = q.from ?? q.startDate;
  const from =
    typeof rawFrom === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(rawFrom)
      ? rawFrom
      : `${to.slice(0, 4)}-01-01`;
  return { from, to };
}

// Resumen de asistencia por persona (KPIs + filas por instancia). Reusa el motor del export de nómina.
r.get('/summary', authGuard, requirePermission('attendance.read'), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const q = req.query as Record<string, unknown>;
    const { from, to } = summaryRangeFromQuery(q);

    const scope = await userPermissionScope(user.sub, 'attendance.read', user.role);
    const requestedUserId = typeof q.userId === 'string' && q.userId ? q.userId : undefined;

    let effectiveUserId: string | undefined;
    if (scope === 'all') {
      effectiveUserId = requestedUserId;
    } else {
      if (requestedUserId && requestedUserId !== user.sub) {
        return res.status(403).json({ message: 'No autorizado para ver el resumen de otra persona' });
      }
      effectiveUserId = user.sub;
    }

    const data = await buildPayrollAttendanceData({
      from,
      to,
      filters: {
        userId: effectiveUserId,
        eventType: typeof q.eventType === 'string' ? (q.eventType as any) : undefined,
        schoolYearId: typeof q.schoolYearId === 'string' ? q.schoolYearId : undefined,
        allYears: q.allYears === 'true' || q.allYears === '1',
      },
    });

    if (effectiveUserId) {
      const person = data.persons.find((p) => p.userId === effectiveUserId) ?? null;
      return res.json({ from, to, person });
    }

    res.json({ from, to, persons: data.persons, total: data.total });
  } catch (error) {
    console.error('Error generando resumen de asistencia:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Actualizar asistencia (solo ADMIN)
r.put('/:id', authGuard, requirePermission('attendance.update', 'all'), async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = attendanceUpdateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const previous = await prisma.attendance.findUnique({
      where: { id },
      select: { id: true, status: true, notes: true },
    });
    if (!previous) {
      return res.status(404).json({ message: 'Registro de asistencia no encontrado' });
    }

    const { reason, ...updateData } = parsed.data;
    const attendance = await prisma.attendance.update({
      where: { id },
      data: updateData as any,
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        event: {
          select: { id: true, title: true, type: true }
        }
      }
    });

    await recordAuditEventNow({
      action: 'ATTENDANCE_MANUAL_UPDATED' as any,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
      entityType: 'Attendance',
      entityId: id,
      metadata: {
        reason: reason?.trim() || 'Actualización manual de asistencia',
        previousStatus: previous.status,
        newStatus: attendance.status,
        previousNotes: previous.notes,
        newNotes: attendance.notes,
      },
    });

    res.json(mapAttendanceUser(attendance as any));
  } catch (error) {
    console.error('Error actualizando asistencia:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

r.post('/:id/justify', authGuard, requirePermission('attendance.update', 'all'), async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = attendanceJustificationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const attendance = await justifyAttendance({
      attendanceId: id,
      reason: parsed.data.reason,
      type: parsed.data.type,
      notes: parsed.data.notes,
      attachment: parsed.data.attachment,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
    });

    res.json({ attendance: mapAttendanceUser(attendance as any), message: 'Justificación registrada correctamente' });
  } catch (error: any) {
    console.error('Error justificando asistencia:', error);
    res.status(error?.statusCode || 500).json({ message: error?.message || 'Error interno del servidor' });
  }
});

// Eliminar todas las asistencias (solo ADMIN)
r.delete('/purge-all', authGuard, requirePermission('attendance.delete', 'all'), async (_req, res) => {
  try {
    const q = _req.query as Record<string, unknown>
    const where = buildAdminAttendanceWhere(q)
    await attachResolvedSchoolYearToAttendanceWhere(prisma, where, q, _req.user?.role ?? 'ADMIN')
    const matches = await prisma.attendance.findMany({
      where,
      select: { id: true },
    })

    if (matches.length === 0) {
      return res.json({ ok: true, deletedCount: 0, message: 'No había asistencias para eliminar' })
    }

    const deleted = await prisma.attendance.deleteMany({
      where: {
        id: {
          in: matches.map((attendance) => attendance.id),
        },
      },
    })

    res.json({
      ok: true,
      deletedCount: deleted.count,
      message: 'Las asistencias seleccionadas fueron eliminadas',
    })
  } catch (error) {
    console.error('Error eliminando todas las asistencias:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
});

// Eliminar asistencia (solo ADMIN)
r.delete('/:id', authGuard, requirePermission('attendance.delete', 'all'), async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.attendance.delete({
      where: { id },
    });

    res.json({ message: 'Asistencia eliminada correctamente' });
  } catch (error) {
    console.error('Error eliminando asistencia:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

async function buildAttendanceStatsWhereAsync(query: Record<string, unknown>, user: { role: string; sub: string }) {
  const where = buildAdminAttendanceWhere(query)
  await attachResolvedSchoolYearToAttendanceWhere(prisma, where, query, user.role)
  const scope = await userPermissionScope(user.sub, 'attendance.read', user.role)
  if (scope !== 'all') {
    where.userId = user.sub
  }
  /** Tasas de presencia/ausencia/tarde solo aplican a entradas; las salidas (EXIT) no deben inflar el total. */
  if (!query.type) {
    where.type = 'CHECK_IN'
  }
  return where
}

function rate(part: number, total: number) {
  return total > 0 ? Math.round((part / total) * 10000) / 100 : 0
}

// Obtener estadísticas de asistencias
r.get('/stats', authGuard, requirePermission('attendance.read'), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const where = await buildAttendanceStatsWhereAsync(req.query as Record<string, unknown>, user)

    const q = req.query as Record<string, unknown>
    const includeIncidentAbsences = shouldCountIncidentAbsencesInStats(q)
    const incidentWhere = includeIncidentAbsences
      ? buildAdminAttendanceIncidentWhere(q, where)
      : null

    const [
      attendanceTotal,
      presentCount,
      attendanceAbsentCount,
      lateCount,
      medicalLeaveCount,
      expectedAbsenceCount,
      exitCount,
      earlyExitCount,
      incidentAbsentCount,
      virtualAbsenceRows,
    ] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.count({ where: { ...where, status: 'PRESENT' } }),
      prisma.attendance.count({
        where: {
          ...where,
          status: { in: ['ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'SUBSTITUTED'] },
        },
      }),
      prisma.attendance.count({ where: { ...where, status: 'LATE' } }),
      prisma.attendance.count({ where: { ...where, status: 'ABSENT_JUSTIFIED' } }),
      prisma.attendance.count({
        where: {
          ...where,
          OR: [
            { status: 'SUBSTITUTED' as any },
            { status: 'ABSENT_NOT_JUSTIFIED' as any, notes: { startsWith: 'Ausencia prevista' } },
            { status: 'ABSENT_NOT_JUSTIFIED' as any, notes: { startsWith: 'Ausencia esperada' } },
          ],
        },
      }),
      prisma.attendance.count({ where: { ...where, status: 'EXIT' } }),
      prisma.attendance.count({ where: { ...where, status: 'EARLY_EXIT' } }),
      incidentWhere ? prisma.attendanceIncident.count({ where: incidentWhere }) : Promise.resolve(0),
      buildVirtualAbsenceRows(q, where),
    ])

    const virtualAbsentCount = virtualAbsenceRows.length
    const virtualMedicalLeaveCount = virtualAbsenceRows.filter((row: any) => row.status === 'ABSENT_JUSTIFIED').length
    const totalAttendances = attendanceTotal + incidentAbsentCount + virtualAbsentCount
    const absentCount = attendanceAbsentCount + incidentAbsentCount + virtualAbsentCount

    res.json({
      totalAttendances,
      presentCount,
      absentCount,
      lateCount,
      medicalLeaveCount: medicalLeaveCount + virtualMedicalLeaveCount,
      expectedAbsenceCount,
      exitCount,
      earlyExitCount,
      attendanceRate: rate(presentCount, totalAttendances),
      lateRate: rate(lateCount, totalAttendances),
      absenceRate: rate(absentCount, totalAttendances),
      exitRate: rate(exitCount, totalAttendances),
      earlyExitRate: rate(earlyExitCount, totalAttendances),
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});


// Agregar nota a asistencia existente (para retrasos o salidas anticipadas)
r.post('/:id/note', authGuard, requirePermission('attendance.update', 'all'), async (req, res) => {
  try {
    const { id } = req.params;
    const { note, markLate, markEarlyExit } = req.body;
    
    if (!note || note.trim().length === 0) {
      return res.status(400).json({ message: 'La nota no puede estar vacía' });
    }

    const existingAttendance = await prisma.attendance.findUnique({ where: { id } });
    if (!existingAttendance) {
      return res.status(404).json({ message: 'Registro de asistencia no encontrado' });
    }

    let updateData: any = {
      notes: note.trim()
    };

    // Si se marca como tardía y es entrada
    if (markLate && existingAttendance.type === 'CHECK_IN') {
      updateData.status = 'LATE';
    }

    // Si se marca como salida anticipada y es salida
    if (markEarlyExit && existingAttendance.type === 'CHECK_OUT') {
      updateData.status = 'EARLY_EXIT';
    }

    const updatedAttendance = await prisma.attendance.update({
      where: { id },
      data: updateData as any,
      include: {
        user: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } }
      }
    });

    await recordAuditEventNow({
      action: 'ATTENDANCE_MANUAL_UPDATED' as any,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
      entityType: 'Attendance',
      entityId: id,
      metadata: {
        reason: 'Nota administrativa',
        previousStatus: existingAttendance.status,
        newStatus: updatedAttendance.status,
        previousNotes: existingAttendance.notes,
        newNotes: updatedAttendance.notes,
      },
    });

    res.json({
      attendance: mapAttendanceUser(updatedAttendance as any),
      message: 'Nota agregada correctamente'
    });
  } catch (error) {
    console.error('Error agregando nota:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Marcar ausencias automáticamente basadas en eventos y licencias médicas (solo admin)
r.post('/mark-absences', authGuard, requirePermission('attendance.update', 'all'), async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      userId,
      eventId,
      expectedAbsence,
      schoolYearId: bodySchoolYearId,
      allYears: bodyAllYears,
    } = req.body ?? {};

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate y endDate son requeridos' });
    }

    const start = parseAttendanceRangeStart(startDate);
    const end = parseAttendanceRangeEnd(endDate);

    const allYears = bodyAllYears === true || bodyAllYears === '1';
    const resolvedSchoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          role: 'ADMIN',
          requestedSchoolYearId: typeof bodySchoolYearId === 'string' ? bodySchoolYearId : undefined,
        });

    // Obtener todos los eventos en el rango de fechas
    const events = await prisma.event.findMany({
      where: {
        type: 'CLASE',
        ...(eventId ? { id: eventId } : {}),
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        assignedUserId: userId ? userId : { not: null },
        startTime: { not: null },
        endTime: { not: null },
        startDate: {
          gte: start,
          lte: end
        },
        ...(resolvedSchoolYearId && { schoolYearId: resolvedSchoolYearId }),
      },
      include: {
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        }
      }
    });

    let markedAbsences = 0;

    for (const event of events) {
      if (!event.assignedUserId || !event.startTime || !event.endTime) {
        continue;
      }

      const eventDate = uruguayStartOfDayFromInstant(new Date(event.startTime || event.startDate));

      const nonWorkingDay = await findNonWorkingDayForDate(new Date(event.startTime || event.startDate));
      if (nonWorkingDay) {
        continue;
      }

      const substitution = await prisma.$queryRaw<{ id: string }[]>`
        SELECT "id"
        FROM "Substitution"
        WHERE "eventId" = ${event.id}
          AND "originalTeacherUserId" = ${event.assignedUserId}
          AND "date" = ${eventDate}
        LIMIT 1
      `;

      if (substitution.length > 0) {
        const existingSubstitutedAttendance = await prisma.attendance.findFirst({
          where: {
            userId: event.assignedUserId,
            eventId: event.id,
            date: eventDate,
            type: 'CHECK_IN',
          },
          select: { id: true },
        });
        if (!existingSubstitutedAttendance) {
          await prisma.attendance.create({
            data: {
              userId: event.assignedUserId,
              type: 'CHECK_IN',
              status: 'SUBSTITUTED' as any,
              date: eventDate,
              time: new Date(event.startTime),
              notes: 'Ausencia prevista sin justificar (suplida): clase cubierta oficialmente',
              eventId: event.id,
              schoolYearId: event.schoolYearId,
            },
          });
          markedAbsences++;
        }
        continue;
      }

      // Verificar si ya existe una asistencia para este evento en esta fecha
      const existingAttendance = await prisma.attendance.findFirst({
        where: {
          userId: event.assignedUserId,
          eventId: event.id,
          date: eventDate
        }
      });

      if (existingAttendance) {
        continue; // Ya existe asistencia, no marcar ausencia
      }

      // Verificar si el usuario tiene una licencia médica activa en esta fecha
      const approvedLicense = await findApprovedLicenseCoveringEventTime(
        event.assignedUserId,
        new Date(event.startTime),
        new Date(event.endTime),
      );

      // Determinar el status basado en si tiene licencia médica
      const status = approvedLicense ? 'ABSENT_JUSTIFIED' : 'ABSENT_NOT_JUSTIFIED';
      const isExpectedAbsence = Boolean(expectedAbsence) && !approvedLicense;

      // Crear la ausencia
      await prisma.attendance.create({
        data: {
          userId: event.assignedUserId,
          type: 'CHECK_IN',
          status: status as any,
          date: eventDate,
          time: new Date(event.startTime || eventDate),
          notes: approvedLicense
            ? `Ausencia automática - Licencia médica: ${approvedLicense.reason}`
            : isExpectedAbsence
              ? 'Ausencia prevista sin justificar - Registrada por administración antes del bloque'
              : 'Ausencia automática - Sin asistencia registrada',
          eventId: event.id,
          schoolYearId: event.schoolYearId,
        }
      });

      markedAbsences++;
    }

    res.json({
      message: expectedAbsence
        ? `Se registraron ${markedAbsences} ausencias previstas`
        : `Se marcaron ${markedAbsences} ausencias automáticamente`,
      markedAbsences,
      totalEvents: events.length
    });
  } catch (error) {
    console.error('Error marcando ausencias automáticamente:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

export default r;
