import { Router } from 'express'
import { Prisma, AuditAction } from '@prisma/client'
import { prisma } from '../db/prisma.js'
import { authGuard, requirePermission } from '../middlewares/auth.js'
import { z } from 'zod'
import { onlyDigits, isValidUruguayanCI } from '../identity/uruguay-ci.js'
import { isDiditConfigured, isMoodleSyncEnabledFromEnv, getMoodleOperationalSettings } from '../config/system-settings.js'
import { getOrCreateSystemSettings } from '../config/system-settings.js'
import {
  INSTITUTION_TIMEZONE_OPTIONS,
  isValidInstitutionTimezone,
  normalizeInstitutionTimezone,
  refreshInstitutionTimezoneCache,
} from '../config/institution-timezone.js'
import { normalizePermissionId } from '../identity/profile-permissions-defaults.js'
import {
  createProfileRoleWithPermissions,
  createCustomPermissionForRole,
  ensureDefaultProfilePermissionsIfNeeded,
  listActiveRolesMetaOrdered,
  listPermissionCatalog,
  loadProfilePermissionsStore,
  profilePermissionsResponse,
  replaceRolePermissionGrants,
  roleHasPermissionAssignment,
  updateRolePermissionGrant,
} from '../identity/profile-permissions-repository.js'
import { attachRoleCode, selectOrgRoleCode } from '../identity/user-role-prisma.js'
import { normalizeOrgRoleCode, resolveRoleIdByCode, validateOrgRoleCode } from '../identity/org-role-service.js'
import {
  AUDIT_ACTION_LABELS,
  getAuditActionCatalog,
  parseAuditActionFilter,
  recordAuditEvent,
} from '../services/audit-log.js'
import { runAdminQueryAssistant } from '../services/query-assistant/run.js'
import { resolveSchoolYearIdForList } from '../services/school-year-service.js'
import { ensureMoodleUserById } from '../services/moodle.js'
import {
  getMoodleHealthStatus,
  isMoodleIntegrationEnabled,
  reconcileMoodle,
} from '../integrations/moodle/index.js'
import { createKeycloakUser, deleteKeycloakUserByEmail, syncKeycloakUserIdentityByEmail } from '../auth/keycloak.js'
import { deleteSessionsForUser } from '../auth/session-store.js'
import { usernameSchema } from '../auth/account-validation.js'
import { firstZodIssueMessage } from '../auth/password-policy.js'
import adminStudentsRoutes from './admin-students.js'
import adminSchoolYearsRoutes from './admin-school-years.js'

const r = Router()
r.use(authGuard)

async function resolveActiveOrgRole(roleCodeRaw: string) {
  const code = roleCodeRaw.trim().toUpperCase()
  return prisma.orgRole.findFirst({ where: { code, active: true } })
}

