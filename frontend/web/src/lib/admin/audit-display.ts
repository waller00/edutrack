export type AuditFilters = {
  action: string
  actorUserId: string
  from: string
  to: string
}

/** Cantidad de filtros activos (para el contador junto a "Limpiar"). */
export function countActiveAuditFilters(f: AuditFilters): number {
  let n = 0
  if (f.action) n += 1
  if (f.actorUserId.trim()) n += 1
  if (f.from) n += 1
  if (f.to) n += 1
  return n
}

export type AuditActionTone = 'danger' | 'warning' | 'success' | 'info' | 'neutral'

/** Clasifica un código de acción para colorear el badge y facilitar el escaneo visual. */
export function getAuditActionTone(action: string): AuditActionTone {
  const a = (action || '').toUpperCase()
  if (a.includes('FAILURE') || a.includes('ERROR') || a.includes('DENIED')) return 'danger'
  if (a.includes('LOCK') || a.includes('DELET') || a.includes('DEACTIVAT') || a.includes('RESET') || a.includes('DISABLE')) {
    return 'warning'
  }
  if (a.includes('SUCCESS') || a.includes('CREATED') || a.includes('ENABLE')) return 'success'
  if (a.includes('UPDATED') || a.includes('SETTINGS') || a.includes('TOGGLED')) return 'info'
  return 'neutral'
}

const AUDIT_ACTION_BADGE_CLASS: Record<AuditActionTone, string> = {
  danger: 'bg-red-100 text-red-800',
  warning: 'bg-amber-100 text-amber-900',
  success: 'bg-emerald-100 text-emerald-800',
  info: 'bg-blue-100 text-blue-800',
  neutral: 'bg-slate-100 text-slate-600',
}

export function getAuditActionBadgeClass(action: string): string {
  return AUDIT_ACTION_BADGE_CLASS[getAuditActionTone(action)]
}
