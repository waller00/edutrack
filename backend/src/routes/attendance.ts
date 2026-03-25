import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../prisma.js';
import { authGuard, requireRole, requireAnyRole } from '../middlewares/auth.js';
import {
  getDuplicateAttendanceMessage,
  getAttendanceStatus,
  buildBiometricAttendancePayload,
  isBiometricLate,
} from '../attendance-logic.js';
import { findApprovedLicenseCoveringEventTime } from '../services/medicalLeaveReconciliation.js';

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
  status: z.enum(['PRESENT', 'LATE', 'ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED', 'EXIT', 'EARLY_EXIT']).optional(),
  notes: z.string().optional(),
});

function normalizeAttendanceDate(date: string) {
  return new Date(date)
}

function applyDateRangeFilter(where: any, startDate?: unknown, endDate?: unknown) {
  if (!startDate && !endDate) return

  where.date = {}

  if (startDate) {
    where.date.gte = new Date(startDate as string)
  }

  if (endDate) {
    where.date.lte = new Date(endDate as string)
  }
}

// Registrar asistencia (CHECK_IN o CHECK_OUT)
r.post('/register', authGuard, async (req, res) => {
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
        assignedUserId: true,
      },
    });

    if (!event) {
      return res.status(404).json({ message: 'Evento no encontrado' });
    }

    // Verificar que el usuario esté asignado al evento
    if (event.assignedUserId !== user.sub) {
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
    const status = getAttendanceStatus({
      type,
      actualTime,
      startTime: event.startTime,
      endTime: event.endTime,
      hasApprovedLicense: false,
    });

    const attendance = await prisma.attendance.create({
      data: {
        userId: user.sub,
        type,
        date: new Date(date),
        time: actualTime,
        notes,
        eventId,
        status,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true }
        },
        event: {
          select: { id: true, title: true, type: true, startTime: true, endTime: true }
        }
      }
    });

    res.json(attendance);
  } catch (error) {
    console.error('Error registrando asistencia:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Obtener asistencias del usuario actual
r.get('/my-attendances', authGuard, async (req, res) => {
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
r.get('/all', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { startDate, endDate, userId, eventType, type, status, role } = req.query;
    const page = Number(req.query.page) || 1;
    const pageSize = Math.min(Number(req.query.pageSize) || 20, 100);

    const where: any = {};

    applyDateRangeFilter(where, startDate, endDate)

    if (userId) {
      where.userId = userId;
    }

    if (eventType) {
      where.event = {
        type: eventType as any
      };
      // También asegurar que el evento existe
      where.eventId = {
        not: null
      };
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (role) {
      where.user = {
        role: role as any,
      };
    }

    const [total, attendances] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.findMany({
        where,
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true }
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

// Actualizar asistencia (solo ADMIN)
r.put('/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params;
    const parsed = attendanceUpdateSchema.safeParse(req.body);
    
    if (!parsed.success) {
      return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors });
    }

    const attendance = await prisma.attendance.update({
      where: { id },
      data: parsed.data,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true }
        },
        event: {
          select: { id: true, title: true, type: true }
        }
      }
    });

    res.json(attendance);
  } catch (error) {
    console.error('Error actualizando asistencia:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Eliminar asistencia (solo ADMIN)
r.delete('/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
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

// Obtener estadísticas de asistencias
r.get('/stats', authGuard, requireAnyRole(['ADMIN', 'TEACHER']), async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autorizado' });

    const { startDate, endDate, userId, eventType, eventId, type, status, role } = req.query;
    
    const where: any = {};
    
    applyDateRangeFilter(where, startDate, endDate)

    // Si no es ADMIN, solo puede ver sus propias estadísticas
    if (user.role !== 'ADMIN') {
      where.userId = user.sub;
    } else if (userId) {
      where.userId = userId;
    }

    // Filtros equivalentes a los usados para el listado
    if (user.role === 'ADMIN' && role) {
      where.user = { role: role as any };
    }
    if (eventType) {
      where.event = { type: eventType as any };
      // Asegura que eventId no sea null cuando filtramos por tipo de evento
      where.eventId = { not: null };
    }
    if (eventId) {
      where.eventId = eventId as string;
    }
    if (type) {
      where.type = type as any;
    }
    if (status) {
      where.status = status as any;
    }

    const [totalAttendances, presentCount, absentCount, lateCount, medicalLeaveCount] = await Promise.all([
      prisma.attendance.count({ where }),
      prisma.attendance.count({ where: { ...where, status: 'PRESENT' } }),
      prisma.attendance.count({
        where: {
          ...where,
          status: { in: ['ABSENT_NOT_JUSTIFIED', 'ABSENT_JUSTIFIED'] },
        },
      }),
      prisma.attendance.count({ where: { ...where, status: 'LATE' } }),
      // Para el panel de asistencias, "médica" se refleja como ausencia justificada.
      prisma.attendance.count({ where: { ...where, status: 'ABSENT_JUSTIFIED' } }),
    ])

    const attendanceRate = totalAttendances > 0 ? (presentCount / totalAttendances) * 100 : 0;
    const lateRate = totalAttendances > 0 ? (lateCount / totalAttendances) * 100 : 0;
    const absenceRate = totalAttendances > 0 ? (absentCount / totalAttendances) * 100 : 0;

    res.json({
      totalAttendances,
      presentCount,
      absentCount,
      lateCount,
      medicalLeaveCount,
      attendanceRate: Math.round(attendanceRate * 100) / 100,
      lateRate: Math.round(lateRate * 100) / 100,
      absenceRate: Math.round(absenceRate * 100) / 100,
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Registrar asistencia automática (desde sistema biométrico)
r.post('/biometric', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { userId, timestamp, deviceId } = req.body;
    
    if (!userId || !timestamp) {
      return res.status(400).json({ message: 'userId y timestamp son requeridos' });
    }

    const attendanceTime = new Date(timestamp);
    const attendanceDate = new Date(attendanceTime);
    attendanceDate.setHours(0, 0, 0, 0); // Solo la fecha, sin hora

    const licBio = await findApprovedLicenseCoveringEventTime(userId, attendanceTime, attendanceTime);
    if (licBio) {
      return res.status(403).json({
        message:
          'Marcación biométrica no permitida: instante cubierto por licencia médica aprobada. Debe figurar como inasistencia justificada.',
        code: 'BIOMETRIC_BLOCKED_BY_LICENSE',
        licenseId: licBio.id,
      });
    }

    // Verificar si ya existe una entrada para este usuario en esta fecha
    const existingEntry = await prisma.attendance.findFirst({
      where: {
        userId,
        date: attendanceDate,
        type: 'CHECK_IN'
      }
    });

    if (existingEntry) {
      const existingExit = await prisma.attendance.findFirst({
        where: {
          userId,
          date: attendanceDate,
          type: 'CHECK_OUT'
        }
      });

      if (existingExit) {
        return res.status(400).json({ 
          message: 'Ya existe registro de entrada y salida para este usuario en esta fecha' 
        });
      }

      const exitAttendance = await prisma.attendance.create({
        data: buildBiometricAttendancePayload({ userId, attendanceDate, attendanceTime, deviceId, type: 'CHECK_OUT' }),
        include: {
          user: { select: { id: true, name: true, email: true, role: true } }
        }
      });

      return res.status(201).json({
        type: 'CHECK_OUT',
        attendance: exitAttendance,
        message: 'Salida registrada automáticamente'
      });
    }

    const isLate = isBiometricLate(attendanceTime)
    
    const entryAttendance = await prisma.attendance.create({
      data: buildBiometricAttendancePayload({ userId, attendanceDate, attendanceTime, deviceId, isLate, type: 'CHECK_IN' }),
      include: {
        user: { select: { id: true, name: true, email: true, role: true } }
      }
    });

    return res.status(201).json({
      type: 'CHECK_IN',
      attendance: entryAttendance,
      message: isLate ? 'Entrada registrada - RETRASO detectado' : 'Entrada registrada correctamente',
      isLate
    });
  } catch (error) {
    console.error('Error registrando asistencia biométrica:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Agregar nota a asistencia existente (para retrasos o salidas anticipadas)
r.post('/:id/note', authGuard, requireAnyRole(['ADMIN', 'TEACHER', 'STAFF']), async (req, res) => {
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

    // Verificar permisos
    if (req.user.role !== 'ADMIN' && existingAttendance.userId !== req.user.sub) {
      return res.status(403).json({ message: 'No tienes permisos para modificar este registro' });
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
      data: updateData,
      include: {
        user: { select: { id: true, name: true, email: true, role: true } }
      }
    });

    res.json({
      attendance: updatedAttendance,
      message: 'Nota agregada correctamente'
    });
  } catch (error) {
    console.error('Error agregando nota:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

// Marcar ausencias automáticamente basadas en eventos y licencias médicas (solo admin)
r.post('/mark-absences', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { startDate, endDate, userId } = req.body;

    if (!startDate || !endDate) {
      return res.status(400).json({ message: 'startDate y endDate son requeridos' });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Obtener todos los eventos en el rango de fechas
    const events = await prisma.event.findMany({
      where: {
        startDate: {
          gte: start,
          lte: end
        },
        ...(userId && { assignedUserId: userId })
      },
      include: {
        assignedUser: {
          select: { id: true, name: true, email: true, role: true }
        }
      }
    });

    let markedAbsences = 0;

    for (const event of events) {
      const eventDate = new Date(event.startDate);
      eventDate.setHours(0, 0, 0, 0);

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
      const approvedLicense = await prisma.medicalLeave.findFirst({
        where: {
          userId: event.assignedUserId,
          status: 'ACTIVE' as any,
          startDate: { lte: eventDate },
          endDate: { gte: eventDate }
        }
      });

      // Determinar el status basado en si tiene licencia médica
      const status = approvedLicense ? 'ABSENT_JUSTIFIED' : 'ABSENT_NOT_JUSTIFIED';

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
            : 'Ausencia automática - Sin asistencia registrada',
          eventId: event.id
        }
      });

      markedAbsences++;
    }

    res.json({
      message: `Se marcaron ${markedAbsences} ausencias automáticamente`,
      markedAbsences,
      totalEvents: events.length
    });
  } catch (error) {
    console.error('Error marcando ausencias automáticamente:', error);
    res.status(500).json({ message: 'Error interno del servidor' });
  }
});

export default r;
