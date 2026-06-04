import { Router } from 'express'
import { z } from 'zod'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import {
  getAdminTestingContext,
  isAdminTestingToolsEnabled,
  resetDatabaseToSingleAdmin,
  simulateAdmsPunchForUser,
  wipeOperationalTestingData,
} from '../services/admin-testing-tools.js'

const r = Router()
r.use(authGuard)
// Autorización unificada por permiso (no por rol): solo perfiles con
// settings.manage:all (por defecto, ADMIN) acceden a las herramientas de prueba.
r.use(requirePermission('settings.manage', 'all'))

function testingDisabled(res: any) {
  return res.status(403).json({
    message:
      'Herramientas de prueba deshabilitadas en este entorno. Definí ALLOW_ADMIN_TESTING_TOOLS=1 en el servicio auth (testing).',
  })
}

r.get('/context', async (_req, res) => {
  if (!isAdminTestingToolsEnabled()) return testingDisabled(res)
  const ctx = await getAdminTestingContext()
  return res.json(ctx)
})

const simulateSchema = z.object({
  userId: z.string().uuid(),
  deviceId: z.string().uuid(),
  punchType: z.enum(['CHECK_IN', 'CHECK_OUT']),
  timestamp: z.string().datetime().optional(),
})

r.post('/simulate-adms', async (req, res) => {
  if (!isAdminTestingToolsEnabled()) return testingDisabled(res)

  const parsed = simulateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })
  }

  try {
    const { result, device, mapping, occurredAt } = await simulateAdmsPunchForUser({
      userId: parsed.data.userId,
      deviceId: parsed.data.deviceId,
      punchType: parsed.data.punchType,
      occurredAt: parsed.data.timestamp ? new Date(parsed.data.timestamp) : undefined,
    })

    if (result.ok === false) {
      if (result.reason === 'NO_MAPPING') {
        return res.status(422).json({ message: 'Sin mapeo biométrico para el PIN del lector', punchId: result.punchId })
      }
      return res.status(403).json({
        message: 'Marcación bloqueada por licencia médica activa',
        punchId: result.punchId,
      })
    }

    return res.status(result.duplicate ? 200 : 201).json({
      message: result.duplicate
        ? 'Marcación duplicada (idempotencia ADMS)'
        : `Marcación ${parsed.data.punchType === 'CHECK_IN' ? 'entrada' : 'salida'} procesada`,
      duplicate: result.duplicate,
      punchId: result.punchId,
      attendanceId: result.attendanceId,
      isLate: result.isLate,
      attendance: result.attendance,
      device: { id: device.id, code: device.code },
      deviceUserId: mapping.deviceUserId,
      occurredAt: occurredAt.toISOString(),
    })
  } catch (error: any) {
    if (error?.message === 'DEVICE_NOT_FOUND') {
      return res.status(404).json({ message: 'Lector biométrico no encontrado o inactivo' })
    }
    if (error?.message === 'USER_NOT_FOUND') {
      return res.status(404).json({ message: 'Usuario no encontrado o inactivo' })
    }
    console.error('simulate-adms error:', error)
    return res.status(500).json({ message: 'Error simulando marcación ADMS' })
  }
})

const wipeSchema = z.object({
  confirm: z.literal('LIMPIAR'),
})

r.post('/wipe-operational', async (req, res) => {
  if (!isAdminTestingToolsEnabled()) return testingDisabled(res)

  const parsed = wipeSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Confirmación inválida. Escribí LIMPIAR en el campo confirm.' })
  }

  await wipeOperationalTestingData()
  return res.json({
    message: 'Datos operativos eliminados. Usuarios, roles y lectores conservados.',
  })
})

const resetSchema = z.object({
  confirm: z.literal('BORRAR TODO'),
})

r.post('/reset-all', async (req, res) => {
  if (!isAdminTestingToolsEnabled()) return testingDisabled(res)

  const parsed = resetSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Confirmación inválida. Escribí BORRAR TODO en el campo confirm.' })
  }

  const { admin, schoolYear, password } = await resetDatabaseToSingleAdmin()
  return res.json({
    message: 'Base reiniciada: solo queda el usuario administrador.',
    admin: {
      id: admin.id,
      username: admin.username,
      email: admin.email,
      password,
    },
    schoolYear: { id: schoolYear.id, code: schoolYear.code, label: schoolYear.label },
  })
})

export default r
