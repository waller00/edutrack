import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import { onlyDigits, isValidUruguayanCI } from '../uruguay-ci.js'
import { validateNationalIdDocumentExpiresAtUpdate } from '../auth-profile-pure.js'

const r = Router()
r.use(authGuard, requireRole('ADMIN'))

const ROLE_LABELS = {
  ADMIN: 'Administrador',
  TEACHER: 'Tutor',
  STAFF: 'Staff',
} as const

const DEFAULT_PROFILE_PERMISSIONS = {
  ADMIN: [
    permission('users.read', 'Usuarios', 'read', 'Ver usuarios', true, 'all'),
    permission('users.create', 'Usuarios', 'create', 'Crear usuarios', true, 'all'),
    permission('users.update', 'Usuarios', 'update', 'Editar usuarios', true, 'all'),
    permission('users.security', 'Usuarios', 'security', 'Bloquear usuarios y resetear contraseñas', true, 'all'),
    permission('attendance.read', 'Asistencias', 'read', 'Ver asistencias', true, 'all'),
    permission('attendance.update', 'Asistencias', 'update', 'Editar asistencias', true, 'all'),
    permission('attendance.delete', 'Asistencias', 'delete', 'Eliminar asistencias', true, 'all'),
    permission('attendance.biometric', 'Asistencias', 'biometric', 'Registrar asistencia biométrica', true, 'all'),
    permission('events.read', 'Eventos', 'read', 'Ver eventos', true, 'all'),
    permission('events.create', 'Eventos', 'create', 'Crear eventos', true, 'all'),
    permission('events.update', 'Eventos', 'update', 'Editar eventos', true, 'all'),
    permission('events.cancel', 'Eventos', 'cancel', 'Cancelar eventos', true, 'all'),
    permission('events.delete', 'Eventos', 'delete', 'Eliminar eventos', true, 'all'),
    permission('licenses.read', 'Licencias', 'read', 'Ver licencias', true, 'all'),
    permission('licenses.create', 'Licencias', 'create', 'Crear licencias', true, 'all'),
    permission('licenses.update', 'Licencias', 'update', 'Editar licencias', true, 'all'),
    permission('licenses.delete', 'Licencias', 'delete', 'Desactivar licencias', true, 'all'),
    permission('analytics.read', 'Analytics', 'read', 'Ver analytics', true, 'all'),
    permission('reports.read', 'Reportes', 'read', 'Ver reportes', true, 'all'),
    permission('exports.create', 'Exportaciones', 'create', 'Crear exportaciones', true, 'all'),
    permission('profiles.manage', 'Perfiles', 'manage', 'Gestionar perfiles', true, 'all'),
  ],
  TEACHER: [
    permission('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    permission('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    permission('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    permission('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
  ],
  STAFF: [
    permission('attendance.read', 'Asistencias', 'read', 'Ver mis asistencias', true, 'own'),
    permission('events.read', 'Eventos', 'read', 'Ver mis eventos', true, 'own'),
    permission('licenses.read', 'Licencias', 'read', 'Ver mis licencias', true, 'own'),
    permission('notifications.read', 'Notificaciones', 'read', 'Ver mis notificaciones', true, 'own'),
  ],
} as const

const REMOVED_PROFILE_PERMISSION_IDS: Record<ProfileRole, Set<string>> = {
  ADMIN: new Set(['licenses.approve']),
  TEACHER: new Set(['attendance.create', 'events.create', 'events.update', 'licenses.create']),
  STAFF: new Set(['attendance.create', 'licenses.create']),
}

type ProfileRole = keyof typeof DEFAULT_PROFILE_PERMISSIONS
type ProfilePermission = {
  id: string
  module: string
  action: string
  label: string
  enabled: boolean
  scope: 'own' | 'all'
}
type ProfilePermissionsStore = Record<ProfileRole, ProfilePermission[]>

function permission(
  id: string,
  module: string,
  action: string,
  label: string,
  enabled: boolean,
  scope: 'own' | 'all',
): ProfilePermission {
  return { id, module, action, label, enabled, scope }
}

function cloneDefaultProfilePermissions(): ProfilePermissionsStore {
  return {
    ADMIN: DEFAULT_PROFILE_PERMISSIONS.ADMIN.map((p) => ({ ...p })),
    TEACHER: DEFAULT_PROFILE_PERMISSIONS.TEACHER.map((p) => ({ ...p })),
    STAFF: DEFAULT_PROFILE_PERMISSIONS.STAFF.map((p) => ({ ...p })),
  }
}

function systemPermissionIds(role: ProfileRole): Set<string> {
  return new Set(DEFAULT_PROFILE_PERMISSIONS[role].map((p) => p.id))
}

function normalizeRolePermissions(role: ProfileRole, stored: unknown): ProfilePermission[] {
  const defaults = cloneDefaultProfilePermissions()[role]
  if (!Array.isArray(stored)) return defaults

  const defaultIds = systemPermissionIds(role)
  const removedIds = REMOVED_PROFILE_PERMISSION_IDS[role]
  const allowedStored = stored.filter((p): p is ProfilePermission => {
    if (!p || typeof p !== 'object') return false
    const id = (p as { id?: unknown }).id
    if (typeof id !== 'string') return false
    return !removedIds.has(id) && !defaultIds.has(id)
  })

  return [...defaults, ...allowedStored]
}

function getProfilePermissionsPath() {
  return process.env.PROFILE_PERMISSIONS_FILE || path.join(process.cwd(), 'data', 'profile-permissions.json')
}

function normalizePermissionId(module: string, action: string) {
  const clean = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  return `${clean(module)}.${clean(action)}`
}

async function readProfilePermissions(): Promise<ProfilePermissionsStore> {
  const defaults = cloneDefaultProfilePermissions()
  try {
    const raw = await readFile(getProfilePermissionsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<ProfilePermissionsStore>
    return {
      ADMIN: normalizeRolePermissions('ADMIN', parsed.ADMIN),
      TEACHER: normalizeRolePermissions('TEACHER', parsed.TEACHER),
      STAFF: normalizeRolePermissions('STAFF', parsed.STAFF),
    }
  } catch {
    return defaults
  }
}

async function writeProfilePermissions(store: ProfilePermissionsStore) {
  const target = getProfilePermissionsPath()
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
}

function profilePermissionsResponse(store: ProfilePermissionsStore) {
  return {
    roles: (Object.keys(ROLE_LABELS) as ProfileRole[]).map((role) => ({
      role,
      label: ROLE_LABELS[role],
      permissions: store[role].map((permission) => ({
        ...permission,
        source: systemPermissionIds(role).has(permission.id) ? 'system' : 'custom',
      })),
    })),
  }
}

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

// Gestión administrativa de perfiles.
// Esta matriz es editable para documentación/configuración, pero no altera los guards por rol existentes.
r.get('/profiles', async (_req, res) => {
  const store = await readProfilePermissions()
  res.json(profilePermissionsResponse(store))
})

r.put('/profiles/:role/permissions/:permissionId', async (req, res) => {
  const role = req.params.role as ProfileRole
  if (!ROLE_LABELS[role]) return res.status(404).json({ message: 'Rol no encontrado' })
  const parsed = z.object({
    enabled: z.boolean().optional(),
    scope: z.enum(['own', 'all']).optional(),
    label: z.string().min(2).max(80).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

  const store = await readProfilePermissions()
  const index = store[role].findIndex((p) => p.id === req.params.permissionId)
  if (index < 0) return res.status(404).json({ message: 'Permiso no encontrado' })

  store[role][index] = { ...store[role][index], ...parsed.data }
  await writeProfilePermissions(store)
  res.json(profilePermissionsResponse(store))
})

r.post('/profiles/:role/permissions', async (req, res) => {
  const role = req.params.role as ProfileRole
  if (!ROLE_LABELS[role]) return res.status(404).json({ message: 'Rol no encontrado' })
  const parsed = z.object({
    module: z.string().min(2).max(50),
    action: z.string().min(2).max(30),
    label: z.string().min(2).max(80),
    enabled: z.boolean().default(true),
    scope: z.enum(['own', 'all']).default('own'),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

  const store = await readProfilePermissions()
  const id = normalizePermissionId(parsed.data.module, parsed.data.action)
  if (store[role].some((p) => p.id === id)) {
    return res.status(409).json({ message: 'Ese permiso ya existe para el rol' })
  }
  store[role].push({
    id,
    module: parsed.data.module,
    action: parsed.data.action,
    label: parsed.data.label,
    enabled: parsed.data.enabled,
    scope: parsed.data.scope,
  })
  await writeProfilePermissions(store)
  res.status(201).json(profilePermissionsResponse(store))
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

export default r 
