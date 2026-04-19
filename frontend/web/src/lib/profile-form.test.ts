import {
  buildProfilePayload,
  canEditNationalId,
  computeCI,
  formatCI,
  getPasswordErrorMessage,
  getProfileErrorMessage,
  isStrongPassword,
  isValidLocalPhone,
  normLocalPhoneUY,
  onlyDigits,
  validCI,
  validateProfileForm,
} from '@/lib/profile-form'

describe('onlyDigits', () => {
  it('elimina no dígitos', () => {
    expect(onlyDigits('12-34')).toBe('1234')
  })
})

describe('formatCI', () => {
  it('vacío y un dígito', () => {
    expect(formatCI('')).toBe('')
    expect(formatCI('5')).toBe('5')
  })

  it('hasta 4 dígitos', () => {
    expect(formatCI('1234')).toBe('1.234')
  })

  it('hasta 7 dígitos', () => {
    expect(formatCI('1234567')).toBe('1.234.567')
  })

  it('8 dígitos con verificador', () => {
    expect(formatCI('12345678')).toBe('1.234.567-8')
  })

  it('limita a 8 dígitos', () => {
    expect(formatCI('12345678901')).toMatch(/^1\.234\.567-\d$/)
  })
})

describe('computeCI y validCI', () => {
  it('computeCI consistente con dígito verificador conocido', () => {
    const base = '1234567'
    const d = computeCI(base)
    expect(validCI(`${base}${d}`)).toBe(true)
  })

  it('rechaza longitud incorrecta', () => {
    expect(validCI('123')).toBe(false)
    expect(validCI('123456789')).toBe(false)
  })

  it('rechaza verificador incorrecto', () => {
    expect(validCI('12345670')).toBe(false)
  })
})

describe('normLocalPhoneUY / isValidLocalPhone', () => {
  it('vacío', () => {
    expect(normLocalPhoneUY('')).toBe('')
    expect(isValidLocalPhone('')).toBe(false)
  })

  it('quita 0 inicial', () => {
    expect(normLocalPhoneUY('099123456')).toBe('99123456')
    expect(isValidLocalPhone('099123456')).toBe(true)
  })

  it('exige prefijo 09 en el valor ingresado', () => {
    expect(isValidLocalPhone('99123456')).toBe(false)
    expect(isValidLocalPhone('099123456')).toBe(true)
  })

  it('inválido si no son 8', () => {
    expect(isValidLocalPhone('9912345')).toBe(false)
  })
})

describe('canEditNationalId', () => {
  it('solo ADMIN', () => {
    expect(canEditNationalId('ADMIN')).toBe(true)
    expect(canEditNationalId('TEACHER')).toBe(false)
    expect(canEditNationalId(undefined)).toBe(false)
  })
})

describe('isStrongPassword', () => {
  it('válida', () => expect(isStrongPassword('Abcdef12')).toBe(true))
  it('sin mayúscula', () => expect(isStrongPassword('abcdef12')).toBe(false))
  it('corta', () => expect(isStrongPassword('Ab1')).toBe(false))
})

describe('getProfileErrorMessage / getPasswordErrorMessage', () => {
  it('409 y 403 en perfil', () => {
    expect(getProfileErrorMessage({ message: '409 conflict' })).toContain('registrados')
    expect(getProfileErrorMessage({ message: '403 forbidden' })).toContain('permisos')
    expect(getProfileErrorMessage({ message: '500' })).toBe('Error al guardar')
  })

  it('401 en contraseña', () => {
    expect(getPasswordErrorMessage({ message: '401' })).toContain('incorrecta')
    expect(getPasswordErrorMessage({ message: '500' })).toContain('No se pudo')
  })
})

describe('buildProfilePayload', () => {
  it('sin admin no incluye nationalId', () => {
    const p = buildProfilePayload({
      username: 'u',
      firstName: 'a',
      lastName: 'b',
      phoneLocal: '',
      birthdate: '',
      nationalIdDocumentExpiresAt: '',
      nationalId: '1.234.567-8',
      isAdmin: false,
    })
    expect(p.nationalId).toBeUndefined()
    expect(p.phone).toBeUndefined()
  })

  it('con teléfono y fecha', () => {
    const p = buildProfilePayload({
      username: 'user_ok',
      firstName: 'A',
      lastName: 'B',
      phoneLocal: '099123456',
      birthdate: '2000-01-15',
      nationalIdDocumentExpiresAt: '2032-03-10',
      nationalId: 'x',
      isAdmin: true,
    })
    expect(p.phone).toBe('+59899123456')
    expect(String(p.birthdate)).toMatch(/2000-01/)
    expect(p.nationalId).toBe('x')
    expect(String(p.nationalIdDocumentExpiresAt)).toMatch(/2032-03/)
  })
})

describe('validateProfileForm', () => {
  const base = {
    username: 'good_user',
    nationalId: '1.111.111-1',
    firstName: 'A',
    lastName: 'B',
    phoneLocal: '',
    canEditCi: false,
  }

  it('usuario inválido', () => {
    expect(validateProfileForm({ ...base, username: 'ab' })).toBe('Usuario inválido')
  })

  it('cédula cuando canEditCi', () => {
    expect(
      validateProfileForm({
        ...base,
        canEditCi: true,
        nationalId: 'invalid',
      }),
    ).toBe('Cédula inválida')
  })

  it('nombre vacío', () => {
    expect(validateProfileForm({ ...base, firstName: '  ' })).toBe('Nombre y apellido obligatorios')
  })

  it('celular inválido si hay valor', () => {
    expect(validateProfileForm({ ...base, phoneLocal: '12' })).toContain('Celular')
  })

  it('ok', () => {
    const d = String(computeCI('1111111'))
    expect(
      validateProfileForm({
        ...base,
        canEditCi: true,
        nationalId: `1.111.111-${d}`,
        phoneLocal: '099123456',
      }),
    ).toBeNull()
  })
})
