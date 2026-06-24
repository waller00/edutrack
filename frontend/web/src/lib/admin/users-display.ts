import { getRoleLabel } from '@/lib/roles/display'
import { formatDateTimeInUruguay } from '@/lib/forms/datetime-uy'

export type AdminUserRow = {
  id: string
  email: string
  username?: string | null
  /** Código de OrgRole (ADMIN, TEACHER, STAFF, o custom). */
  role: string
  firstName?: string | null
  lastName?: string | null
  name?: string | null
  emailVerifiedAt?: string | null
  lockUntil?: string | null
  nationalId?: string | null
  nationalIdDocumentExpiresAt?: string | null
  createdAt?: string
  isApproved: boolean
  approvedAt?: string | null
  isActive: boolean
  biometricLinked?: boolean
}

export type TriState = '' | 'true' | 'false'

export type AdminUsersListFilters = {
  q: string
  /** 'ALL' o código de rol (ej. TEACHER, STAFF, CUSTOM_X) */
  role: string
  approved: TriState
  active: TriState
  verified: TriState
  locked: TriState
  /** Documento de identidad por vencer en los próximos 90 días. */
  docExpiring: TriState
  page: number
}

/** Tamaño fijo de página en la UI de administración (el backend acepta otros valores por API). */
export const ADMIN_USERS_PAGE_SIZE = 20

export function buildAdminUsersQueryParams(f: AdminUsersListFilters): string {
  const params = new URLSearchParams()
  params.set('page', String(Math.max(1, f.page)))
  params.set('pageSize', String(ADMIN_USERS_PAGE_SIZE))
  if (f.q.trim()) params.set('q', f.q.trim())
  if (f.role && f.role !== 'ALL') params.set('role', f.role.trim().toUpperCase())
  if (f.approved === 'true' || f.approved === 'false') params.set('approved', f.approved)
  if (f.active === 'true' || f.active === 'false') params.set('active', f.active)
  if (f.verified === 'true' || f.verified === 'false') params.set('verified', f.verified)
  if (f.locked === 'true' || f.locked === 'false') params.set('locked', f.locked)
  if (f.docExpiring === 'true') params.set('docExpiring', 'true')
  return params.toString()
}

/** Cantidad de filtros activos (excluye paginación). Útil para el contador junto a "Limpiar". */
export function countActiveUserFilters(f: AdminUsersListFilters): number {
  let n = 0
  if (f.q.trim()) n += 1
  if (f.role && f.role !== 'ALL') n += 1
  if (f.approved === 'true' || f.approved === 'false') n += 1
  if (f.active === 'true' || f.active === 'false') n += 1
  if (f.verified === 'true' || f.verified === 'false') n += 1
  if (f.locked === 'true' || f.locked === 'false') n += 1
  if (f.docExpiring === 'true') n += 1
  return n
}

export function displayUserName(u: Pick<AdminUserRow, 'firstName' | 'lastName' | 'name' | 'email'>): string {
  const composed = `${u.firstName || ''} ${u.lastName || ''}`.trim()
  return composed || u.name?.trim() || u.email || '—'
}

export function isAccountLocked(lockUntil?: string | null): boolean {
  if (!lockUntil) return false
  const t = new Date(lockUntil).getTime()
  return Number.isFinite(t) && t > Date.now()
}

export function formatYmdDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().slice(0, 10)
}

export function cloneAdminUser(user: AdminUserRow): AdminUserRow {
  return { ...user }
}

export function buildAdminUserEditChanges(original: AdminUserRow | null, edited: AdminUserRow): string[] {
  if (!original) return []
  const changes: string[] = []
  if (original.role !== edited.role) {
    changes.push(`Rol: ${getRoleLabel(original.role)} → ${getRoleLabel(edited.role)}`)
  }
  if ((original.username || '') !== (edited.username || '')) {
    changes.push(`Usuario: ${original.username || '-'} → ${edited.username || '-'}`)
  }
  if ((original.firstName || '') !== (edited.firstName || '')) {
    changes.push(`Nombre: ${original.firstName || '-'} → ${edited.firstName || '-'}`)
  }
  if ((original.lastName || '') !== (edited.lastName || '')) {
    changes.push(`Apellido: ${original.lastName || '-'} → ${edited.lastName || '-'}`)
  }
  if ((original.nationalId || '') !== (edited.nationalId || '')) {
    changes.push(`Cédula: ${original.nationalId || '-'} → ${edited.nationalId || '-'}`)
  }
  const oDoc = formatYmdDate(original.nationalIdDocumentExpiresAt)
  const eDoc = formatYmdDate(edited.nationalIdDocumentExpiresAt)
  if (oDoc !== eDoc) changes.push(`Venc. documento: ${oDoc} → ${eDoc}`)
  if (original.isApproved !== edited.isApproved) {
    changes.push(`Aprobación: ${original.isApproved ? 'Aprobado' : 'Pendiente'} → ${edited.isApproved ? 'Aprobado' : 'Pendiente'}`)
  }
  if (original.isActive !== edited.isActive) {
    changes.push(`Estado: ${original.isActive ? 'Alta' : 'Baja'} → ${edited.isActive ? 'Alta' : 'Baja'}`)
  }
  return changes
}

export function getAdminUserSaveErrorMessage(error: unknown): string {
  const err = error as { message?: string; status?: number; data?: { message?: string } }
  const fromBody = err.data?.message != null ? String(err.data.message).trim() : ''
  if (fromBody) return fromBody

  const m = String(err.message || '').trim()
  const bareHttpCode = /^\d{3}$/.test(m)
  const mentions409 = err.status === 409 || /\b409\b/.test(m)
  const mentions400 = err.status === 400 || /\b400\b/.test(m)
  const mentions403 = err.status === 403 || /\b403\b/.test(m)

  if (mentions409) return 'Usuario o cédula ya registrados'
  if (mentions400) return 'Datos inválidos (verifica cédula y fechas)'
  if (mentions403) return 'No tenés permiso para esta acción'

  if (m && !m.startsWith('API ') && !bareHttpCode) return m

  return 'No se pudo guardar'
}

export function getVerificationBadgeClass(emailVerifiedAt?: string | null): string {
  return emailVerifiedAt
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800'
}

export function getVerificationLabel(emailVerifiedAt?: string | null): string {
  return emailVerifiedAt ? 'Verificado' : 'Sin verificar'
}

export function getApprovalBadgeClass(isApproved: boolean): string {
  return isApproved
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-800'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800'
}

export function getApprovalLabel(isApproved: boolean): string {
  return isApproved ? 'Aprobado' : 'Pendiente'
}

export function getActiveBadgeClass(isActive: boolean): string {
  return isActive
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sky-100 text-sky-800'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800'
}

export function getActiveLabel(isActive: boolean): string {
  return isActive ? 'Alta' : 'Baja'
}

export function getLockBadgeClass(lockUntil?: string | null): string {
  return isAccountLocked(lockUntil)
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600'
}

export function getLockLabel(lockUntil?: string | null): string {
  if (isAccountLocked(lockUntil)) {
    const d = lockUntil ? new Date(lockUntil) : null
    if (d && !Number.isNaN(d.getTime())) {
      return `Bloqueado hasta ${formatDateTimeInUruguay(d)}`
    }
    return 'Bloqueado'
  }
  return 'Sin bloqueo'
}