async function buildAdminUserUpdateData(id: string, payload: {
  role?: string
  username?: string
  nationalId?: string
  firstName?: string
  lastName?: string
  isApproved?: boolean
  isActive?: boolean
  emailVerified?: boolean
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
  if (typeof payload.isApproved === 'boolean') {
    data.isApproved = payload.isApproved
    if (!payload.isApproved) {
      data.approvedAt = null
    } else {
      const cur = await prisma.user.findUnique({
        where: { id },
        select: { isApproved: true },
      })
      if (!cur?.isApproved) {
        data.approvedAt = new Date()
      }
    }
  }
  if (typeof payload.isActive === 'boolean') {
    data.isActive = payload.isActive
  }
  if (typeof payload.emailVerified === 'boolean') {
    if (payload.emailVerified) {
      // Si ya estaba verificado, conservar la fecha original; si no, marcar ahora.
      const cur = await prisma.user.findUnique({ where: { id }, select: { emailVerifiedAt: true } })
      data.emailVerifiedAt = cur?.emailVerifiedAt ?? new Date()
    } else {
      data.emailVerifiedAt = null
    }
  }
  return data
}

/** Nombres semánticos para auditoría (alineados con la UI). */
const USER_AUDIT_FIELD_ALIASES: Record<string, string> = {
  roleId: 'role',
}

function nationalIdComparable(raw: unknown): string {
  if (raw == null || raw === '') return ''
  return onlyDigits(String(raw))
}

function dateComparableMs(raw: unknown): number | null {
  if (raw == null) return null
  if (raw instanceof Date) {
    const t = raw.getTime()
    return Number.isNaN(t) ? null : t
  }
  if (typeof raw === 'string' || typeof raw === 'number') {
    const t = new Date(raw).getTime()
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** Solo campos cuyo valor en `data` difiere del usuario en BD (el front suele mandar el formulario completo). */
function computeAuditUserFieldsChanged(
  before: {
    roleId?: string | null
    username?: string | null
    firstName?: string | null
    lastName?: string | null
    name?: string | null
    nationalId?: string | null
    nationalIdDocumentExpiresAt?: Date | string | null
    emailVerifiedAt?: Date | string | null
    isApproved?: boolean | null
    approvedAt?: Date | string | null
    isActive?: boolean | null
  },
  data: Record<string, unknown>,
): string[] {
  const out: string[] = []
  for (const key of Object.keys(data)) {
    const newVal = data[key]
    const oldVal = (before as Record<string, unknown>)[key]
    let changed = false
    switch (key) {
      case 'nationalId':
        changed = nationalIdComparable(oldVal) !== nationalIdComparable(newVal)
        break
      case 'nationalIdDocumentExpiresAt':
      case 'emailVerifiedAt':
      case 'approvedAt':
        changed = dateComparableMs(oldVal) !== dateComparableMs(newVal)
        break
      case 'isApproved':
      case 'isActive':
        changed = Boolean(oldVal) !== Boolean(newVal)
        break
      default:
        if (newVal === undefined) continue
        changed = String(oldVal ?? '') !== String(newVal ?? '')
    }
    if (changed) out.push(USER_AUDIT_FIELD_ALIASES[key] ?? key)
  }
  return out
}

function messageForUniqueViolation(err: Prisma.PrismaClientKnownRequestError): string {
  const raw = err.meta?.target as string | string[] | undefined
  let parts: string[] = []
  if (Array.isArray(raw)) parts = raw.map(String)
  else if (raw != null) parts = [String(raw)]
  const joined = parts.join(' ')
  if (joined.includes('nationalId')) {
    return 'Esa cédula ya está asignada a otro usuario. Quitá la cédula del otro usuario primero o usá una cédula distinta.'
  }
  if (joined.includes('username')) {
    return 'Ese nombre de usuario ya está en uso por otro usuario.'
  }
  if (joined.includes('email')) {
    return 'Ese correo ya está registrado en otro usuario.'
  }
  return 'Ese dato ya existe en otro usuario (restricción única en la base).'
}

async function buildProfilePayload() {
  const rolesMeta = await listActiveRolesMetaOrdered()
  const store = await loadProfilePermissionsStore()
  const permissionCatalog = await listPermissionCatalog()
  return { ...profilePermissionsResponse(store, rolesMeta), permissionCatalog }
}

async function replyProfilePayload(res: { json: (b: unknown) => void }) {
  res.json(await buildProfilePayload())
}

// --- Roles de organización (CRUD liviano para roles custom) ---
r.get('/org-roles', requirePermission('profiles.manage', 'all'), async (_req, res) => {
  const rows = await prisma.orgRole.findMany({
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { id: true, code: true, label: true, builtIn: true, active: true, sortOrder: true },
  })
  res.json(rows)
})

r.post('/org-roles', requirePermission('profiles.manage', 'all'), async (req, res) => {
  const parsed = z.object({
    code: z.string().min(2).max(48),
    label: z.string().min(2).max(80),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) })
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

r.patch('/org-roles/:code', requirePermission('profiles.manage', 'all'), async (req, res) => {
  const code = normalizeOrgRoleCode(req.params.code)
  const parsed = z.object({
    label: z.string().min(2).max(80).optional(),
    active: z.boolean().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) })
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

r.delete('/org-roles/:code', requirePermission('profiles.manage', 'all'), async (req, res) => {
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
r.get('/users', requirePermission('users.read', 'all'), async (req, res) => {
  const page = Number((req.query.page as string) || 1)
  const pageSize = Math.min(Number((req.query.pageSize as string) || 20), 100)
  const role = ((req.query.role as string) || '').trim().toUpperCase() || undefined
  const q = (req.query.q as string) || ''
  const approved = (req.query.approved as string) || ''
  const active = (req.query.active as string) || ''
  const verified = (req.query.verified as string) || ''
  const locked = (req.query.locked as string) || ''
  const docExpiring = (req.query.docExpiring as string) || ''

  const and: Prisma.UserWhereInput[] = [{ NOT: { orgRole: { code: 'ADMIN' } } }]
  if (role) {
    and.push({ orgRole: { code: role } })
  }
  if (q.trim()) {
    const term = q.trim()
    const orFields: Prisma.UserWhereInput[] = [
      { email: { contains: term, mode: 'insensitive' } },
      { username: { contains: term, mode: 'insensitive' } },
      { firstName: { contains: term, mode: 'insensitive' } },
      { lastName: { contains: term, mode: 'insensitive' } },
      { name: { contains: term, mode: 'insensitive' } },
    ]
    const idDigits = term.replace(/\D/g, '')
    if (idDigits.length >= 4) {
      orFields.push({ nationalId: { contains: idDigits, mode: 'insensitive' } })
    }
    and.push({ OR: orFields })
  }
  if (approved === 'true') and.push({ isApproved: true })
  if (approved === 'false') and.push({ isApproved: false })
  if (active === 'true') and.push({ isActive: true })
  if (active === 'false') and.push({ isActive: false })
  if (verified === 'true') and.push({ emailVerifiedAt: { not: null } })
  if (verified === 'false') and.push({ emailVerifiedAt: null })

  const now = new Date()
  if (locked === 'true') {
    and.push({ lockUntil: { gt: now } })
  }
  if (locked === 'false') {
    and.push({ OR: [{ lockUntil: null }, { lockUntil: { lte: now } }] })
  }
  if (docExpiring === 'true') {
    const horizon = new Date(now)
    horizon.setUTCDate(horizon.getUTCDate() + 90)
    and.push({
      nationalIdDocumentExpiresAt: { not: null, gte: now, lte: horizon },
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
        biometricMappings: {
          where: { isActive: true },
          select: { id: true },
          take: 1,
        },
      },
    }),
  ])
  const data = raw.map((row) => {
    const withRole = attachRoleCode(row as Parameters<typeof attachRoleCode>[0])
    const biometricLinked = Array.isArray(withRole.biometricMappings) && withRole.biometricMappings.length > 0
    const { biometricMappings: _biometricMappings, ...rest } = withRole
    return { ...rest, biometricLinked }
  })
  res.json({ total, page, pageSize, data })
})

// Gestión de perfiles: tabla Permission + RolePermission (por código de OrgRole en la URL).
r.get('/profiles', requirePermission('profiles.manage', 'all'), async (_req, res) => {
  await ensureDefaultProfilePermissionsIfNeeded()
  return replyProfilePayload(res)
})

type ProfileGrantInput = {
  id: string
  enabled: boolean
  scope?: 'own' | 'all'
  label?: string
}

const profileGrantSchema = z.object({
  id: z.string().min(2).max(120),
  enabled: z.boolean(),
  scope: z.enum(['own', 'all']).optional(),
  label: z.string().min(1).max(80).optional(),
})

function profileGrantsFromBody(grants: Array<z.infer<typeof profileGrantSchema>>): ProfileGrantInput[] {
  return grants.map((grant) => ({
    id: grant.id,
    enabled: grant.enabled,
    ...(grant.scope !== undefined ? { scope: grant.scope } : {}),
    ...(grant.label !== undefined ? { label: grant.label } : {}),
  }))
}

r.post('/profiles', requirePermission('profiles.manage', 'all'), async (req, res) => {
  await ensureDefaultProfilePermissionsIfNeeded()
  const parsed = z.object({
    code: z.string().min(2).max(48),
    label: z.string().min(2).max(80),
    permissions: z.array(profileGrantSchema).default([]),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) })

  const code = normalizeOrgRoleCode(parsed.data.code)
  try {
    validateOrgRoleCode(code)
  } catch {
    return res.status(400).json({ message: 'Código de perfil inválido (usa A-Z, números y _, empieza con letra).' })
  }

  if (['ADMIN', 'TEACHER', 'STAFF'].includes(code)) {
    return res.status(409).json({ message: 'Ese perfil ya existe' })
  }

  const created = await createProfileRoleWithPermissions({
    code,
    label: parsed.data.label,
    grants: profileGrantsFromBody(parsed.data.permissions),
  })
  if (created && 'error' in created && created.error === 'EXISTS') {
    return res.status(409).json({ message: 'Ese perfil ya existe' })
  }
  if (created && 'error' in created && created.error === 'NO_PERMISSION') {
    return res.status(400).json({ message: 'Hay permisos inválidos en la selección' })
  }

  return res.status(201).json(await buildProfilePayload())
})

// No invalidamos sesiones al editar la matriz: los permisos se evalúan en vivo
// contra la BD en cada request (requirePermission → userPermissionScope) y en cada
// GET /auth/me, así que el cambio tiene efecto inmediato. Solo el cambio de rol del
// usuario invalida sesión, porque ahí sí se cachea `session.role`.
r.put('/profiles/:role/permissions', requirePermission('profiles.manage', 'all'), async (req, res) => {
  await ensureDefaultProfilePermissionsIfNeeded()
  const exists = await resolveActiveOrgRole(req.params.role)
  if (!exists) return res.status(404).json({ message: 'Rol no encontrado' })

  const parsed = z.object({
    permissions: z.array(profileGrantSchema),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) })

  const updated = await replaceRolePermissionGrants(exists.code, profileGrantsFromBody(parsed.data.permissions))
  if (updated && 'error' in updated && updated.error === 'NO_ROLE') {
    return res.status(404).json({ message: 'Rol no encontrado' })
  }
  if (updated && 'error' in updated && updated.error === 'NO_PERMISSION') {
    return res.status(400).json({ message: 'Hay permisos inválidos en la selección' })
  }

  return replyProfilePayload(res)
})

r.put('/profiles/:role/permissions/:permissionId', requirePermission('profiles.manage', 'all'), async (req, res) => {
  const exists = await resolveActiveOrgRole(req.params.role)
  if (!exists) return res.status(404).json({ message: 'Rol no encontrado' })

  const parsed = z.object({
    enabled: z.boolean().optional(),
    scope: z.enum(['own', 'all']).optional(),
    label: z.string().min(2).max(80).optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

  const roleCode = exists.code
  const result = await updateRolePermissionGrant(roleCode, req.params.permissionId, parsed.data)
  if (!result) return res.status(404).json({ message: 'Permiso no encontrado' })
  return replyProfilePayload(res)
})

r.post('/profiles/:role/permissions', requirePermission('profiles.manage', 'all'), async (req, res) => {
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

  const roleCode = exists.code
  const code = normalizePermissionId(parsed.data.module, parsed.data.action)
  if (await roleHasPermissionAssignment(roleCode, code)) {
    return res.status(409).json({ message: 'Ese permiso ya existe para el rol' })
  }
  const created = await createCustomPermissionForRole(roleCode, {
    module: parsed.data.module,
    action: parsed.data.action,
    label: parsed.data.label,
    enabled: parsed.data.enabled,
    scope: parsed.data.scope,
  })
  if (created && 'error' in created && created.error === 'NO_ROLE') {
    return res.status(404).json({ message: 'Rol no encontrado' })
  }
  if (created && 'error' in created && created.error === 'EXISTS') {
    return res.status(409).json({ message: 'Ese permiso ya existe para el rol' })
  }
  const rolesMeta = await listActiveRolesMetaOrdered()
  const store = await loadProfilePermissionsStore()
  return res.status(201).json(profilePermissionsResponse(store, rolesMeta))
})

// Crear usuario
r.post('/users', requirePermission('users.create', 'all'), async (req, res) => {
  const parsed = z
    .object({
      email: z.string().email(),
      role: z.string().min(2),
      username: usernameSchema.optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) })
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
  if (exist) return res.status(409).json({ message: 'Correo ya registrado' })
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
  try {
    await createKeycloakUser({
      email,
      username,
      role: roleCode,
      emailVerified: false,
    })
  } catch (e) {
    console.error('[admin] keycloak create user:', e)
    return res.status(502).json({ message: 'Usuario local creado, pero no se pudo activar el acceso.' })
  }
  recordAuditEvent({
    action: AuditAction.USER_CREATED_BY_ADMIN,
    actorUserId: (req as any).user?.id ?? null,
    req,
    entityType: 'User',
    entityId: user.id,
    metadata: { email: user.email },
  })
  void ensureMoodleUserById(user.id)
  res.json({ id: user.id })
})

// Editar datos sensibles
r.put('/users/:id', requirePermission('users.update', 'all'), async (req, res) => {
  const id = req.params.id
  const parsed = z
    .object({
      role: z.string().min(2).optional(),
      username: usernameSchema.optional(),
      nationalId: z.string().min(6).max(20).optional(),
      firstName: z.string().min(1).max(80).optional(),
      lastName: z.string().min(1).max(80).optional(),
      isApproved: z.boolean().optional(),
      isActive: z.boolean().optional(),
      emailVerified: z.boolean().optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: firstZodIssueMessage(parsed.error) })
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

  const beforeSnapshot = await prisma.user.findUnique({
    where: { id },
    select: {
      roleId: true,
      email: true,
      username: true,
      firstName: true,
      lastName: true,
      name: true,
      nationalId: true,
      nationalIdDocumentExpiresAt: true,
      emailVerifiedAt: true,
      isApproved: true,
      approvedAt: true,
      isActive: true,
    },
  })
  if (!beforeSnapshot) return res.status(404).json({ message: 'Usuario no encontrado' })

  const fieldsChangedSemantic = computeAuditUserFieldsChanged(beforeSnapshot, data)
  if (Object.keys(data).length > 0 && fieldsChangedSemantic.length === 0) {
    return res.json({ ok: true })
  }

  try {
    await prisma.user.update({ where: { id }, data: data as Prisma.UserUpdateInput })
    const emailVerifiedProvided = Object.prototype.hasOwnProperty.call(data, 'emailVerifiedAt')
    if (data.username || data.firstName || data.lastName || emailVerifiedProvided) {
      await syncKeycloakUserIdentityByEmail(beforeSnapshot.email, {
        username: typeof data.username === 'string' ? data.username : beforeSnapshot.username,
        firstName: typeof data.firstName === 'string' ? data.firstName : beforeSnapshot.firstName,
        lastName: typeof data.lastName === 'string' ? data.lastName : beforeSnapshot.lastName,
        ...(emailVerifiedProvided ? { emailVerified: data.emailVerifiedAt !== null } : {}),
      }).catch((error) => console.warn('[admin] keycloak sync user identity skipped:', error))
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return res.status(409).json({ message: messageForUniqueViolation(error) })
    }
    throw error
  }
  recordAuditEvent({
    action: AuditAction.USER_UPDATED_BY_ADMIN,
    actorUserId: (req as any).user?.id ?? null,
    req,
    entityType: 'User',
    entityId: id,
    metadata: { fieldsChanged: fieldsChangedSemantic },
  })
  // Si el usuario fue dado de baja, dejado pendiente o se le cambió el rol, sus
  // sesiones BFF actuales deben invalidarse para que el cambio tenga efecto ya.
  const deactivated = data.isActive === false
  const unapproved = data.isApproved === false
  const roleChanged = typeof data.roleId === 'string' && data.roleId !== beforeSnapshot.roleId
  if (deactivated || unapproved || roleChanged) {
    void deleteSessionsForUser(id)
  }
  if (
    beforeSnapshot.isApproved === false &&
    parsed.data.isApproved === true
  ) {
    void ensureMoodleUserById(id)
  }
  res.json({ ok: true })
})

// Eliminar definitivamente un usuario. Solo admin (users.update/all) y solo si ya está
// dado de baja, para evitar borrados accidentales. Borra también la cuenta de Keycloak.
r.delete('/users/:id', requirePermission('users.update', 'all'), async (req, res) => {
  const id = req.params.id
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, name: true, isActive: true, ...selectOrgRoleCode },
  })
  if (!target) return res.status(404).json({ message: 'Usuario no encontrado' })
  if ((target.orgRole?.code ?? '') === 'ADMIN') {
    return res.status(403).json({ message: 'No se puede eliminar al usuario administrador.' })
  }
  if (target.isActive) {
    return res.status(409).json({
      message: 'Solo se puede eliminar un usuario que esté dado de baja. Dalo de baja primero.',
    })
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Relaciones con FK Restrict hacia User (suplencias): hay que quitarlas antes de borrar.
      // El resto de relaciones se resuelven por Cascade / SetNull en el esquema.
      await tx.substitution.deleteMany({
        where: { OR: [{ originalTeacherUserId: id }, { substituteUserId: id }] },
      })
      await tx.user.delete({ where: { id } })
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return res.status(409).json({
        message: 'No se puede eliminar: el usuario tiene registros asociados que lo impiden.',
      })
    }
    throw error
  }

  // Invalida sesiones BFF y borra la cuenta de Keycloak (best-effort) para no dejar huérfanos.
  void deleteSessionsForUser(id)
  void deleteKeycloakUserByEmail(target.email).catch((error) =>
    console.warn('[admin] keycloak delete user skipped:', error),
  )

  recordAuditEvent({
    action: AuditAction.USER_DELETED_BY_ADMIN,
    actorUserId: (req as any).user?.id ?? null,
    req,
    entityType: 'User',
    entityId: id,
    metadata: { email: target.email },
  })

  res.json({ ok: true })
})

