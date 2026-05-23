import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requirePermission, userPermissionScope } from '../middlewares/auth.js'
import { prisma } from '../db/prisma.js'
import { reconcileAttendancesForMedicalLeave } from '../services/medicalLeaveReconciliation.js'
import { recordAuditEvent } from '../services/audit-log.js'
import { AuditAction } from '@prisma/client'
import {
  isValidMedicalLeaveCertificateValue,
  MEDICAL_LEAVE_CERTIFICATE_MAX_CHARS,
} from '../medical-leaves/medical-leave-certificate.js'
import { sendWebPushPayloadToUser } from '../services/webPush.js'
import { attachRoleCode, selectOrgRoleCode } from '../identity/user-role-prisma.js'

function licenseUpdatePreview(reason: string): string {
  return reason.length > 120 ? `${reason.slice(0, 120)}…` : reason
}

const r = Router()

function myLicensesPathForRole(role: string | undefined): string {
  if (role === 'ADMIN') return '/admin/licenses'
  if (role) return '/me/licenses'
  return '/'
}

function medicalLeaveWithRoleCode<L extends { user: Parameters<typeof attachRoleCode>[0] }>(l: L) {
  return { ...l, user: attachRoleCode(l.user) }
}

const optionalCertificateCreate = z
  .string()
  .max(MEDICAL_LEAVE_CERTIFICATE_MAX_CHARS)
  .optional()

const optionalCertificateUpdate = z
  .union([z.string().max(MEDICAL_LEAVE_CERTIFICATE_MAX_CHARS), z.null()])
  .optional()

// Esquemas de validación
const medicalLeaveSchema = z.object({
  userId: z.string().uuid(),
  type: z.enum(['MEDICAL_LEAVE', 'WORK_LEAVE', 'OTHER']),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  reason: z.string().min(1).max(500),
  /** Prisma devuelve null; el cliente puede reenviar null en JSON. */
  doctorName: z.string().max(500).nullish(),
  doctorPhone: z.string().max(80).nullish(),
  notes: z.string().max(5000).nullish(),
  certificate: optionalCertificateCreate,
})

