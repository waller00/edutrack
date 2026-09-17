import { describe, expect, it } from 'vitest'
import {
  isRegisterDataStepComplete,
  validateRegisterField,
  validateRegisterFields,
  type RegisterFieldValues,
} from '@/lib/auth/register-field-validation'

const VALID: RegisterFieldValues = {
  email: 'juan@example.com',
  password: 'Segura123',
  confirm: 'Segura123',
  nationalId: '1.234.567-2',
  firstName: 'Juan Carlos',
  lastName: 'Pérez Rodríguez',
  phoneLocal: '094481122',
  birthdate: '1990-01-15',
  role: 'TEACHER',
}

function withField(overrides: Partial<RegisterFieldValues>): RegisterFieldValues {
  return { ...VALID, ...overrides }
}

describe('validateRegisterField', () => {
  it('acepta un formulario completo y válido', () => {
    expect(validateRegisterFields(VALID)).toEqual({})
    expect(isRegisterDataStepComplete(VALID)).toBe(true)
  })

  it('marca obligatorios los campos vacíos', () => {
    const errors = validateRegisterFields(
      withField({ email: '', password: '', confirm: '', nationalId: '', firstName: '', lastName: '', birthdate: '', role: '' }),
    )

    expect(errors.email).toMatch(/obligatorio/i)
    expect(errors.password).toMatch(/obligatoria/i)
    expect(errors.nationalId).toMatch(/obligatoria/i)
    expect(errors.firstName).toMatch(/obligatorio/i)
    expect(errors.lastName).toMatch(/obligatorio/i)
    expect(errors.birthdate).toBeTruthy()
    expect(errors.role).toBeTruthy()
  })

  it('valida el formato del correo', () => {
    expect(validateRegisterField('email', withField({ email: 'sin-arroba' }))).toMatch(/inválido/i)
    expect(validateRegisterField('email', withField({ email: 'a@b.com' }))).toBeUndefined()
  })

  it('exige que la confirmación coincida', () => {
    expect(validateRegisterField('confirm', withField({ confirm: 'Otra123456' }))).toMatch(/no coinciden/i)
    expect(validateRegisterField('confirm', withField({ confirm: '' }))).toMatch(/Repetí/i)
  })

  it('omite contraseñas cuando el alta viene de Google', () => {
    const values = withField({ password: '', confirm: '' })
    const errors = validateRegisterFields(values, { passwordRequired: false })

    expect(errors.password).toBeUndefined()
    expect(errors.confirm).toBeUndefined()
    expect(isRegisterDataStepComplete(values, { passwordRequired: false })).toBe(true)
  })

  it('valida el dígito verificador de la cédula', () => {
    expect(validateRegisterField('nationalId', withField({ nationalId: '1.234.567-9' }))).toMatch(/inválida/i)
    expect(validateRegisterField('nationalId', VALID)).toBeUndefined()
  })

  it('trata el celular como opcional pero valida su formato', () => {
    expect(validateRegisterField('phoneLocal', withField({ phoneLocal: '' }))).toBeUndefined()
    expect(validateRegisterField('phoneLocal', withField({ phoneLocal: '12345' }))).toMatch(/inválido/i)
    expect(validateRegisterField('phoneLocal', withField({ phoneLocal: '1.234.567-2' }))).toMatch(/cédula/i)
  })

  it('rechaza nombres con números o demasiado cortos', () => {
    expect(validateRegisterField('firstName', withField({ firstName: 'J' }))).toMatch(/al menos 2/i)
    expect(validateRegisterField('firstName', withField({ firstName: 'Juan3' }))).toMatch(/solo admite letras/i)
    expect(validateRegisterField('lastName', withField({ lastName: "O'Neill-Díaz" }))).toBeUndefined()
  })

  it('rechaza fechas de nacimiento futuras', () => {
    const nextYear = `${new Date().getFullYear() + 1}-01-15`
    expect(validateRegisterField('birthdate', withField({ birthdate: nextYear }))).toMatch(/futura/i)
  })
})