r.put('/users/:id/lock', requirePermission('users.security', 'all'), async (req, res) => {
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
  if (lock) {
    void deleteSessionsForUser(id)
  }
  recordAuditEvent({
    action: AuditAction.USER_ACCOUNT_LOCK_TOGGLED,
    actorUserId: (req as any).user?.id ?? null,
    req,
    entityType: 'User',
    entityId: id,
    metadata: { locked: lock },
  })
  res.json({ ok: true })
})

r.post('/users/:id/password/reset', requirePermission('users.security', 'all'), async (req, res) => {
  const id = req.params.id
  const u = await prisma.user.findUnique({
    where: { id },
    select: { ...selectOrgRoleCode, email: true },
  })
  if (!u) return res.status(404).json({ message: 'Usuario no encontrado' })
  if ((u.orgRole?.code ?? '') === 'ADMIN') {
    return res.status(403).json({ message: 'No se puede restablecer la contraseña del administrador desde esta pantalla.' })
  }
  try {
    const { triggerKeycloakPasswordReset } = await import('../auth/keycloak.js')
    await triggerKeycloakPasswordReset(u.email)
  } catch (e) {
    console.error('[admin] keycloak password reset:', e)
    return res.status(502).json({ message: 'No se pudo enviar el restablecimiento de contraseña.' })
  }
  // Forzar re-login: invalidamos sesiones BFF activas del usuario.
  void deleteSessionsForUser(id)
  recordAuditEvent({
    action: AuditAction.ADMIN_PASSWORD_RESET_ISSUED,
    actorUserId: (req as any).user?.id ?? null,
    req,
    entityType: 'User',
    entityId: id,
    metadata: { via: 'keycloak' },
  })
  res.json({ ok: true, message: 'Se envió un correo de restablecimiento de contraseña.' })
})

