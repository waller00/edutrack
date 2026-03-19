import {
  getRegisterBirthdateValidationError,
  getRegisterDniProcessingErrorMessage,
  getRegisterIdentityValidationError,
  getRegisterVerificationFieldLabel,
  getRegisterVerificationMessageClass,
  getRegisterVerificationMessageIcon,
  isValidRegisterEmail,
  isWarningRegisterVerificationMessage,
  resolveRegisterUsernameStatus,
  validateRegisterDniUploadInput,
  validateRegisterForm,
  type RegisterVerificationResults,
} from '@/lib/register-form-validation'

const validCi = '1.111.111-1'
const baseForm = {
  email: 'a@b.co',
  password: 'Abcdef12',
  confirm: 'Abcdef12',
  username: 'user_ok',
  usernameStatus: 'ok' as const,
  nationalId: validCi,
  firstName: 'Juan',
  lastName: 'Pérez',
  role: 'TEACHER' as const,
  phoneLocal: '',
  birthdate: '1990-01-15',
  dniFile: new File(['x'], 'a.png', { type: 'image/png' }),
  verificationResults: {
    verifiedFields: 4,
    totalFields: 4,
    verification: { a: { provided: '', message: '✓' } },
  } satisfies RegisterVerificationResults,
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

describe('icons y clases verificación', () => {
  it('iconos', () => {
    expect(getRegisterVerificationMessageIcon('✓')).toBe('✅')
    expect(getRegisterVerificationMessageIcon('✗')).toBe('❌')
    expect(getRegisterVerificationMessageIcon('⚠️')).toBe('⚠️')
    expect(getRegisterVerificationMessageIcon('?')).toBe('❓')
  })
  it('clases', () => {
    expect(getRegisterVerificationMessageClass('✓')).toContain('green')
    expect(getRegisterVerificationMessageClass('✗')).toContain('red')
    expect(getRegisterVerificationMessageClass('⚠️')).toContain('orange')
    expect(getRegisterVerificationMessageClass('x')).toContain('yellow')
  })
  it('labels', () => {
    expect(getRegisterVerificationFieldLabel('lastName')).toBe('Apellidos')
  })
  it('warning message', () => {
    expect(isWarningRegisterVerificationMessage({ provided: '', message: '⚠️ Faltan apellidos' })).toBe(true)
    expect(isWarningRegisterVerificationMessage({ provided: '', message: '✓' })).toBe(false)
  })
})

describe('resolveRegisterUsernameStatus', () => {
  it('igual que onboarding', () => {
    expect(resolveRegisterUsernameStatus(false, true)).toBe('invalid')
    expect(resolveRegisterUsernameStatus(true, false)).toBe('taken')
  })
})

describe('getRegisterDniProcessingErrorMessage', () => {
  it('códigos', () => {
    expect(getRegisterDniProcessingErrorMessage({ message: '400' })).toContain('Formato')
    expect(getRegisterDniProcessingErrorMessage({ message: '500' })).toContain('servidor')
    expect(getRegisterDniProcessingErrorMessage({ message: 'x' })).toContain('manualmente')
  })
})

describe('validateRegisterDniUploadInput', () => {
  const img = new File(['x'], 'p.png', { type: 'image/png' })
  Object.defineProperty(img, 'size', { value: 1000 })

  it('missing file', () => {
    expect(validateRegisterDniUploadInput({ firstName: 'a', lastName: 'b', nationalId: '1', birthdate: '2000-01-01' })).toBe(
      'missing-file',
    )
  })
  it('no imagen', () => {
    const t = new File(['x'], 'a.txt', { type: 'text/plain' })
    Object.defineProperty(t, 'size', { value: 10 })
    expect(validateRegisterDniUploadInput({ file: t, firstName: 'a', lastName: 'b', nationalId: '1', birthdate: '2000-01-01' })).toContain(
      'imagen',
    )
  })
  it('ok', () => {
    expect(
      validateRegisterDniUploadInput({
        file: img,
        firstName: 'a',
        lastName: 'b',
        nationalId: validCi,
        birthdate: '2000-01-01',
      }),
    ).toBeNull()
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
    username: 'good',
    usernameStatus: 'ok' as const,
    nationalId: validCi,
    firstName: 'A',
    lastName: 'B',
    role: 'STAFF' as const,
  }
  it('usuario rol cédula', () => {
    expect(getRegisterIdentityValidationError({ ...b, username: 'ab' })).toContain('Usuario')
    expect(getRegisterIdentityValidationError({ ...b, usernameStatus: 'taken' })).toContain('disponible')
    expect(getRegisterIdentityValidationError({ ...b, nationalId: '1' })).toContain('Cédula')
    expect(getRegisterIdentityValidationError({ ...b, firstName: '  ' })).toContain('obligatorios')
    expect(getRegisterIdentityValidationError({ ...b, role: '' })).toContain('perfil')
  })
})

describe('validateRegisterForm', () => {
  it('formulario completo válido', () => {
    expect(validateRegisterForm(baseForm)).toBeNull()
  })
  it('email password', () => {
    expect(validateRegisterForm({ ...baseForm, email: 'bad' })).toContain('Email')
    expect(validateRegisterForm({ ...baseForm, password: 'weak' })).toContain('contraseña')
    expect(validateRegisterForm({ ...baseForm, confirm: 'Xyz78901' })).toContain('coinciden')
  })
  it('sin DNI verificado', () => {
    expect(validateRegisterForm({ ...baseForm, verificationResults: null })).toContain('verificar')
  })
  it('teléfono', () => {
    expect(validateRegisterForm({ ...baseForm, phoneLocal: '12' })).toContain('Teléfono')
  })
})
