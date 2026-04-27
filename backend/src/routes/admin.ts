import { Router } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../prisma.js'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { z } from 'zod'
import { randomBytes } from 'crypto'
import { onlyDigits, isValidUruguayanCI } from '../uruguay-ci.js'
import { validateNationalIdDocumentExpiresAtUpdate } from '../auth-profile-pure.js'
import { isDiditConfigured } from '../system-settings.js'
import { normalizePermissionId } from '../profile-permissions-defaults.js'
import {
  createCustomPermissionForRole,
  ensureDefaultProfilePermissionsIfNeeded,
  listActiveRolesMetaOrdered,
  loadProfilePermissionsStore,
  profilePermissionsResponse,
  roleHasPermissionAssignment,
  updateRolePermissionGrant,
} from '../profile-permissions-repository.js'
import { attachRoleCode, selectOrgRoleCode } from '../user-role-prisma.js'
import { normalizeOrgRoleCode, resolveRoleIdByCode, validateOrgRoleCode } from '../org-role-service.js'

const r = Router()
r.use(authGuard, requireRole('ADMIN'))

<<<<<<< HEAD
async function resolveActiveOrgRole(roleCodeRaw: string) {
  const code = roleCodeRaw.trim().toUpperCase()
  return prisma.orgRole.findFirst({ where: { code, active: true } })
=======
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
>>>>>>> 4ff420d (Make profile permissions read-only safe)
}

async function buildAdminUserUpdateData(id: string, payload: {
  role?: string
  username?: string
  nationalId?: string
  nationalIdDocumentExpiresAt?: string
  firstName?: string
  lastName?: string
  isApproved?: boolean
  isActive?: boolean
}) {
  const data: Record<string, unknown> = {}
  if (payload.role) {
    const code = normalizeOrgRoleCode(payload.role)
    validateOrgRoleCode(code)
    const rid = await resolveRoleIdByCode(code)
    if (!rid) throw new Error('UNKNOWN_ROLE_CODE')
    data.roleId = rid
  }
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

async function replyProfilePayload(res: { json: (b: unknown) => void }) {
  const rolesMeta = await listActiveRolesMetaOrdered()
  const store = await loadProfilePermissionsStore()
  res.json(profilePermissionsResponse(store, rolesMeta))
}

// --- Roles de organización (CRUD liviano para roles custom) ---
r.get('/org-roles', async (_req, res) => {
  const rows = await prisma.orgRole.findMany({
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, label: true, builtIn: true, active: true, sortOrder: true },
  })
  res.json(rows)
})

r.post('/org-roles', async (req, res) => {
  const parsed = z.object({
    code: z.string().min(2).max(48),
    label: z.string().min(2).max(80),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  try {
    const code = normalizeOrgRoleCode(parsed.data.code)
    validateOrgRoleCode(code)
    const row = await prisma.orgRole.create({
      data: {
        code,
        label: parsed.data.label.trim(),
        builtIn: false,
        active: true,
        sortOrder: 100,
      },
    })
    res.status(201).json(row)
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return res.status(409).json({ message: 'Ya existe un rol con ese código' })
    }
    if (e instanceof Error && e.message === 'INVALID_ROLE_CODE') {
      return res.status(400).json({ message: 'Código de rol inválido (usa A-Z, números y _, empieza con letra).' })
    }
    throw e
  }
})

r.patch('/org-roles/:code', async (req, res) => {
  const code = normalizeOrgRoleCode(req.params.code)
  const parsed = z.object({
    label: z.string().min(2).max(80).optional(),
    active: z.boolean().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  try {
    const existing = await prisma.orgRole.findUnique({ where: { code } })
    if (!existing) return res.status(404).json({ message: 'Rol no encontrado' })
    if (existing.builtIn && parsed.data.active === false) {
      return res.status(403).json({ message: 'No se puede desactivar un rol del sistema.' })
    }
    const row = await prisma.orgRole.update({
      where: { code },
      data: {
        ...(parsed.data.label !== undefined ? { label: parsed.data.label } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      },
    })
    res.json(row)
  } catch (e) {
    throw e
  }
})

r.delete('/org-roles/:code', async (req, res) => {
  const code = normalizeOrgRoleCode(req.params.code)
  const existing = await prisma.orgRole.findUnique({ where: { code } })
  if (!existing) return res.status(404).json({ message: 'Rol no encontrado' })
  if (existing.builtIn) return res.status(403).json({ message: 'No se puede eliminar un rol del sistema.' })
  const cnt = await prisma.user.count({ where: { roleId: existing.id } })
  if (cnt > 0) return res.status(409).json({ message: 'Hay usuarios con este rol; reasignálos antes.' })
  await prisma.orgRole.delete({ where: { id: existing.id } })
  res.json({ ok: true })
})

// Listar usuarios (paginado + filtro + búsqueda)
r.get('/users', async (req, res) => {
  const page = Number((req.query.page as string) || 1)
  const pageSize = Math.min(Number((req.query.pageSize as string) || 20), 100)
  const role = ((req.query.role as string) || '').trim().toUpperCase() || undefined
  const q = (req.query.q as string) || ''
  const and: Prisma.UserWhereInput[] = [{ NOT: { orgRole: { code: 'ADMIN' } } }]
  if (role) {
    and.push({ orgRole: { code: role } })
  }
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
  const [total, raw] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        username: true,
        ...selectOrgRoleCode,
        firstName: true,
        lastName: true,
        emailVerifiedAt: true,
        createdAt: true,
        lockUntil: true,
        nationalId: true,
        nationalIdDocumentExpiresAt: true,
        isApproved: true,
        approvedAt: true,
        isActive: true,
      },
    }),
  ])
  const data = raw.map((row) => attachRoleCode(row as Parameters<typeof attachRoleCode>[0]))
  res.json({ total, page, pageSize, data })
})