r.get('/system-settings', requirePermission('settings.manage', 'all'), async (_req, res) => {
  const row = await getOrCreateSystemSettings()
  const settings = row as typeof row & {
    attendanceEarlyExitToleranceMinutes?: number | null
    biometricDuplicateWindowMinutes?: number | null
    moodleSyncEnabled?: boolean | null
    moodleReconcileIntervalMs?: number | null
    moodleSyncStudents?: boolean | null
    institutionTimezone?: string | null
  }
  return res.json({
    diditConfigured: isDiditConfigured(),
    livenessCheckEnabled: row.livenessCheckEnabled,
    attendanceNoShowGraceMinutes: row.attendanceNoShowGraceMinutes,
    attendanceLateToleranceMinutes: row.attendanceLateToleranceMinutes,
    attendanceEarlyExitToleranceMinutes: settings.attendanceEarlyExitToleranceMinutes ?? row.attendanceLateToleranceMinutes,
    attendanceClassBridgeGapMinutes: row.attendanceClassBridgeGapMinutes,
    attendanceMonitorEnabled: row.attendanceMonitorEnabled,
    attendanceMonitorIntervalMs: row.attendanceMonitorIntervalMs,
    biometricDuplicateWindowMinutes: settings.biometricDuplicateWindowMinutes ?? 5,
    institutionTimezone: normalizeInstitutionTimezone(settings.institutionTimezone),
    institutionTimezoneOptions: INSTITUTION_TIMEZONE_OPTIONS,
    moodleConfigured: isMoodleIntegrationEnabled(),
    moodleSyncEnabled: settings.moodleSyncEnabled === true,
    moodleSyncEnabledEffective:
      settings.moodleSyncEnabled === true || isMoodleSyncEnabledFromEnv(),
    moodleSyncEnabledFromEnv: isMoodleSyncEnabledFromEnv(),
    moodleReconcileIntervalMs: settings.moodleReconcileIntervalMs ?? 900000,
    moodleSyncStudents: settings.moodleSyncStudents === true,
  })
})

