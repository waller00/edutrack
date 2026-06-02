import { describe, it, expect } from 'vitest'
import { auditMetadataDisplay, auditMetadataTechnicalJson } from './audit-detail-es'

describe('auditMetadataTechnicalJson', () => {
  it('devuelve undefined si metadata es null/undefined', () => {
    expect(auditMetadataTechnicalJson(null)).toBeUndefined()
    expect(auditMetadataTechnicalJson(undefined)).toBeUndefined()
  })

  it('serializa objetos a JSON', () => {
    expect(auditMetadataTechnicalJson({ a: 1 })).toBe('{"a":1}')
  })

  it('cae a String() cuando JSON.stringify falla (referencia circular)', () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(typeof auditMetadataTechnicalJson(circular)).toBe('string')
  })
})

describe('auditMetadataDisplay', () => {
  it('metadata vacía o no-objeto → lines vacío', () => {
    expect(auditMetadataDisplay('ANY', null).lines).toEqual([])
    expect(auditMetadataDisplay('ANY', {}).lines).toEqual([])
    expect(auditMetadataDisplay('ANY', [1, 2]).lines).toEqual([])
  })

  it('AUTH_LOGIN_FAILURE con razón conocida y desconocida', () => {
    expect(auditMetadataDisplay('AUTH_LOGIN_FAILURE', { reason: 'INVALID_PASSWORD' }).lines[0]).toBe(
      'La contraseña no coincide.',
    )
    const unknown = auditMetadataDisplay('AUTH_LOGIN_FAILURE', { reason: 'SOME_OTHER' })
    expect(unknown.lines[0]).toContain('some other')
  })

  it('AUTH_GOOGLE_LOGIN_SUCCESS según needsProfileCompletion', () => {
    expect(auditMetadataDisplay('AUTH_GOOGLE_LOGIN_SUCCESS', { needsProfileCompletion: true }).lines[0]).toContain(
      'completar el perfil',
    )
    expect(auditMetadataDisplay('AUTH_GOOGLE_LOGIN_SUCCESS', { ok: 1 }).lines[0]).toContain('correctamente')
  })

  it('USER_CREATED_BY_ADMIN con y sin email', () => {
    expect(auditMetadataDisplay('USER_CREATED_BY_ADMIN', { email: 'a@b.com' }).lines[0]).toContain('a@b.com')
    expect(auditMetadataDisplay('USER_CREATED_BY_ADMIN', { other: 1 }).lines[0]).toBe('Alta de usuario registrada.')
  })

  it('USER_UPDATED_BY_ADMIN: 1, 2 y 3+ campos', () => {
    expect(auditMetadataDisplay('USER_UPDATED_BY_ADMIN', { fieldsChanged: ['role'] }).lines[0]).toBe(
      'Se actualizó rol.',
    )
    expect(auditMetadataDisplay('USER_UPDATED_BY_ADMIN', { fieldsChanged: ['role', 'username'] }).lines[0]).toBe(
      'Se actualizaron: rol y nombre de usuario.',
    )
    expect(
      auditMetadataDisplay('USER_UPDATED_BY_ADMIN', { fieldsChanged: ['role', 'username', 'phone'] }).lines[0],
    ).toBe('Se actualizaron: rol, nombre de usuario y phone.')
    expect(auditMetadataDisplay('USER_UPDATED_BY_ADMIN', { fieldsChanged: [] }).lines[0]).toBe(
      'Se guardaron cambios en el usuario.',
    )
  })

  it('USER_ACCOUNT_LOCK_TOGGLED bloqueo y desbloqueo', () => {
    expect(auditMetadataDisplay('USER_ACCOUNT_LOCK_TOGGLED', { locked: true }).lines[0]).toContain('bloqueó')
    expect(auditMetadataDisplay('USER_ACCOUNT_LOCK_TOGGLED', { locked: false }).lines[0]).toContain('quitó el bloqueo')
  })

  it('ADMIN_PASSWORD_RESET_ISSUED con y sin expiresAt', () => {
    expect(auditMetadataDisplay('ADMIN_PASSWORD_RESET_ISSUED', { expiresAt: '2030-01-01T00:00:00Z' }).lines[0]).toContain(
      'válido hasta',
    )
    expect(auditMetadataDisplay('ADMIN_PASSWORD_RESET_ISSUED', { x: 1 }).lines[0]).toBe(
      'Se generó un enlace para restablecer contraseña.',
    )
  })

  it('SYSTEM_SETTINGS_UPDATED: 1, 2 y vacío', () => {
    expect(auditMetadataDisplay('SYSTEM_SETTINGS_UPDATED', { keysChanged: ['biometricLateHour'] }).lines[0]).toContain(
      'hora de tardanza biométrica',
    )
    expect(
      auditMetadataDisplay('SYSTEM_SETTINGS_UPDATED', { keysChanged: ['biometricLateHour', 'livenessCheckEnabled'] })
        .lines[0],
    ).toContain(' y ')
    expect(auditMetadataDisplay('SYSTEM_SETTINGS_UPDATED', { keysChanged: [] }).lines[0]).toBe(
      'Se actualizaron parámetros del sistema.',
    )
  })

  it('MEDICAL_LEAVE_* ', () => {
    expect(auditMetadataDisplay('MEDICAL_LEAVE_CREATED', { type: 'WORK_LEAVE' }).lines[0]).toContain('Permiso laboral')
    expect(auditMetadataDisplay('MEDICAL_LEAVE_CREATED', { type: 'XX' }).lines[0]).toContain('permiso / licencia')
    expect(auditMetadataDisplay('MEDICAL_LEAVE_UPDATED', { a: 1 }).lines[0]).toContain('modificaron')
    expect(auditMetadataDisplay('MEDICAL_LEAVE_DEACTIVATED', { a: 1 }).lines[0]).toContain('dejó de estar vigente')
  })

  it('EVENT_CREATED con título largo, tipo y asignación', () => {
    const longTitle = 'x'.repeat(200)
    const res = auditMetadataDisplay('EVENT_CREATED', {
      title: longTitle,
      type: 'REUNION',
      assignedUserId: 'u1',
    })
    expect(res.lines[0]).toContain('…')
    expect(res.lines[1]).toContain('Reunión')
    expect(res.lines[2]).toContain('asignado a otra persona')

    const noAssign = auditMetadataDisplay('EVENT_CREATED', { title: 'Corta', type: 'TIPO_RARO', assignedUserId: '' })
    expect(noAssign.lines[2]).toContain('Sin asignatario')
  })

  it('fallback: una sola clave conocida y desconocida', () => {
    expect(auditMetadataDisplay('UNKNOWN', { affectedUserId: 'u1' }).lines[0]).toContain('titular del registro')
    expect(auditMetadataDisplay('UNKNOWN', { reason: 'x' }).lines[0]).toBe('Motivo: x.')
    expect(auditMetadataDisplay('UNKNOWN', { email: 'a@b' }).lines[0]).toBe('Correo: a@b.')
    expect(auditMetadataDisplay('UNKNOWN', { type: 'Z' }).lines[0]).toBe('Tipo: Z.')
    expect(auditMetadataDisplay('UNKNOWN', { foo_bar: { nested: 1 } }).lines[0]).toContain('foo bar')
  })

  it('fallback: múltiples claves → mensaje genérico', () => {
    expect(auditMetadataDisplay('UNKNOWN', { a: 1, b: 2 }).lines[0]).toContain('Datos técnicos')
  })
})
