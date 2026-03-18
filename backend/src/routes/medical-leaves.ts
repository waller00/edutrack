import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { prisma } from '../prisma.js'

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
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
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
        status: 'APPROVED' // Las licencias creadas por admin se aprueban automáticamente
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

    res.status(201).json(license)
  } catch (error) {
    console.error('Error creando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Función para justificar ausencias automáticamente cuando se aprueba una licencia
async function justifyAbsencesForLicense(licenseId: string) {
  try {
    const license = await prisma.medicalLeave.findUnique({
      where: { id: licenseId },
      select: {
        userId: true,
        startDate: true,
        endDate: true,
        type: true,
        reason: true
      }
    })

    if (!license) {
      console.error('Licencia no encontrada:', licenseId)
      return
    }

    // Buscar ausencias no justificadas en el período de la licencia
    const unjustifiedAbsences = await prisma.attendance.findMany({
      where: {
        userId: license.userId,
        date: {
          gte: license.startDate,
          lte: license.endDate
        },
        status: 'ABSENT_NOT_JUSTIFIED',
        type: 'CHECK_IN'
      }
    })

    if (unjustifiedAbsences.length > 0) {
      // Justificar las ausencias
      const updated = await prisma.attendance.updateMany({
        where: {
          userId: license.userId,
          date: {
            gte: license.startDate,
            lte: license.endDate
          },
          status: 'ABSENT_NOT_JUSTIFIED',
          type: 'CHECK_IN'
        },
        data: {
          status: 'ABSENT_JUSTIFIED',
          notes: `Ausencia justificada por licencia ${license.type.toLowerCase()} del ${license.startDate.toLocaleDateString('es-ES')} al ${license.endDate.toLocaleDateString('es-ES')}`
        }
      })

      console.log(`✅ Justificadas ${updated.count} ausencias para licencia ${licenseId}`)
    }
  } catch (error) {
    console.error('Error justificando ausencias:', error)
  }
}

// Actualizar estado de licencia médica (solo admin)
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

    const { status, notes } = parsed.data

    const license = await prisma.medicalLeave.findUnique({
      where: { id }
    })

    if (!license) {
      return res.status(404).json({ message: 'Licencia médica no encontrada' })
    }

    const updatedLicense = await prisma.medicalLeave.update({
      where: { id },
      data: {
        ...(status && { status }),
        ...(notes && { notes }),
        ...(status && status !== 'PENDING' && {
          approvedBy: req.user?.id,
          approvedAt: new Date()
        })
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

    // Si se aprobó la licencia, justificar ausencias automáticamente
    if (status === 'APPROVED') {
      await justifyAbsencesForLicense(id)
    }

    res.json(updatedLicense)
  } catch (error) {
    console.error('Error actualizando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Eliminar licencia médica (solo admin)
r.delete('/:id', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { id } = req.params

    const license = await prisma.medicalLeave.findUnique({
      where: { id }
    })

    if (!license) {
      return res.status(404).json({ message: 'Licencia médica no encontrada' })
    }

    await prisma.medicalLeave.delete({
      where: { id }
    })

    res.json({ message: 'Licencia médica eliminada correctamente' })
  } catch (error) {
    console.error('Error eliminando licencia médica:', error)
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
