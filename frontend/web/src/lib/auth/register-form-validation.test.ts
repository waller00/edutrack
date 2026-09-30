import {
  getRegisterBirthdateValidationError,
  getRegisterIdentityValidationError,
  isValidRegisterEmail,
  resolveRegisterUsernameStatus,
  validateRegisterForm,
} from '@/lib/auth/register-form-validation'

const validCi = '1.111.111-1'
const baseForm = {
  email: 'a@b.co',
  password: 'Abcdef12',
  confirm: 'Abcdef12',
  nationalId: validCi,
  firstName: 'Juan',
  lastName: 'Pérez',
  role: 'TEACHER' as const,
  phoneLocal: '',
  birthdate: '1990-01-15',
}

describe('isValidRegisterEmail', () => {
  it('válidos e inválidos', () => {
    expect(isValidRegisterEmail('x@y.co')).toBe(true)
    expect(isValidRegisterEmail('')).toBe(false)
    expect(isValidRegisterEmail('a b@c.co')).toBe(false)
    expect(isValidRegisterEmail('a@')).toBe(false)
    expect(isValidRegisterEmail('@b.co')).toBe(false)
    expect(isValidRegisterEmail('a@b')).toBe(false)
    expect(isValidRegisterEmail('a@b.')).toBe(false)
  })
})

describe('resolveRegisterUsernameStatus', () => {
  it('inválido, tomado o libre', () => {
    expect(resolveRegisterUsernameStatus(false, true)).toBe('invalid')
    expect(resolveRegisterUsernameStatus(true, false)).toBe('taken')
    expect(resolveRegisterUsernameStatus(true, true)).toBe('ok')
  })
})

describe('getRegisterBirthdateValidationError', () => {
  it('futuro y edad', () => {
    expect(getRegisterBirthdateValidationError('')).toBeTruthy()
    const future = new Date()
    future.setFullYear(future.getFullYear() + 1)
    expect(getRegisterBirthdateValidationError(future.toISOString().slice(0, 10))).toContain('futura')
    expect(getRegisterBirthdateValidationError('2024-06-01')).toContain('mínima')
  })
  it('válida adulta', () => {
    expect(getRegisterBirthdateValidationError('1990-06-01')).toBeNull()
  })
})

describe('getRegisterIdentityValidationError', () => {
  const b = {
    nationalId: validCi,
    firstName: 'A',
    lastName: 'B',
    role: 'STAFF' as const,
  }
  it('rol cédula y nombres', () => {
    expect(getRegisterIdentityValidationError({ ...b, nationalId: '1' })).toContain('Cédula')
    expect(getRegisterIdentityValidationError({ ...b, firstName: '  ' })).toContain('obligatorios')
    expect(getRegisterIdentityValidationError({ ...b, role: '' })).toContain('perfil')
  })
})

describe('validateRegisterForm', () => {
  it('formulario completo válido, sin ninguna verificación en línea', () => {
    expect(validateRegisterForm(baseForm)).toBeNull()
  })
  it('correo y contraseña', () => {
    expect(validateRegisterForm({ ...baseForm, email: 'bad' })).toContain('Correo')
    expect(validateRegisterForm({ ...baseForm, password: 'weak' })).toContain('contraseña')
    expect(validateRegisterForm({ ...baseForm, password: `Aa1${'x'.repeat(62)}` })).toContain('64')
    expect(validateRegisterForm({ ...baseForm, confirm: 'Xyz78901' })).toContain('coinciden')
  })
  it('con Google no pide contraseña', () => {
    expect(validateRegisterForm({ ...baseForm, password: '', confirm: '', passwordRequired: false })).toBeNull()
  })
  it('cédula inválida', () => {
    expect(validateRegisterForm({ ...baseForm, nationalId: '1.111.111-2' })).toContain('Cédula')
  })
  it('celular', () => {
    expect(validateRegisterForm({ ...baseForm, phoneLocal: '12' })).toContain('Celular')
  })
  it('teléfono no puede ser una cédula válida', () => {
    expect(validateRegisterForm({ ...baseForm, phoneLocal: '41234563' })).toContain('cédula')
  })
  it('fecha de nacimiento', () => {
    expect(validateRegisterForm({ ...baseForm, birthdate: '' })).toBeTruthy()
  })
})
