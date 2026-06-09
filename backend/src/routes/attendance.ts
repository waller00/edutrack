import { Router } from 'express';
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
  APP_TIMEZONE,
  isYmdDateString,
  uruguayStartOfDayFromInstant,
  uruguayWallToUtc,
  uruguayYmdEndOfDayToUtc,
} from '../config/app-timezone.js';
import { justifyAttendance } from '../services/attendance-justifications.js';
import { recordAuditEventNow } from '../services/audit-log.js';
import { getPlannedInstances } from '../services/analytics/planInstances.js';
import { resolveAttendanceAndJustification } from '../services/analytics/resolveInstances.js';

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

  if (status) {
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
  if (query.status && query.status !== 'ABSENT_NOT_JUSTIFIED') return false
  return true
}

const ABSENCE_RESOLVED_STATUSES = ['ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'SUBSTITUTED'] as const

function queryDateToUruguayYmd(value: unknown, fallback: Date) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = value ? new Date(String(value)) : fallback
  const safeDate = Number.isNaN(date.getTime()) ? fallback : date
  return DateTime.fromJSDate(safeDate, { zone: 'utc' }).setZone(APP_TIMEZONE).toFormat('yyyy-MM-dd')
}

function queryAllowsVirtualAbsenceRows(query: Record<string, unknown>) {
  if (!wantsIncidentRows(query)) return false
  if (query.type && query.type !== 'CHECK_IN') return false
  if (query.status && !ABSENCE_RESOLVED_STATUSES.includes(query.status as any)) return false
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
  const from = queryDateToUruguayYmd(query.startDate, now)
  const to = queryDateToUruguayYmd(query.endDate, now)
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
      if (!ABSENCE_RESOLVED_STATUSES.includes(row.checkInStatusResolved as any)) return false
      if (query.status && row.checkInStatusResolved !== query.status) return false
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
    const substitutionRows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT "id"
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

    // Verificar si ya existe una asistencia del mismo tipo en la misma fecha
    const existingAttendance = await prisma.attendance.findFirst({
      where: {
        userId: user.sub,
        type,
        date: new Date(date),
        eventId: eventId,
      },
    });

    if (existingAttendance) {
      return res.status(409).json({ message: getDuplicateAttendanceMessage(type) });
    }

    const evStart = event.startTime ? new Date(event.startTime) : new Date(event.startDate)
    const evEnd = event.endTime ? new Date(event.endTime) : evStart
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
      startTime: event.startTime,
      endTime: event.endTime,
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

    const { startDate, endDate, type, status } = req.query;
    
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

    res.json(attendances);
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
      const fetchForMerge = page * pageSize
      const [attendanceTotal, incidentTotal, attendanceRows, incidentRows, virtualAbsenceRows] = await Promise.all([
        prisma.attendance.count({ where }),
        prisma.attendanceIncident.count({ where: incidentWhere }),
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
          orderBy: [{ date: 'desc' }, { time: 'desc' }],
          take: fetchForMerge,
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
          take: fetchForMerge,
        }),
        buildVirtualAbsenceRows(q, where),
      ]);

      const merged = [
        ...attendanceRows.map(mapAttendanceUser),
        ...incidentRows.map(mapAttendanceIncidentAsFeedRow),
        ...virtualAbsenceRows,
      ]
        .sort((a: any, b: any) => {
          const aTime = new Date(a.time ?? a.date).getTime()
          const bTime = new Date(b.time ?? b.date).getTime()
          return bTime - aTime
        })
        .slice((page - 1) * pageSize, page * pageSize)

      return res.json({ total: attendanceTotal + incidentTotal + virtualAbsenceRows.length, page, pageSize, data: merged });
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

r.post('/materialize-absence', authGuard, requirePermission('attendance.update', 'all'), async (req, res) => {
  try {
    const parsed = materializeAbsenceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const { userId, eventId, date, status = 'ABSENT_NOT_JUSTIFIED', notes } = parsed.data;
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

    if (!event) return res.status(404).json({ message: 'Evento no encontrado' });
    if (event.assignedUserId !== userId) {
      return res.status(400).json({ message: 'La persona no está asignada a este evento' });
    }

    const attendanceDate = uruguayWallToUtc(date, 0, 0);
    const existing = await prisma.attendance.findFirst({
      where: {
        userId,
        eventId,
        date: attendanceDate,
        type: 'CHECK_IN',
      },
      include: {
        user: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } },
        event: { select: { id: true, title: true, type: true, startTime: true, endTime: true } },
      },
    });

    if (existing) {
      return res.json(mapAttendanceUser(existing as any));
    }

    const attendance = await prisma.attendance.create({
      data: {
        userId,
        eventId,
        type: 'CHECK_IN',
        status: status as any,
        date: attendanceDate,
        time: event.startTime ?? attendanceDate,
        schoolYearId: event.schoolYearId,
        notes:
          notes?.trim() ||
          'Ausencia registrada manualmente desde gestión de asistencias',
      },
      include: {
        user: { select: { id: true, name: true, email: true, ...selectOrgRoleCode } },
        event: { select: { id: true, title: true, type: true, startTime: true, endTime: true } },
      },
    });

    await recordAuditEventNow({
      action: 'ATTENDANCE_MANUAL_UPDATED' as any,
      actorUserId: req.user?.id ?? req.user?.sub ?? null,
      req,
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

    res.status(201).json(mapAttendanceUser(attendance as any));
  } catch (error) {
    console.error('Error materializando ausencia:', error);
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
