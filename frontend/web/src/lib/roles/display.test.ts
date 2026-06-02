import { describe, it, expect } from 'vitest'
import { getRoleLabel, getRoleOptionLabel } from './display'

describe('getRoleLabel', () => {
  it('mapea los roles conocidos (case-insensitive)', () => {
    expect(getRoleLabel('ADMIN')).toBe('Administración')
    expect(getRoleLabel('teacher')).toBe('Docente')
    expect(getRoleLabel('Staff')).toBe('Personal')
    expect(getRoleLabel('STUDENT')).toBe('Estudiante')
  })

  it('devuelve el valor original para roles desconocidos', () => {
    expect(getRoleLabel('CUSTOM_ROLE')).toBe('CUSTOM_ROLE')
  })

  it('cae a "Usuario" cuando es null/undefined/vacío', () => {
    expect(getRoleLabel(null)).toBe('Usuario')
    expect(getRoleLabel(undefined)).toBe('Usuario')
    expect(getRoleLabel('')).toBe('Usuario')
  })
})

describe('getRoleOptionLabel', () => {
  it('placeholder cuando vacío', () => {
    expect(getRoleOptionLabel('')).toBe('Seleccioná un perfil')
  })

  it('reusa getRoleLabel para roles concretos', () => {
    expect(getRoleOptionLabel('TEACHER')).toBe('Docente')
    expect(getRoleOptionLabel('ADMIN')).toBe('Administración')
  })
})
