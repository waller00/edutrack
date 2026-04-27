import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { onlyDigits, isValidUruguayanCI } from '../uruguay-ci.js'
import { validateNationalIdDocumentExpiresAtUpdate } from '../auth-profile-pure.js'
import { getOrCreateSystemSettings, isDiditConfigured } from '../system-settings.js'

const r = Router()
r.use(authGuard, requireRole('ADMIN'))

async function buildAdminUserUpdateData(id: string, payload: {
  role?: 'ADMIN'|'STAFF'|'TEACHER'
  username?: string
  nationalId?: string
  nationalIdDocumentExpiresAt?: string
  firstName?: string
  lastName?: string
  isApproved?: boolean
  isActive?: boolean
}) {
  const data: any = {}
  if (payload.role) data.role = payload.role
  if (payload.username) data.username = payload.username
  if (payload.firstName) data.firstName = payload.firstName
  if (payload.lastName) data.lastName = payload.lastName
  if (payload.firstName || payload.lastName) {
    const current = await prisma.user.findUnique({ where: { id }, select: { firstName: true, lastName: true } })
    const firstName = payload.firstName ?? current?.firstName ?? ''
    const lastName = payload.lastName ?? current?.lastName ?? ''
    data.name = `${firstName} ${lastName}`.trim()
  }
  if (payload.nationalId) {
    if (!isValidUruguayanCI(payload.nationalId)) throw new Error('INVALID_CI')
    data.nationalId = onlyDigits(payload.nationalId)
  }
  if (payload.nationalIdDocumentExpiresAt !== undefined) {
    data.nationalIdDocumentExpiresAt = validateNationalIdDocumentExpiresAtUpdate(payload.nationalIdDocumentExpiresAt) ?? null
  }
  if (typeof payload.isApproved === 'boolean') {
    data.isApproved = payload.isApproved
    data.approvedAt = payload.isApproved ? new Date() : null
  }
  if (typeof payload.isActive === 'boolean') {
    data.isActive = payload.isActive
  }
  return data
}

function messageForUniqueViolation(err: Prisma.PrismaClientKnownRequestError): string {
  const raw = err.meta?.target as string | string[] | undefined
  const parts = Array.isArray(raw) ? raw.map(String) : raw != null ? [String(raw)] : []
  const joined = parts.join(' ')
  if (joined.includes('nationalId')) {
    return 'Esa cédula ya está asignada a otro usuario. Quitá la cédula del otro usuario primero o usá una cédula distinta.'
  }
  if (joined.includes('username')) {
    return 'Ese nombre de usuario ya está en uso por otro usuario.'
  }
  if (joined.includes('email')) {
    return 'Ese email ya está registrado en otro usuario.'
  }
  return 'Ese dato ya existe en otro usuario (restricción única en la base).'
}

// Listar usuarios (paginado + filtro + búsqueda)
r.get('/users', async (req, res) => {
  const page = Number((req.query.page as string) || 1)
  const pageSize = Math.min(Number((req.query.pageSize as string) || 20), 100)
  const role = (req.query.role as string) || undefined
  const q = (req.query.q as string) || ''
  const and: Prisma.UserWhereInput[] = [{ NOT: { role: 'ADMIN' } }]
  if (role === 'STAFF' || role === 'TEACHER') and.push({ role })
  if (q) {
    and.push({
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
      ],
    })
  }
  const where: Prisma.UserWhereInput = { AND: and }
  const [total, data] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({ where, skip: (page-1)*pageSize, take: pageSize, orderBy: { createdAt: 'desc' }, select: { id:true, email:true, username:true, role:true, firstName:true, lastName:true, emailVerifiedAt:true, createdAt:true, lockUntil:true, nationalId:true, nationalIdDocumentExpiresAt:true, isApproved:true, approvedAt:true, isActive:true } })
  ])
  res.json({ total, page, pageSize, data })
})