// Gestión de perfiles: tabla Permission + RolePermission (por código de OrgRole en la URL).
r.get('/profiles', async (_req, res) => {
<<<<<<< HEAD
  await ensureDefaultProfilePermissionsIfNeeded()
  return replyProfilePayload(res)
=======
  res.json(profilePermissionsResponse(cloneDefaultProfilePermissions()))
>>>>>>> 4ff420d (Make profile permissions read-only safe)
})

r.put('/profiles/:role/permissions/:permissionId', async (req, res) => {
  const exists = await resolveActiveOrgRole(req.params.role)
  if (!exists) return res.status(404).json({ message: 'Rol no encontrado' })

  const parsed = z.object({
    enabled: z.boolean().optional(),
    scope: z.enum(['own', 'all']).optional(),
    label: z.string().min(2).max(80).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

<<<<<<< HEAD
  const roleCode = exists.code
  const result = await updateRolePermissionGrant(roleCode, req.params.permissionId, parsed.data)
  if (!result) return res.status(404).json({ message: 'Permiso no encontrado' })
  return replyProfilePayload(res)
=======
  const store = cloneDefaultProfilePermissions()
  const index = store[role].findIndex((p) => p.id === req.params.permissionId)
  if (index < 0) return res.status(404).json({ message: 'Permiso no encontrado' })

  // Los permisos reales del sistema no se persisten ni se modifican desde esta pantalla.
  res.json(profilePermissionsResponse(store))
>>>>>>> 4ff420d (Make profile permissions read-only safe)
})

r.post('/profiles/:role/permissions', async (req, res) => {
  const exists = await resolveActiveOrgRole(req.params.role)
  if (!exists) return res.status(404).json({ message: 'Rol no encontrado' })

  const parsed = z.object({
    module: z.string().min(2).max(50),
    action: z.string().min(2).max(30),
    label: z.string().min(2).max(80),
    enabled: z.boolean().default(true),
    scope: z.enum(['own', 'all']).default('own'),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

<<<<<<< HEAD
  const roleCode = exists.code
  const code = normalizePermissionId(parsed.data.module, parsed.data.action)
  if (await roleHasPermissionAssignment(roleCode, code)) {
=======
  const store = cloneDefaultProfilePermissions()
  const id = normalizePermissionId(parsed.data.module, parsed.data.action)
  if (store[role].some((p) => p.id === id)) {
>>>>>>> 4ff420d (Make profile permissions read-only safe)
    return res.status(409).json({ message: 'Ese permiso ya existe para el rol' })
  }
  const created = await createCustomPermissionForRole(roleCode, {
    module: parsed.data.module,
    action: parsed.data.action,
    label: parsed.data.label,
    enabled: parsed.data.enabled,
    scope: parsed.data.scope,
  })
<<<<<<< HEAD
  if (created && 'error' in created && created.error === 'NO_ROLE') {
    return res.status(404).json({ message: 'Rol no encontrado' })
  }
  if (created && 'error' in created && created.error === 'EXISTS') {
    return res.status(409).json({ message: 'Ese permiso ya existe para el rol' })
  }
  const rolesMeta = await listActiveRolesMetaOrdered()
  const store = await loadProfilePermissionsStore()
  return res.status(201).json(profilePermissionsResponse(store, rolesMeta))
=======
  res.status(201).json(profilePermissionsResponse(store))
>>>>>>> 4ff420d (Make profile permissions read-only safe)
})

// Crear usuario
r.post('/users', async (req, res) => {
  const parsed = z
    .object({
      email: z.string().email(),
      role: z.string().min(2),
      username: z.string().min(3).max(30).optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const roleCode = normalizeOrgRoleCode(parsed.data.role)
  if (roleCode === 'ADMIN') return res.status(400).json({ message: 'Rol inválido' })

  try {
    validateOrgRoleCode(roleCode)
  } catch {
    return res.status(400).json({ message: 'Código de rol inválido' })
  }

  const roleId = await resolveRoleIdByCode(roleCode)
  if (!roleId) return res.status(400).json({ message: 'Rol no encontrado' })

  const { email, username } = parsed.data
  const exist = await prisma.user.findUnique({ where: { email } })
  if (exist) return res.status(409).json({ message: 'Email ya registrado' })
  const user = await prisma.user.create({
    data: {
      email,
      roleId,
      username,
      isApproved: true,
      approvedAt: new Date(),
      isActive: true,
    },
  })
  res.json({ id: user.id })
})

// Editar datos sensibles
r.put('/users/:id', async (req, res) => {
  const id = req.params.id
  const parsed = z
    .object({
      role: z.string().min(2).optional(),
      username: z.string().min(3).max(30).optional(),
      nationalId: z.string().min(6).max(20).optional(),
      nationalIdDocumentExpiresAt: z.string().min(8).max(40).nullable().optional(),
      firstName: z.string().min(1).max(80).optional(),
      lastName: z.string().min(1).max(80).optional(),
      isApproved: z.boolean().optional(),
      isActive: z.boolean().optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const target = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      ...selectOrgRoleCode,
    },
  })
  if (!target) return res.status(404).json({ message: 'Usuario no encontrado' })
  const targetRoleCode = target.orgRole?.code ?? ''

  const p = parsed.data
  if (targetRoleCode === 'ADMIN') {
    if (p.isActive === false) {
      return res.status(403).json({ message: 'No se puede dar de baja al usuario administrador.' })
    }
    if (p.role && normalizeOrgRoleCode(p.role) !== 'ADMIN') {
      return res.status(403).json({ message: 'No se puede cambiar el rol del administrador.' })
    }
    if (p.isApproved === false) {
      return res.status(403).json({ message: 'No se puede marcar como pendiente al usuario administrador.' })
    }
  }
  if (p.role && normalizeOrgRoleCode(p.role) === 'ADMIN' && targetRoleCode !== 'ADMIN') {
    return res.status(403).json({ message: 'No se puede promover a administrador desde esta pantalla.' })
  }

  let data: Record<string, unknown>
  try {
    data = await buildAdminUserUpdateData(id, parsed.data as Parameters<typeof buildAdminUserUpdateData>[1])
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CI') {
      return res.status(400).json({ message: 'Cédula inválida' })
    }
    if (error instanceof Error && error.message === 'INVALID_NATIONAL_ID_DOCUMENT_EXPIRES_AT') {
      return res.status(400).json({ message: 'Vencimiento de documento inválido' })
    }
    if (error instanceof Error && error.message === 'UNKNOWN_ROLE_CODE') {
      return res.status(400).json({ message: 'Rol no encontrado o inactivo' })
    }
    if (error instanceof Error && error.message === 'INVALID_ROLE_CODE') {
      return res.status(400).json({ message: 'Código de rol inválido' })
    }
    throw error
  }

  if (data.nationalId && typeof data.nationalId === 'string') {
    const other = await prisma.user.findFirst({
      where: { nationalId: data.nationalId as string, NOT: { id } },
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
      where: { username: data.username as string, NOT: { id } },
      select: { id: true },
    })
    if (other) {
      return res.status(409).json({ message: 'Ese nombre de usuario ya está en uso por otro usuario.' })
    }
  }

  try {
    await prisma.user.update({ where: { id }, data: data as Prisma.UserUpdateInput })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: messageForUniqueViolation(error) })
    }
    throw error
  }
  res.json({ ok: true })
})

r.put('/users/:id/lock', async (req, res) => {
  const id = req.params.id
  const lock = req.query.lock === 'true'
  const u = await prisma.user.findUnique({
    where: { id },
    select: selectOrgRoleCode,
  })
  if (!u) return res.status(404).json({ message: 'Usuario no encontrado' })
  const code = u.orgRole?.code ?? ''
  if (code === 'ADMIN' && lock) {
    return res.status(403).json({ message: 'No se puede bloquear al usuario administrador.' })
  }
  await prisma.user.update({
    where: { id },
    data: { lockUntil: lock ? new Date(Date.now() + 15 * 60 * 1000) : null, failedLoginAttempts: 0 },
  })
  res.json({ ok: true })
})

r.post('/users/:id/password/reset', async (req, res) => {
  const id = req.params.id
  const u = await prisma.user.findUnique({
    where: { id },
    select: selectOrgRoleCode,
  })
  if (!u) return res.status(404).json({ message: 'Usuario no encontrado' })
  if ((u.orgRole?.code ?? '') === 'ADMIN') {
    return res.status(403).json({ message: 'No se puede resetear la contraseña del administrador desde esta pantalla.' })
  }
  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)
  await prisma.passwordReset.create({ data: { token, userId: id, expiresAt } })
  res.json({ token, expiresAt })
})

r.get('/system-settings', async (_req, res) => {
  return res.json({
    diditConfigured: isDiditConfigured(),
  })
})

export default r
