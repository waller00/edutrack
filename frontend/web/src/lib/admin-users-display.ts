export type AdminUserRow = {
  id: string
  email: string
  username?: string
  role: 'ADMIN' | 'STAFF' | 'TEACHER'
  firstName?: string
  lastName?: string
  emailVerifiedAt?: string
  lockUntil?: string
  nationalId?: string
  isApproved: boolean
  approvedAt?: string
  isActive: boolean
}

export function buildAdminUsersQueryParams(
  q: string,
  role: 'ALL' | 'ADMIN' | 'STAFF' | 'TEACHER',
): string {
  const params = new URLSearchParams({ page: '1', pageSize: '20' })
  if (q) params.set('q', q)
  if (role !== 'ALL') params.set('role', role)
  return params.toString()
}

export function cloneAdminUser(user: AdminUserRow): AdminUserRow {
  return { ...user }
}

export function buildAdminUserEditChanges(original: AdminUserRow | null, edited: AdminUserRow): string[] {
  if (!original) return []
  const changes: string[] = []
  if (original.role !== edited.role) changes.push(`Rol: ${original.role} → ${edited.role}`)
  if ((original.username || '') !== (edited.username || '')) {
    changes.push(`Usuario: ${original.username || '-'} → ${edited.username || '-'}`)
  }
  if ((original.nationalId || '') !== (edited.nationalId || '')) {
    changes.push(`Cédula: ${original.nationalId || '-'} → ${edited.nationalId || '-'}`)
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

  if (mentions409) return 'Usuario o cédula ya registrados'
  if (mentions400) return 'Datos inválidos (verifica cédula)'

  if (m && !m.startsWith('API ') && !bareHttpCode) return m

  return 'No se pudo guardar'
}

export function getVerificationBadgeClass(emailVerifiedAt?: string): string {
  return emailVerifiedAt
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700'
}

export function getVerificationLabel(emailVerifiedAt?: string): string {
  return emailVerifiedAt ? 'Verificado' : 'No verificado'
}

export function getApprovalBadgeClass(isApproved: boolean): string {
  return isApproved
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700'
}

export function getApprovalLabel(isApproved: boolean): string {
  return isApproved ? 'Aprobado' : 'Pendiente'
}

export function getActiveBadgeClass(isActive: boolean): string {
  return isActive
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-700'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700'
}

export function getActiveLabel(isActive: boolean): string {
  return isActive ? 'Alta' : 'Baja'
}

export function getLockBadgeClass(lockUntil?: string): string {
  return lockUntil
    ? 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700'
    : 'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-200 text-slate-700'
}

export function getLockLabel(lockUntil?: string): string {
  return lockUntil ? 'Bloqueado' : 'Sin bloqueo'
}