r.put('/system-settings', requirePermission('settings.manage', 'all'), async (req, res) => {
  const parsed = z
    .object({
      livenessCheckEnabled: z.boolean().optional(),
      attendanceNoShowGraceMinutes: z.number().int().min(1).max(180).optional(),
      attendanceLateToleranceMinutes: z.number().int().min(0).max(120).optional(),
      attendanceEarlyExitToleranceMinutes: z.number().int().min(0).max(120).optional(),
      attendanceClassBridgeGapMinutes: z.number().int().min(15).max(240).optional(),
      attendanceMonitorEnabled: z.boolean().optional(),
      attendanceMonitorIntervalMs: z.number().int().min(30000).max(3600000).optional(),
      biometricDuplicateWindowMinutes: z.number().int().min(0).max(120).optional(),
      moodleSyncEnabled: z.boolean().optional(),
      moodleReconcileIntervalMs: z.number().int().min(60000).max(86400000).optional(),
      moodleSyncStudents: z.boolean().optional(),
      institutionTimezone: z.string().trim().min(1).max(64).optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos', errors: parsed.error.errors })

  if (
    parsed.data.institutionTimezone !== undefined &&
    !isValidInstitutionTimezone(parsed.data.institutionTimezone)
  ) {
    return res.status(400).json({ message: 'Zona horaria inválida' })
  }

  const data = parsed.data
  const updated = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      livenessCheckEnabled: data.livenessCheckEnabled ?? false,
      attendanceNoShowGraceMinutes: data.attendanceNoShowGraceMinutes ?? 15,
      attendanceLateToleranceMinutes: data.attendanceLateToleranceMinutes ?? 5,
      attendanceEarlyExitToleranceMinutes: data.attendanceEarlyExitToleranceMinutes ?? 5,
      attendanceClassBridgeGapMinutes: data.attendanceClassBridgeGapMinutes ?? 60,
      attendanceMonitorEnabled: data.attendanceMonitorEnabled ?? true,
      attendanceMonitorIntervalMs: data.attendanceMonitorIntervalMs ?? 120000,
      biometricDuplicateWindowMinutes: data.biometricDuplicateWindowMinutes ?? 5,
      moodleSyncEnabled: data.moodleSyncEnabled ?? isMoodleSyncEnabledFromEnv(),
      moodleReconcileIntervalMs: data.moodleReconcileIntervalMs ?? 900000,
      moodleSyncStudents: data.moodleSyncStudents ?? false,
      institutionTimezone: normalizeInstitutionTimezone(data.institutionTimezone),
    } as any,
    update: data as any,
  })
  await refreshInstitutionTimezoneCache()
  const updatedSettings = updated as typeof updated & {
    attendanceEarlyExitToleranceMinutes?: number | null
    biometricDuplicateWindowMinutes?: number | null
    moodleSyncEnabled?: boolean | null
    moodleReconcileIntervalMs?: number | null
    moodleSyncStudents?: boolean | null
    institutionTimezone?: string | null
  }

  recordAuditEvent({
    action: AuditAction.SYSTEM_SETTINGS_UPDATED,
    actorUserId: (req as any).user?.id ?? null,
    req,
    entityType: 'SystemSettings',
    entityId: 'default',
    metadata: { keysChanged: Object.keys(parsed.data) },
  })

  return res.json({
    diditConfigured: isDiditConfigured(),
    livenessCheckEnabled: updated.livenessCheckEnabled,
    attendanceNoShowGraceMinutes: updated.attendanceNoShowGraceMinutes,
    attendanceLateToleranceMinutes: updated.attendanceLateToleranceMinutes,
    attendanceEarlyExitToleranceMinutes: updatedSettings.attendanceEarlyExitToleranceMinutes ?? updated.attendanceLateToleranceMinutes,
    attendanceClassBridgeGapMinutes: updated.attendanceClassBridgeGapMinutes,
    attendanceMonitorEnabled: updated.attendanceMonitorEnabled,
    attendanceMonitorIntervalMs: updated.attendanceMonitorIntervalMs,
    biometricDuplicateWindowMinutes: updatedSettings.biometricDuplicateWindowMinutes ?? 5,
    institutionTimezone: normalizeInstitutionTimezone(updatedSettings.institutionTimezone),
    institutionTimezoneOptions: INSTITUTION_TIMEZONE_OPTIONS,
    moodleConfigured: isMoodleIntegrationEnabled(),
    moodleSyncEnabled: updatedSettings.moodleSyncEnabled === true,
    moodleSyncEnabledEffective:
      updatedSettings.moodleSyncEnabled === true || isMoodleSyncEnabledFromEnv(),
    moodleSyncEnabledFromEnv: isMoodleSyncEnabledFromEnv(),
    moodleReconcileIntervalMs: updatedSettings.moodleReconcileIntervalMs ?? 900000,
    moodleSyncStudents: updatedSettings.moodleSyncStudents === true,
  })
})

