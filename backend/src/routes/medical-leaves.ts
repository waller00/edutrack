import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { prisma } from '../prisma.js'
import { reconcileAttendancesForMedicalLeave } from '../services/medicalLeaveReconciliation.js'

const r = Router()

// Esquemas de validación
const medicalLeaveSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['MEDICAL_LEAVE', 'WORK_LEAVE', 'OTHER']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  reason: z.string().min(1).max(500),
  doctorName: z.string().optional(),
  doctorPhone: z.string().optional(),
  notes: z.string().optional()
})

const medicalLeaveUpdateSchema = z.object({
  type: z.enum(['MEDICAL_LEAVE', 'WORK_LEAVE', 'OTHER']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  reason: z.string().min(1).max(500).optional(),
  doctorName: z.string().optional(),
  doctorPhone: z.string().optional(),
  notes: z.string().optional()
})

// Obtener todas las licencias médicas (solo admin)
r.get('/all', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { 
      userId, 
      type, 
      status, 
      startDate, 
      endDate,
      page = 1,
      pageSize = 20
    } = req.query

    const where: any = {}

    if (userId) where.userId = userId
    if (type) where.type = type
    if (status) where.status = status
    if (startDate) where.startDate = { gte: new Date(String(startDate)) }
    if (endDate) where.endDate = { lte: new Date(String(endDate)) }

    const skip = (Number(page) - 1) * Number(pageSize)
    const take = Number(pageSize)

    const [licenses, total] = await Promise.all([
      prisma.medicalLeave.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.medicalLeave.count({ where })
    ])

    res.json({
      data: licenses,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        totalPages: Math.ceil(total / Number(pageSize))
      }
    })
  } catch (error) {
    console.error('Error obteniendo licencias médicas:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Obtener licencias médicas del usuario actual
r.get('/my-leaves', authGuard, async (req, res) => {
  try {
    const userId = req.user?.id
    if (!userId) return res.status(401).json({ message: 'No autorizado' })
    const { page = 1, pageSize = 20 } = req.query

    const skip = (Number(page) - 1) * Number(pageSize)
    const take = Number(pageSize)

    const [licenses, total] = await Promise.all([
      prisma.medicalLeave.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take
      }),
      prisma.medicalLeave.count({ where: { userId } })
    ])

    res.json({
      data: licenses,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total,
        totalPages: Math.ceil(total / Number(pageSize))
      }
    })
  } catch (error) {
    console.error('Error obteniendo licencias del usuario:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Crear nueva licencia médica (solo admin)
r.post('/', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const parsed = medicalLeaveSchema.safeParse(req.body)
    
    if (!parsed.success) {
      return res.status(400).json({ 
        message: 'Datos inválidos',
        errors: parsed.error.errors
      })
    }

    const { userId, type, startDate, endDate, reason, doctorName, doctorPhone, notes } = parsed.data

    // Verificar que el usuario existe
    const user = await prisma.user.findUnique({
      where: { id: userId }
    })

    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado' })
    }

    // Verificar que la fecha de inicio no sea posterior a la fecha de fin
    if (new Date(startDate) > new Date(endDate)) {
      return res.status(400).json({ message: 'La fecha de inicio no puede ser posterior a la fecha de fin' })
    }

    const license = await prisma.medicalLeave.create({
      data: {
        userId,
        type,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        reason,
        doctorName,
        doctorPhone,
        notes,
        status: 'ACTIVE' as any,
        approvedBy: req.user?.id,
        approvedAt: new Date()
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    })

    const reconciliation = await reconcileAttendancesForMedicalLeave(license.id)

    res.status(201).json({ ...license, reconciliation })
  } catch (error) {
    console.error('Error creando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Actualizar licencia médica (solo admin)
r.put('/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params
    const parsed = medicalLeaveUpdateSchema.safeParse(req.body)
    
    if (!parsed.success) {
      return res.status(400).json({ 
        message: 'Datos inválidos',
        errors: parsed.error.errors
      })
    }

    const { type, startDate, endDate, reason, doctorName, doctorPhone, notes } = parsed.data

    const license = await prisma.medicalLeave.findUnique({
      where: { id }
    })

    if (!license) {
      return res.status(404).json({ message: 'Licencia médica no encontrada' })
    }

    const nextStartDate = startDate ? new Date(startDate) : license.startDate
    const nextEndDate = endDate ? new Date(endDate) : license.endDate

    if (nextStartDate > nextEndDate) {
      return res.status(400).json({ message: 'La fecha de inicio no puede ser posterior a la fecha de fin' })
    }

    const updatedLicense = await prisma.medicalLeave.update({
      where: { id },
      data: {
        ...(type && { type }),
        ...(startDate && { startDate: nextStartDate }),
        ...(endDate && { endDate: nextEndDate }),
        ...(reason && { reason }),
        doctorName,
        doctorPhone,
        notes,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    })

    const reconciliation = await reconcileAttendancesForMedicalLeave(id)

    res.json({ ...updatedLicense, reconciliation })
  } catch (error) {
    console.error('Error actualizando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Desactivar licencia médica (solo admin)
r.delete('/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params

    const license = await prisma.medicalLeave.findUnique({
      where: { id }
    })

    if (!license) {
      return res.status(404).json({ message: 'Licencia médica no encontrada' })
    }

    await prisma.medicalLeave.update({
      where: { id },
      data: {
        status: 'INACTIVE' as any,
        deactivatedBy: req.user?.id,
        deactivatedAt: new Date()
      } as any
    })

    res.json({ message: 'Licencia médica desactivada correctamente' })
  } catch (error) {
    console.error('Error desactivando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Obtener licencia médica por ID
r.get('/:id', authGuard, async (req, res) => {
  try {
    const { id } = req.params

    const license = await prisma.medicalLeave.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true
          }
        }
      }
    })

    if (!license) {
      return res.status(404).json({ message: 'Licencia médica no encontrada' })
    }

    // Solo admin puede ver todas las licencias, usuarios solo pueden ver las suyas
    if (!req.user || (req.user.role !== 'ADMIN' && license.userId !== req.user.id)) {
      return res.status(403).json({ message: 'No tienes permisos para ver esta licencia' })
    }

    res.json(license)
  } catch (error) {
    console.error('Error obteniendo licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
