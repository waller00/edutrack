import { describe, expect, it } from 'vitest'
import { canProvisionMoodle, validateStudent, type ValidatableStudent } from './student-form'

function student(over: Partial<ValidatableStudent> = {}): ValidatableStudent {
  return { firstName: 'Ana', lastName: 'Díaz', documentId: '51234561', ...over }
}

describe('validateStudent', () => {
  it('acepta lo mínimo: nombre, apellido y cédula', () => {
    expect(validateStudent(student())).toBeNull()
  })

  it('acepta sin email ni usuario', () => {
    // Son opcionales: hacen falta recién para crear la cuenta de Moodle.
    expect(validateStudent(student({ email: null, username: null }))).toBeNull()
    expect(validateStudent(student({ email: '', username: '' }))).toBeNull()
  })

  it('exige nombre y apellido, y los ubica en Datos', () => {
    expect(validateStudent(student({ firstName: '  ' }))).toEqual({
      field: 'firstName',
      tab: 'datos',
      message: 'Poné el nombre del estudiante.',
    })
    expect(validateStudent(student({ lastName: '' }))?.field).toBe('lastName')
    expect(validateStudent(student({ lastName: '' }))?.tab).toBe('datos')
  })

  it('exige cédula válida', () => {
    expect(validateStudent(student({ documentId: null }))?.message).toMatch(/obligatoria/)
    // Dígito verificador incorrecto (el de 5123456 es 1, no 7).
    expect(validateStudent(student({ documentId: '51234567' }))?.message).toMatch(/dígito verificador/)
  })

  it('valida el email sólo cuando viene, y lo ubica en Contacto', () => {
    const error = validateStudent(student({ email: 'no-es-un-email' }))
    expect(error).toEqual({
      field: 'email',
      tab: 'contacto',
      message: 'El email no tiene un formato válido.',
    })
  })

  it('valida el formato del usuario igual que el backend', () => {
    expect(validateStudent(student({ username: 'ab' }))?.message).toMatch(/al menos 3/)
    expect(validateStudent(student({ username: 'Ana Díaz' }))?.message).toMatch(/Usuario inválido/)
    expect(validateStudent(student({ username: 'ana.diaz' }))).toBeNull()
    expect(validateStudent(student({ username: 'ana-diaz2' }))).toBeNull()
    expect(validateStudent(student({ username: 'a'.repeat(31) }))?.message).toMatch(/30 caracteres/)
  })

  it('respeta los largos máximos del backend', () => {
    expect(validateStudent(student({ firstName: 'a'.repeat(121) }))?.message).toMatch(/120/)
    expect(validateStudent(student({ contactPhone: '9'.repeat(41) }))?.tab).toBe('contacto')
    expect(validateStudent(student({ address: 'a'.repeat(501) }))?.field).toBe('address')
    expect(validateStudent(student({ internalNotes: 'a'.repeat(8001) }))?.message).toMatch(/8000/)
  })

  it('devuelve el primer problema en orden de lectura', () => {
    // Con el nombre y el email mal, se señala el nombre: es lo que se ve primero.
    const error = validateStudent(student({ firstName: '', email: 'roto' }))
    expect(error?.field).toBe('firstName')
  })

  it('ignora espacios sobrantes al validar', () => {
    expect(validateStudent(student({ email: '  ' }))).toBeNull()
    expect(validateStudent(student({ username: '   ' }))).toBeNull()
  })
})

describe('canProvisionMoodle', () => {
  it('necesita email y usuario', () => {
    expect(canProvisionMoodle(student({ email: 'a@b.com', username: 'ana.diaz' }))).toBe(true)
    expect(canProvisionMoodle(student({ email: 'a@b.com', username: null }))).toBe(false)
    expect(canProvisionMoodle(student({ email: null, username: 'ana.diaz' }))).toBe(false)
    expect(canProvisionMoodle(student({ email: '  ', username: 'ana.diaz' }))).toBe(false)
  })
})