r.get('/moodle/status', requirePermission('settings.manage', 'all'), async (_req, res) => {
  try {
    const status = await getMoodleHealthStatus()
    return res.json(status)
  } catch (error) {
    console.error('[admin] moodle/status:', error)
    return res.status(500).json({ message: 'Error obteniendo estado de Moodle' })
  }
})

r.post('/moodle/reconcile', requirePermission('settings.manage', 'all'), async (_req, res) => {
  if (!isMoodleIntegrationEnabled()) {
    return res.status(503).json({ message: 'Moodle no configurado (MOODLE_BASE_URL + MOODLE_WS_TOKEN)' })
  }
  try {
    const moodleSettings = await getMoodleOperationalSettings()
    const summary = await reconcileMoodle({ syncStudents: moodleSettings.syncStudents })
    return res.json({ message: 'Reconciliación completada', summary })
  } catch (error) {
    console.error('[admin] moodle/reconcile:', error)
    return res.status(500).json({
      message: error instanceof Error ? error.message : 'Error en reconciliación Moodle',
    })
  }
})

r.get('/audit-logs', requirePermission('audit.read', 'all'), async (req, res) => {
  const parsed = z
    .object({
      page: z.coerce.number().int().min(1).optional().default(1),
      pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
      action: z.string().optional(),
      actorUserId: z.string().uuid().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
    })
    .safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parámetros inválidos', errors: parsed.error.errors })
  }
  const { page, pageSize, action: actionRaw, actorUserId, from, to } = parsed.data
  if (actionRaw && !parseAuditActionFilter(actionRaw)) {
    return res.status(400).json({ message: 'Tipo de acción inválido' })
  }
  const action = parseAuditActionFilter(actionRaw)

  const where: Prisma.AuditLogWhereInput = {}
  if (action) where.action = action
  if (actorUserId) where.actorUserId = actorUserId
  if (from || to) {
    where.occurredAt = {}
    if (from) {
      const d = new Date(from)
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Fecha "desde" inválida' })
      where.occurredAt.gte = d
    }
    if (to) {
      const d = new Date(to)
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Fecha "hasta" inválida' })
      where.occurredAt.lte = d
    }
  }

  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { actor: { select: { id: true, name: true, email: true } } },
    }),
  ])

  const data = rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    action: row.action,
    actionLabel: AUDIT_ACTION_LABELS[row.action],
    actorUserId: row.actorUserId,
    actorName: row.actor?.name ?? null,
    actorEmail: row.actor?.email ?? null,
    actorIp: row.actorIp,
    userAgent: row.userAgent,
    source: row.source,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
  }))

  return res.json({
    total,
    page,
    pageSize,
    actionCatalog: getAuditActionCatalog(),
    data,
  })
})

