import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { authGuard, requireRole, requireAnyRole } from '../middlewares/auth.js';
import {
  applyEventStartDateFilter,
  buildMyEventsBaseFilter,
  applyMyEventsDateFilter,
  expandRecurringEvent,
} from '../events-query.js';
import {
  APP_TIMEZONE,
  isYmdDateString,
  jsWeekdayInUruguay,
  parseEventTimeToUruguayHhMm,
  parseStartDateToUruguayYmd,
  uruguayWallToUtc,
  uruguayYmdEndOfDayToUtc,
} from '../app-timezone.js';
import { DateTime } from 'luxon';
import { sendWebPushPayloadToUser } from '../services/webPush.js';
import { attachRoleCode, selectOrgRoleCode } from '../user-role-prisma.js';
import { AuditAction } from '@prisma/client';
import { recordAuditEvent } from '../services/audit-log.js';
import { getActiveSchoolYearId, resolveSchoolYearIdForList } from '../services/school-year-service.js';

const r = Router();

/** Aplana `orgRole.code` → `role` en usuarios relacionados del evento. */
function mapNestedEventUsers(ev: Record<string, unknown>) {
  const e = { ...ev };
  if (e.user && typeof e.user === 'object' && e.user !== null && 'orgRole' in e.user) {
    e.user = attachRoleCode(e.user as Parameters<typeof attachRoleCode>[0]);
  }
  if (e.assignedUser && typeof e.assignedUser === 'object' && 'orgRole' in e.assignedUser) {
    e.assignedUser = attachRoleCode(e.assignedUser as Parameters<typeof attachRoleCode>[0]);
  }
  if (Array.isArray(e.attendances)) {
    e.attendances = e.attendances.map((a) => {
      const row = a as Record<string, unknown>;
      if (row.user && typeof row.user === 'object' && row.user !== null && 'orgRole' in row.user) {
        return { ...row, user: attachRoleCode(row.user as Parameters<typeof attachRoleCode>[0]) };
      }
      return a;
    });
  }
  return e;
}

/** Relación opcional incluida en respuestas de evento. */
const eventCourseInclude = { select: { id: true, name: true, code: true } } as const

async function assertActiveCourse(courseId: string): Promise<{ id: string; schoolYearId: string | null } | null> {
  const c = await prisma.course.findFirst({
    where: { id: courseId, isActive: true },
    select: { id: true, schoolYearId: true },
  })
  return c
}

function myEventsPathForRole(role: string | undefined): string {
  if (role === 'TEACHER') return '/teacher/events';
  if (role === 'STAFF') return '/staff/events';
  if (role === 'ADMIN') return '/admin/events';
  return '/';
}

function toTimeMinutes(hh: number, mm: number) {
  return hh * 60 + mm
}

function parseRecurrenceEndInclusive(s: string) {
  if (isYmdDateString(s)) {
    return uruguayYmdEndOfDayToUtc(s)
  }
  const d = new Date(s)
  return new Date(d.getTime())
}

// Esquemas de validación
const optionalUuidFromInput = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? undefined : v),
  z.string().uuid().optional(),
)

const nullableOptionalUuidFromUpdateInput = z.preprocess(
  (v) => (v === '' || v === null ? null : v),
  z.string().uuid().nullable().optional(),
)

const boolish = z.preprocess((v) => {
  if (v === true || v === 'true' || v === 1 || v === '1') return true
  if (v === false || v === 'false' || v === 0 || v === '0') return false
  return Boolean(v)
}, z.boolean())

const daysOfWeekish = z.preprocess((v) => {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? Number.parseInt(x, 10) : Number(x)))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
}, z.array(z.number().min(0).max(6)).default([]))

const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.preprocess((v) => (v === null || v === '' ? undefined : v), z.string().optional()),
  type: z.enum(['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA']),
  // YYYY-MM-DD o ISO; el día civil se interpreta en America/Montevideo.
  startDate: z.string().min(1),
  // HH:MM (hora Uruguay) o ISO; se normaliza a instante UTC.
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  // El front puede mandar "" cuando el select está en "Sin asignar"; no es UUID válido.
  assignedUserId: optionalUuidFromInput,
  courseId: optionalUuidFromInput,
  recurrenceType: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).default('NONE'),
  recurrenceEnd: z.string().optional().nullable(),
  isRecurring: boolish.default(false),
  daysOfWeek: daysOfWeekish,
});

const eventUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.preprocess((v) => (v === null || v === '' ? null : v), z.string().nullable().optional()),
  type: z.enum(['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA']).optional(),
  startDate: z.string().min(1).optional(),
  startTime: z.string().min(1).optional(),
  endTime: z.string().min(1).optional(),
  assignedUserId: nullableOptionalUuidFromUpdateInput,
  courseId: nullableOptionalUuidFromUpdateInput,
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']).optional(),
  isRecurring: boolish.optional(),
  daysOfWeek: z.preprocess(
    (v) => {
      if (v === undefined) return undefined
      if (!Array.isArray(v)) return undefined
      return v
        .map((x) => (typeof x === 'string' ? Number.parseInt(x, 10) : Number(x)))
        .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    },
    z.array(z.number().min(0).max(6)).optional(),
  ),
  recurrenceEnd: z.preprocess((v) => (v === '' || v === null ? null : v), z.string().optional().nullable()),
});

// Crear evento
r.post('/', authGuard, requireAnyRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      const flat = parsed.error.flatten();
      const detail = parsed.error.issues
        .map((i) => `${i.path.length ? i.path.join('.') : 'formulario'}: ${i.message}`)
        .join(' · ');
      return res.status(400).json({
        message: 'Datos inválidos',
        detail,
        errors: parsed.error.issues,
        fieldErrors: flat.fieldErrors,
      });
    }

    const eventData = parsed.data;

    // Si es TEACHER, solo puede asignar eventos a sí mismo
    if (user.role === 'TEACHER' && eventData.assignedUserId && eventData.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No puedes asignar eventos a otros usuarios' });
    }

    let resolvedSchoolYearId: string | null = null
    if (eventData.courseId) {
      const c = await assertActiveCourse(eventData.courseId)
      if (!c) {
        return res.status(400).json({ message: 'Curso no encontrado o inactivo' });
      }
      resolvedSchoolYearId = c.schoolYearId ?? null;
    }
    if (!resolvedSchoolYearId) {
      resolvedSchoolYearId = await getActiveSchoolYearId(prisma);
    }
    if (!resolvedSchoolYearId) {
      return res.status(400).json({ message: 'No hay ciclo lectivo activo. Configurá un año lectivo primero.' });
    }

    // Normalización: fecha y hora civil en Uruguay → UTC en DB.
    const ymd = parseStartDateToUruguayYmd(eventData.startDate);
    const tStart = parseEventTimeToUruguayHhMm(eventData.startTime);
    const tEnd = parseEventTimeToUruguayHhMm(eventData.endTime);
    if (!ymd || !tStart || !tEnd) {
      return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
    }

    const startMinutes = toTimeMinutes(tStart.hh, tStart.mm);
    const endMinutes = toTimeMinutes(tEnd.hh, tEnd.mm);
    if (endMinutes <= startMinutes) {
      return res.status(400).json({ message: 'Hora fin debe ser mayor que hora inicio' });
    }

    let startDateUtc: Date;
    let endTimeUtc: Date;
    try {
      startDateUtc = uruguayWallToUtc(ymd, tStart.hh, tStart.mm);
      endTimeUtc = uruguayWallToUtc(ymd, tEnd.hh, tEnd.mm);
    } catch {
      return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
    }

    // Validaciones para recurrencia.
    const isRecurring = Boolean(eventData.isRecurring);
    const recurrenceType = eventData.recurrenceType ?? (isRecurring ? 'WEEKLY' : 'NONE');
    if (isRecurring && recurrenceType === 'NONE') {
      return res.status(400).json({ message: 'Evento repetitivo requiere recurrenceType válido' });
    }
    if (isRecurring && (eventData.recurrenceEnd === null || !eventData.recurrenceEnd)) {
      return res.status(400).json({ message: 'Evento repetitivo requiere recurrenceEnd' });
    }
    if (isRecurring && recurrenceType === 'WEEKLY' && eventData.daysOfWeek.length === 0) {
      // UX: si no seleccionan días pero el usuario definió una fecha base,
      // inferimos el día de la semana desde startDate para que el evento sea utilizable.
      // (Así evitamos “no deja” por validación demasiado estricta).
      eventData.daysOfWeek = [jsWeekdayInUruguay(startDateUtc)];
    }
    if (isRecurring && recurrenceType === 'WEEKLY' && eventData.daysOfWeek.length === 0) {
      return res.status(400).json({ message: 'Evento repetitivo semanal requiere al menos un día de la semana' });
    }
    if (isRecurring && eventData.recurrenceEnd) {
      const recEnd = parseRecurrenceEndInclusive(eventData.recurrenceEnd);
      if (recEnd.getTime() < startDateUtc.getTime()) {
        return res.status(400).json({ message: 'recurrenceEnd debe ser >= startDate (base)' });
      }
    }

    const event = await prisma.event.create({
      data: {
        title: eventData.title,
        description: eventData.description ?? null,
        type: eventData.type,
        status: 'SCHEDULED',
        userId: user.sub,
        assignedUserId: eventData.assignedUserId ?? null,
        startDate: startDateUtc,
        startTime: startDateUtc,
        endTime: endTimeUtc,
        endDate: null,
        recurrenceType,
        recurrenceEnd: eventData.recurrenceEnd ? parseRecurrenceEndInclusive(eventData.recurrenceEnd) : null,
        isRecurring,
        daysOfWeek: eventData.daysOfWeek ?? [],
        courseId: eventData.courseId ?? null,
        schoolYearId: resolvedSchoolYearId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        course: eventCourseInclude,
      }
    });

    const assigneeId = event.assignedUserId;
    if (assigneeId && assigneeId !== user.sub) {
      const assigneeRole = event.assignedUser?.orgRole?.code;
      const titleShort = event.title.length > 80 ? `${event.title.slice(0, 80)}…` : event.title;
      void sendWebPushPayloadToUser(assigneeId, {
        title: 'Edutrack — Nuevo evento',
        body: `Te asignaron un evento: ${titleShort}`,
        url: myEventsPathForRole(assigneeRole),
      }).catch((err) => console.error('Web push (evento asignado):', err));

      void prisma.inAppNotification
        .create({
          data: {
            userId: assigneeId,
            type: 'EVENT_ASSIGNED',
            title: 'Nuevo evento',
            body: `Te asignaron un evento: ${titleShort}`,
            actionUrl: myEventsPathForRole(assigneeRole),
          },
        })
        .catch((err) => console.error('Aviso en app (evento asignado):', err));
    }

    recordAuditEvent({
      action: AuditAction.EVENT_CREATED,
      actorUserId: user.sub,
      req,
      entityType: 'Event',
      entityId: event.id,
      metadata: {
        title: event.title,
        type: event.type,
        assignedUserId: event.assignedUserId,
      },
    });

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error creando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Obtener eventos del usuario actual
r.get('/my-events', authGuard, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const { startDate, endDate, type, status } = req.query;

    const where: any = buildMyEventsBaseFilter(user.sub)
    // Excluimos excepciones materializadas en childEvents para evitar duplicados.
    where.parentEventId = null

    const activeSy = await getActiveSchoolYearId(prisma)
    if (activeSy) {
      where.schoolYearId = activeSy
    }

    // Si hay filtro de fecha, buscar eventos que puedan tener instancias en ese rango
    applyMyEventsDateFilter(where, user.sub, startDate, endDate)

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    const events = await prisma.event.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        course: eventCourseInclude,
        childEvents: {
          select: {
            id: true,
            title: true,
            description: true,
            type: true,
            status: true,
            startDate: true,
            startTime: true,
            endTime: true,
            endDate: true,
            recurrenceType: true,
            isRecurring: true,
            daysOfWeek: true,
            parentEventId: true,
            courseId: true,
            course: eventCourseInclude,
          },
        },
        _count: {
          select: { attendances: true }
        }
      },
      orderBy: { startDate: 'asc' },
    });

    // Para eventos repetitivos, generar instancias específicas para el rango de fechas
    const processedEvents = events.flatMap((event) => expandRecurringEvent(event, startDate, endDate))

    res.json(processedEvents.map((e) => mapNestedEventUsers(e as unknown as Record<string, unknown>)));
  } catch (error) {
    console.error('Error obteniendo eventos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Marcar eventos vencidos automáticamente
async function markExpiredEvents() {
  try {
    const now = new Date();
    await prisma.event.updateMany({
      where: {
        endDate: {
          lt: now
        },
        status: {
          in: ['SCHEDULED', 'IN_PROGRESS']
        }
      },
      data: {
        status: 'EXPIRED'
      }
    });
  } catch (error) {
    console.error('Error marcando eventos vencidos:', error);
  }
}

// Obtener todos los eventos (solo ADMIN)
r.get('/all', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const user = req.user
    if (!user) return res.status(401).json({ message: 'No autorizado' })

    // Marcar eventos vencidos antes de obtener la lista
    await markExpiredEvents();
    
    const { startDate, endDate, userId, assignedUserId, type, status } = req.query;
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);

    const allYears = req.query.allYears === '1'
    const schoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          role: user.role,
          requestedSchoolYearId: typeof req.query.schoolYearId === 'string' ? req.query.schoolYearId : undefined,
        })

    const where: any = {};

    applyEventStartDateFilter(where, startDate, endDate)

    if (userId) {
      where.userId = userId;
    }

    if (assignedUserId) {
      where.assignedUserId = assignedUserId;
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (schoolYearId) {
      where.schoolYearId = schoolYearId;
    }

    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, ...selectOrgRoleCode }
          },
          assignedUser: {
            select: { id: true, name: true, email: true, ...selectOrgRoleCode }
          },
          course: eventCourseInclude,
          _count: {
            select: { attendances: true }
          }
        },
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({
      total,
      page,
      pageSize,
      data: events.map((e) => mapNestedEventUsers(e as unknown as Record<string, unknown>)),
    });
  } catch (error) {
    console.error('Error obteniendo todos los eventos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Eliminar todos los eventos (solo ADMIN)
r.delete('/purge-all', authGuard, requireRole('ADMIN'), async (_req, res) => {
  try {
    const deleted = await prisma.event.deleteMany({})
    res.json({ ok: true, deletedCount: deleted.count, message: 'Todos los eventos fueron eliminados' })
  } catch (error) {
    console.error('Error eliminando todos los eventos:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Obtener evento por ID
r.get('/:id', authGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        course: eventCourseInclude,
        attendances: {
          include: {
            user: {
              select: { id: true, name: true, email: true, ...selectOrgRoleCode }
            }
          },
          orderBy: { time: 'asc' }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    // Verificar permisos: solo ADMIN puede ver todos los eventos, o el usuario debe ser el creador/asignado
    if (user.role !== 'ADMIN' && event.userId !== user.sub && event.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para ver este evento' });
    }

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error obteniendo evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Actualizar evento
r.put('/:id', authGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const parsed = eventUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos inválidos',
        detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '),
        errors: parsed.error.issues,
      });
    }

    // Verificar que el evento existe y el usuario tiene permisos
    const existingEvent = await prisma.event.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        assignedUserId: true,
        startDate: true,
        startTime: true,
        endTime: true,
        isRecurring: true,
        recurrenceType: true,
        recurrenceEnd: true,
        daysOfWeek: true,
        status: true,
      }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    // Verificar permisos
    if (user.role !== 'ADMIN' && existingEvent.userId !== user.sub && existingEvent.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para editar este evento' });
    }

    const updateData: any = { ...parsed.data };

    if (parsed.data.courseId !== undefined) {
      if (parsed.data.courseId === null) {
        const sy = await getActiveSchoolYearId(prisma)
        if (sy) updateData.schoolYearId = sy
      } else {
        const co = await assertActiveCourse(parsed.data.courseId)
        if (!co) {
          return res.status(400).json({ message: 'Curso no encontrado o inactivo' });
        }
        updateData.schoolYearId = co.schoolYearId ?? (await getActiveSchoolYearId(prisma))
      }
    }

    // Normalización UTC de startDate/startTime/endTime si se envían.
    // Si no se envían, conservamos componentes del evento actual.
    const nextStartDateInput = updateData.startDate ?? null;
    const nextStartTimeInput = updateData.startTime ?? null;
    const nextEndTimeInput = updateData.endTime ?? null;

    if (nextStartDateInput || nextStartTimeInput || nextEndTimeInput) {
      const baseYmd =
        nextStartDateInput != null && String(nextStartDateInput) !== ''
          ? parseStartDateToUruguayYmd(String(nextStartDateInput))
          : DateTime.fromJSDate(new Date(existingEvent.startDate), { zone: 'utc' })
              .setZone(APP_TIMEZONE)
              .toFormat('yyyy-MM-dd');

      const existingStartWall = DateTime.fromJSDate(
        new Date(existingEvent.startTime ?? existingEvent.startDate),
        { zone: 'utc' },
      ).setZone(APP_TIMEZONE);
      const existingEndWall = DateTime.fromJSDate(
        new Date(existingEvent.endTime ?? existingEvent.startDate),
        { zone: 'utc' },
      ).setZone(APP_TIMEZONE);

      const startHHmm = nextStartTimeInput
        ? parseEventTimeToUruguayHhMm(String(nextStartTimeInput))
        : { hh: existingStartWall.hour, mm: existingStartWall.minute };

      const endHHmm = nextEndTimeInput
        ? parseEventTimeToUruguayHhMm(String(nextEndTimeInput))
        : { hh: existingEndWall.hour, mm: existingEndWall.minute };

      if (!baseYmd || !startHHmm || !endHHmm) {
        return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
      }

      const startMinutes = toTimeMinutes(startHHmm.hh, startHHmm.mm);
      const endMinutes = toTimeMinutes(endHHmm.hh, endHHmm.mm);
      if (endMinutes <= startMinutes) {
        return res.status(400).json({ message: 'Hora fin debe ser mayor que hora inicio' });
      }

      let startDateUtc: Date;
      let endTimeUtc: Date;
      try {
        startDateUtc = uruguayWallToUtc(baseYmd, startHHmm.hh, startHHmm.mm);
        endTimeUtc = uruguayWallToUtc(baseYmd, endHHmm.hh, endHHmm.mm);
      } catch {
        return res.status(400).json({ message: 'Fechas/hora inválidas (usar YYYY-MM-DD y HH:MM, hora de Uruguay)' });
      }

      updateData.startDate = startDateUtc
      updateData.startTime = startDateUtc
      updateData.endTime = endTimeUtc
      updateData.endDate = null
    }

    if (updateData.recurrenceEnd !== undefined) {
      updateData.recurrenceEnd = updateData.recurrenceEnd
        ? parseRecurrenceEndInclusive(String(updateData.recurrenceEnd))
        : null
    }

    // Validación mínima para recurrencia si se está actualizando.
    if (typeof updateData.isRecurring === 'boolean' ? updateData.isRecurring : existingEvent.isRecurring) {
      const recType = updateData.recurrenceType ?? existingEvent.recurrenceType
      if (recType === 'NONE') {
        return res.status(400).json({ message: 'Evento repetitivo requiere recurrenceType válido' })
      }
      const recEnd = updateData.recurrenceEnd ?? existingEvent.recurrenceEnd
      if (!recEnd) {
        return res.status(400).json({ message: 'Evento repetitivo requiere recurrenceEnd' })
      }
      const days = updateData.daysOfWeek ?? existingEvent.daysOfWeek
      if (recType === 'WEEKLY' && (!days || days.length === 0)) {
        return res.status(400).json({ message: 'Evento repetitivo semanal requiere al menos un día de la semana' })
      }
    }

    const event = await prisma.event.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        course: eventCourseInclude,
      }
    });

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error actualizando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Cancelar evento
r.put('/:id/cancel', authGuard, async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const { reason } = req.body;

    // Verificar que el evento existe y el usuario tiene permisos
    const existingEvent = await prisma.event.findUnique({
      where: { id },
      select: { userId: true, assignedUserId: true, status: true, description: true }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    if (existingEvent.status === 'CANCELLED') {
      return res.status(400).json({ message: 'El evento ya está cancelado' });
    }

    // Verificar permisos
    if (user.role !== 'ADMIN' && existingEvent.userId !== user.sub && existingEvent.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para cancelar este evento' });
    }

    const event = await prisma.event.update({
      where: { id },
      data: { 
        status: 'CANCELLED',
        description: reason ? `${existingEvent.description || ''}\n\nCancelado: ${reason}`.trim() : existingEvent.description
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, ...selectOrgRoleCode }
        },
        course: eventCourseInclude,
      }
    });

    res.json(mapNestedEventUsers(event as unknown as Record<string, unknown>));
  } catch (error) {
    console.error('Error cancelando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Eliminar evento (solo ADMIN)
r.delete('/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.event.delete({
      where: { id },
    });

    res.json({ message: 'Evento eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando evento:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

export default r;
