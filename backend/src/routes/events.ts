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

const r = Router();

// Esquemas de validación
const eventSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  type: z.enum(['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA']),
  startDate: z.string().datetime(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  assignedUserId: z.string().uuid().optional(),
  recurrenceType: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).default('NONE'),
  recurrenceEnd: z.string().datetime().optional().nullable(),
  isRecurring: z.boolean().default(false),
  daysOfWeek: z.array(z.number().min(0).max(6)).default([]),
});

const eventUpdateSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  type: z.enum(['JORNADA_LABORAL', 'REUNION', 'CLASE', 'EVENTO', 'CAPACITACION', 'CITA_MEDICA']).optional(),
  startDate: z.string().datetime().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
  assignedUserId: z.string().uuid().optional(),
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']).optional(),
  isRecurring: z.boolean().optional(),
  daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
  recurrenceEnd: z.string().datetime().optional().nullable(),
});

// Crear evento
r.post('/', authGuard, requireAnyRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const eventData = parsed.data;

    // Si es TEACHER, solo puede asignar eventos a sí mismo
    if (user.role === 'TEACHER' && eventData.assignedUserId && eventData.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No puedes asignar eventos a otros usuarios' });
    }

    const event = await prisma.event.create({
      data: {
        ...eventData,
        userId: user.sub,
        startDate: new Date(eventData.startDate),
        startTime: eventData.startTime ? new Date(eventData.startTime) : null,
        endTime: eventData.endTime ? new Date(eventData.endTime) : null,
        recurrenceEnd: eventData.recurrenceEnd ? new Date(eventData.recurrenceEnd) : null,
        daysOfWeek: eventData.daysOfWeek,
      } as any,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });

    res.json(event);
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
          select: { id: true, name: true, email: true, role: true }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, role: true }
        },
        _count: {
          select: { attendances: true }
        }
      },
      orderBy: { startDate: 'asc' },
    });

    // Para eventos repetitivos, generar instancias específicas para el rango de fechas
    const processedEvents = events.flatMap((event) => expandRecurringEvent(event, startDate, endDate))

    res.json(processedEvents);
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
    // Marcar eventos vencidos antes de obtener la lista
    await markExpiredEvents();
    
    const { startDate, endDate, userId, assignedUserId, type, status } = req.query;
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);

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

    const [total, events] = await Promise.all([
      prisma.event.count({ where }),
      prisma.event.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true }
          },
          assignedUser: {
            select: { id: true, name: true, email: true, role: true }
          },
          _count: {
            select: { attendances: true }
          }
        },
        orderBy: { startDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({ total, page, pageSize, data: events });
  } catch (error) {
    console.error('Error obteniendo todos los eventos:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

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
          select: { id: true, name: true, email: true, role: true }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, role: true }
        },
        attendances: {
          include: {
            user: {
              select: { id: true, name: true, email: true, role: true }
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

    res.json(event);
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
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    // Verificar que el evento existe y el usuario tiene permisos
    const existingEvent = await prisma.event.findUnique({
      where: { id },
      select: { userId: true, assignedUserId: true }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    // Verificar permisos
    if (user.role !== 'ADMIN' && existingEvent.userId !== user.sub && existingEvent.assignedUserId !== user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para editar este evento' });
    }

    const updateData: any = { ...parsed.data };
    
    // Convertir fechas si están presentes
    if (updateData.startDate) updateData.startDate = new Date(updateData.startDate);
    if (updateData.endDate) updateData.endDate = new Date(updateData.endDate);
    if (updateData.startTime) updateData.startTime = new Date(updateData.startTime);
    if (updateData.endTime) updateData.endTime = new Date(updateData.endTime);

    const event = await prisma.event.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });

    res.json(event);
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
          select: { id: true, name: true, email: true, role: true }
        },
        assignedUser: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });

    res.json(event);
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