const medicalLeaveUpdateSchema = z.object({
  type: z.enum(['MEDICAL_LEAVE', 'WORK_LEAVE', 'OTHER']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  reason: z.string().min(1).max(500).optional(),
  doctorName: z.string().max(500).nullish(),
  doctorPhone: z.string().max(80).nullish(),
  notes: z.string().max(5000).nullish(),
  certificate: optionalCertificateUpdate,
})

// Obtener todas las licencias médicas (solo admin)
r.get('/all', authGuard, requirePermission('licenses.read', 'all'), async (req, res) => {
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
              ...selectOrgRoleCode,
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
      data: licenses.map((li) => medicalLeaveWithRoleCode(li)),
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
r.get('/my-leaves', authGuard, requirePermission('licenses.read'), async (req, res) => {
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
r.post('/', authGuard, requirePermission('licenses.create', 'all'), async (req, res) => {
  try {
    const parsed = medicalLeaveSchema.safeParse(req.body)
    
    if (!parsed.success) {
      return res.status(400).json({ 
        message: 'Datos inválidos',
        errors: parsed.error.errors
      })
    }

    const { userId, type, startDate, endDate, reason, doctorName, doctorPhone, notes, certificate } = parsed.data

    if (certificate && !isValidMedicalLeaveCertificateValue(certificate)) {
      return res.status(400).json({
        message: 'Certificado inválido: debe ser una URL (https://…) o un archivo imagen/PDF en base64.',
      })
    }

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
        ...(certificate ? { certificate } : {}),
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
            ...selectOrgRoleCode,
          }
        }
      }
    })

    const reconciliation = await reconcileAttendancesForMedicalLeave(license.id)

    const preview = licenseUpdatePreview(reason)
    void sendWebPushPayloadToUser(userId, {
      title: 'Edutrack — Licencia registrada',
      body: `La institución registró una licencia: ${preview}`,
      url: myLicensesPathForRole(license.user?.orgRole?.code),
    }).catch((err) => console.error('Web push (licencia creada):', err))

    void prisma.inAppNotification
      .create({
        data: {
          userId,
          type: 'LICENSE_CREATED',
          title: 'Licencia registrada',
          body: `La institución registró una licencia: ${preview}`,
          actionUrl: myLicensesPathForRole(license.user?.orgRole?.code),
        },
      })
      .catch((err) => console.error('Aviso en app (licencia creada):', err))

    recordAuditEvent({
      action: AuditAction.MEDICAL_LEAVE_CREATED,
      actorUserId: req.user?.id ?? null,
      req,
      entityType: 'MedicalLeave',
      entityId: license.id,
      metadata: { affectedUserId: userId, type: license.type },
    })

    res.status(201).json({ ...medicalLeaveWithRoleCode(license), reconciliation })
  } catch (error) {
    console.error('Error creando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Actualizar licencia médica (solo admin)
r.put('/:id', authGuard, requirePermission('licenses.update', 'all'), async (req, res) => {
  try {
    const { id } = req.params
    const parsed = medicalLeaveUpdateSchema.safeParse(req.body)
    
    if (!parsed.success) {
      return res.status(400).json({ 
        message: 'Datos inválidos',
        errors: parsed.error.errors
      })
    }

    const { type, startDate, endDate, reason, doctorName, doctorPhone, notes, certificate } = parsed.data

    if (certificate != null && certificate !== '' && !isValidMedicalLeaveCertificateValue(certificate)) {
      return res.status(400).json({
        message: 'Certificado inválido: debe ser una URL (https://…) o un archivo imagen/PDF en base64.',
      })
    }

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
        ...(doctorName !== undefined && { doctorName }),
        ...(doctorPhone !== undefined && { doctorPhone }),
        ...(notes !== undefined && { notes }),
        ...(certificate !== undefined && {
          certificate: certificate === '' || certificate === null ? null : certificate,
        }),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            ...selectOrgRoleCode,
          }
        }
      }
    })

    const reconciliation = await reconcileAttendancesForMedicalLeave(id)

    const ownerId = updatedLicense.userId
    const preview = licenseUpdatePreview(updatedLicense.reason)
    void sendWebPushPayloadToUser(ownerId, {
      title: 'Edutrack — Licencia actualizada',
      body: `La institución actualizó una licencia: ${preview}`,
      url: myLicensesPathForRole(updatedLicense.user?.orgRole?.code),
    }).catch((err) => console.error('Web push (licencia actualizada):', err))

    void prisma.inAppNotification
      .create({
        data: {
          userId: ownerId,
          type: 'LICENSE_UPDATED',
          title: 'Licencia actualizada',
          body: `La institución actualizó una licencia: ${preview}`,
          actionUrl: myLicensesPathForRole(updatedLicense.user?.orgRole?.code),
        },
      })
      .catch((err) => console.error('Aviso en app (licencia actualizada):', err))

    recordAuditEvent({
      action: AuditAction.MEDICAL_LEAVE_UPDATED,
      actorUserId: req.user?.id ?? null,
      req,
      entityType: 'MedicalLeave',
      entityId: id,
      metadata: { affectedUserId: ownerId },
    })

    res.json({ ...medicalLeaveWithRoleCode(updatedLicense), reconciliation })
  } catch (error) {
    console.error('Error actualizando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Desactivar licencia médica (solo admin)
r.delete('/:id', authGuard, requirePermission('licenses.delete', 'all'), async (req, res) => {
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

    recordAuditEvent({
      action: AuditAction.MEDICAL_LEAVE_DEACTIVATED,
      actorUserId: req.user?.id ?? null,
      req,
      entityType: 'MedicalLeave',
      entityId: id,
      metadata: { affectedUserId: license.userId },
    })

    res.json({ message: 'Licencia médica desactivada correctamente' })
  } catch (error) {
    console.error('Error desactivando licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

// Obtener licencia médica por ID
r.get('/:id', authGuard, requirePermission('licenses.read'), async (req, res) => {
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
            ...selectOrgRoleCode,
          }
        }
      }
    })

    if (!license) {
      return res.status(404).json({ message: 'Licencia médica no encontrada' })
    }

    const licenseReadScope = req.user?.id ? await userPermissionScope(req.user.id, 'licenses.read', req.user.role) : null
    if (!req.user || (licenseReadScope !== 'all' && license.userId !== req.user.id)) {
      return res.status(403).json({ message: 'No tienes permisos para ver esta licencia' })
    }

    res.json(medicalLeaveWithRoleCode(license))
  } catch (error) {
    console.error('Error obteniendo licencia médica:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