// Crear usuario
r.post('/users', async (req, res) => {
  const parsed = z.object({ email: z.string().email(), role: z.enum(['STAFF','TEACHER']), username: z.string().min(3).max(30).optional() }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const { email, role, username } = parsed.data
  const exist = await prisma.user.findUnique({ where: { email } })
  if (exist) return res.status(409).json({ message: 'Email ya registrado' })
  const user = await prisma.user.create({ data: { email, role, username, isApproved: true, approvedAt: new Date(), isActive: true } })
  res.json({ id: user.id })
})

// Editar datos sensibles
r.put('/users/:id', async (req, res) => {
  const id = req.params.id
  const parsed = z.object({
    role: z.enum(['ADMIN','STAFF','TEACHER']).optional(),
    username: z.string().min(3).max(30).optional(),
    nationalId: z.string().min(6).max(20).optional(),
    nationalIdDocumentExpiresAt: z.string().min(8).max(40).nullable().optional(),
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    isApproved: z.boolean().optional(),
    isActive: z.boolean().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, firstName: true, lastName: true },
  })
  if (!target) return res.status(404).json({ message: 'Usuario no encontrado' })
  const p = parsed.data
  if (target.role === 'ADMIN') {
    if (p.isActive === false) {
      return res.status(403).json({ message: 'No se puede dar de baja al usuario administrador.' })
    }
    if (p.role && p.role !== 'ADMIN') {
      return res.status(403).json({ message: 'No se puede cambiar el rol del administrador.' })
    }
    if (p.isApproved === false) {
      return res.status(403).json({ message: 'No se puede marcar como pendiente al usuario administrador.' })
    }
  }
  if (p.role === 'ADMIN' && target.role !== 'ADMIN') {
    return res.status(403).json({ message: 'No se puede promover a administrador desde esta pantalla.' })
  }
  let data: any
  try {
    data = await buildAdminUserUpdateData(id, parsed.data)
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CI') {
      return res.status(400).json({ message: 'Cédula inválida' })
    }
    if (error instanceof Error && error.message === 'INVALID_NATIONAL_ID_DOCUMENT_EXPIRES_AT') {
      return res.status(400).json({ message: 'Vencimiento de documento inválido' })
    }
    throw error
  }

  if (data.nationalId && typeof data.nationalId === 'string') {
    const other = await prisma.user.findFirst({
      where: { nationalId: data.nationalId, NOT: { id } },
      select: { id: true },
    })
    if (other) {
      return res.status(409).json({
        message:
          'Esa cédula ya está asignada a otro usuario. Quitá la cédula del otro usuario primero o usá una cédula distinta.',
      })
    }
  }
  if (data.username && typeof data.username === 'string') {
    const other = await prisma.user.findFirst({
      where: { username: data.username, NOT: { id } },
      select: { id: true },
    })
    if (other) {
      return res.status(409).json({ message: 'Ese nombre de usuario ya está en uso por otro usuario.' })
    }
  }

  try {
    await prisma.user.update({ where: { id }, data })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: messageForUniqueViolation(error) })
    }
    throw error
  }
  res.json({ ok: true })
})

// Lock / Unlock
r.put('/users/:id/lock', async (req, res) => {
  const id = req.params.id
  const lock = req.query.lock === 'true'
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true } })
  if (!u) return res.status(404).json({ message: 'Usuario no encontrado' })
  if (u.role === 'ADMIN' && lock) {
    return res.status(403).json({ message: 'No se puede bloquear al usuario administrador.' })
  }
  await prisma.user.update({ where: { id }, data: { lockUntil: lock ? new Date(Date.now()+15*60*1000) : null, failedLoginAttempts: 0 } })
  res.json({ ok: true })
})

// Reset password: genera token de reset y lo retorna (para ahora; en prod enviar email)
r.post('/users/:id/password/reset', async (req, res) => {
  const id = req.params.id
  const u = await prisma.user.findUnique({ where: { id }, select: { role: true } })
  if (!u) return res.status(404).json({ message: 'Usuario no encontrado' })
  if (u.role === 'ADMIN') {
    return res.status(403).json({ message: 'No se puede resetear la contraseña del administrador desde esta pantalla.' })
  }
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now()+15*60*1000)
  await prisma.passwordReset.create({ data: { token, userId: id, expiresAt } })
  res.json({ token, expiresAt })
})

// Requisito de prueba de vida (Didit) en el registro
r.get('/system-settings', async (_req, res) => {
  const s = await getOrCreateSystemSettings()
  return res.json({
    livenessCheckEnabled: s.livenessCheckEnabled,
    diditConfigured: isDiditConfigured(),
  })
})

r.put('/system-settings', async (req, res) => {
  const parsed = z
    .object({ livenessCheckEnabled: z.boolean() })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  if (parsed.data.livenessCheckEnabled && !isDiditConfigured()) {
    return res.status(400).json({
      message:
        'Configurá DIDIT_API_KEY y DIDIT_WORKFLOW_ID en el servidor antes de exigir prueba de vida.',
    })
  }
  const s = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: { id: 'default', livenessCheckEnabled: parsed.data.livenessCheckEnabled },
    update: { livenessCheckEnabled: parsed.data.livenessCheckEnabled },
  })
  return res.json({
    livenessCheckEnabled: s.livenessCheckEnabled,
    diditConfigured: isDiditConfigured(),
  })
})

export default r 