r.use('/students', requirePermission('students.manage', 'all'), adminStudentsRoutes)
r.use('/school-years', requirePermission('school-years.manage', 'all'), adminSchoolYearsRoutes)

/** RF-10: consulta en lenguaje natural → SQL SELECT validado o informe prearmado de fallback. */
r.post('/query-assistant', requirePermission('query-assistant.use', 'all'), async (req, res) => {
  const parsed = z
    .object({
      question: z.string().min(1).max(2000),
      schoolYearId: z.string().uuid().optional(),
      allYears: z.union([z.boolean(), z.literal('1'), z.literal('0')]).optional(),
      dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    })
    .safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Pregunta inválida', errors: parsed.error.errors })
  }
  try {
    const allYears = parsed.data.allYears === true || parsed.data.allYears === '1'
    const schoolYearId = allYears
      ? undefined
      : await resolveSchoolYearIdForList(prisma, {
          requestedSchoolYearId: parsed.data.schoolYearId,
          role: req.user?.role ?? 'ADMIN',
        })
    const schoolYear = schoolYearId
      ? await prisma.schoolYear.findUnique({
          where: { id: schoolYearId },
          select: { id: true, code: true, startsOn: true, endsOn: true },
        })
      : null
    // Solo aplicamos el filtro de fechas de la UI si vienen ambas y están bien ordenadas.
    const uiFrom = parsed.data.dateFrom
    const uiTo = parsed.data.dateTo
    const hasUiRange = Boolean(uiFrom && uiTo && uiFrom <= uiTo)
    const result = await runAdminQueryAssistant(parsed.data.question, {
      allYears,
      schoolYearId: schoolYear?.id ?? schoolYearId,
      schoolYearCode: schoolYear?.code,
      schoolYearStartsOn: schoolYear?.startsOn ? schoolYear.startsOn.toISOString().slice(0, 10) : undefined,
      schoolYearEndsOn: schoolYear?.endsOn ? schoolYear.endsOn.toISOString().slice(0, 10) : undefined,
      ...(hasUiRange ? { dateFrom: uiFrom, dateTo: uiTo } : {}),
    })
    return res.json(result)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg === 'OPENAI_API_KEY_NOT_CONFIGURED') {
      return res.status(503).json({
        message: 'El asistente no está configurado. Definí OPENAI_API_KEY en el servidor.',
      })
    }
    if (msg.startsWith('OPENAI_API_KEY_INVALID_FORMAT:')) {
      return res.status(503).json({
        message: msg.replace(/^OPENAI_API_KEY_INVALID_FORMAT:\s*/, ''),
      })
    }
    console.error('[query-assistant]', e)
    return res.status(500).json({ message: 'No se pudo procesar la consulta.', detail: msg })
  }
})

export default r
