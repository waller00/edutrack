import { describe, expect, it } from 'vitest'
import { countActiveAuditFilters, getAuditActionBadgeClass, getAuditActionTone } from './audit-display'

const filters = (over?: Partial<Parameters<typeof countActiveAuditFilters>[0]>) => ({
  action: '',
  actorUserId: '',
  from: '',
  to: '',
  ...over,
})

describe('countActiveAuditFilters', () => {
  it('cuenta solo filtros con valor', () => {
    expect(countActiveAuditFilters(filters())).toBe(0)
    expect(countActiveAuditFilters(filters({ actorUserId: '   ' }))).toBe(0)
    expect(countActiveAuditFilters(filters({ action: 'AUTH_LOGIN_FAILURE', from: '2026-01-01', to: '2026-02-01', actorUserId: 'x' }))).toBe(4)
  })
})

describe('getAuditActionTone', () => {
  it('clasifica por patrón del código', () => {
    expect(getAuditActionTone('AUTH_LOGIN_FAILURE')).toBe('danger')
    expect(getAuditActionTone('USER_ACCOUNT_LOCK_TOGGLED')).toBe('warning')
    expect(getAuditActionTone('MEDICAL_LEAVE_DEACTIVATED')).toBe('warning')
    expect(getAuditActionTone('ADMIN_PASSWORD_RESET_ISSUED')).toBe('warning')
    expect(getAuditActionTone('AUTH_GOOGLE_LOGIN_SUCCESS')).toBe('success')
    expect(getAuditActionTone('USER_CREATED_BY_ADMIN')).toBe('success')
    expect(getAuditActionTone('USER_UPDATED_BY_ADMIN')).toBe('info')
    expect(getAuditActionTone('SYSTEM_SETTINGS_UPDATED')).toBe('info')
    expect(getAuditActionTone('SOMETHING_ELSE')).toBe('neutral')
  })
})

describe('getAuditActionBadgeClass', () => {
  it('mapea cada tono a clases de color', () => {
    expect(getAuditActionBadgeClass('AUTH_LOGIN_FAILURE')).toContain('red')
    expect(getAuditActionBadgeClass('USER_CREATED_BY_ADMIN')).toContain('emerald')
    expect(getAuditActionBadgeClass('USER_UPDATED_BY_ADMIN')).toContain('blue')
    expect(getAuditActionBadgeClass('ADMIN_PASSWORD_RESET_ISSUED')).toContain('amber')
    expect(getAuditActionBadgeClass('OTRO')).toContain('slate')
  })
})
