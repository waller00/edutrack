import { describe, it, expect } from 'vitest'
import { formatValidationErrorFromApi } from './validation-message'

describe('formatValidationErrorFromApi - headline sin issues', () => {
  it('usa data.message y antepone ❌', () => {
    expect(formatValidationErrorFromApi({ data: { message: 'Algo falló' } })).toBe('❌ Algo falló')
  })
  it('respeta headline que ya trae ❌', () => {
    expect(formatValidationErrorFromApi({ data: { message: '❌ Ya marcado' } })).toBe('❌ Ya marcado')
  })
  it('usa err.message y limpia prefijo "Error:"', () => {
    expect(formatValidationErrorFromApi({ message: 'Error: roto' })).toBe('❌ roto')
  })
  it('sin nada → Error', () => {
    expect(formatValidationErrorFromApi({})).toBe('❌ Error')
  })
})

describe('formatValidationErrorFromApi - con issues (describeIssue)', () => {
  it('mapea labels conocidos y detalles por código', () => {
    const out = formatValidationErrorFromApi({
      data: {
        message: 'Datos inválidos',
        issues: [
          { path: ['userId'], code: 'invalid_string', validation: 'uuid' },
          { path: ['startDate'], code: 'invalid_string', validation: 'datetime' },
          { path: ['reason'], code: 'invalid_type', message: 'Required' },
          { path: ['notes'], code: 'too_small', type: 'string', minimum: 1 },
          { path: ['doctorName'], code: 'too_big', type: 'string' },
        ],
      },
    })
    expect(out).toContain('Revisá lo siguiente:')
    expect(out).toContain('Usuario: identificador inválido')
    expect(out).toContain('Fecha de inicio: fecha u hora inválida')
    expect(out).toContain('Motivo: falta completar este dato')
    expect(out).toContain('Notas: no puede estar vacío')
    expect(out).toContain('Profesional: es demasiado largo')
  })

  it('usa errors[] cuando no hay issues[], y headline no-inválido', () => {
    const out = formatValidationErrorFromApi({
      data: { message: 'No se pudo guardar', errors: [{ path: ['type'], message: 'at least 1 character' }] },
    })
    expect(out).toContain('No se pudo guardar:')
    expect(out).toContain('Tipo de licencia: no puede estar vacío')
  })

  it('fallbacks: campo sin path, mensaje Invalid datetime, y mensaje libre', () => {
    const out = formatValidationErrorFromApi({
      data: {
        message: 'inválido',
        issues: [
          { message: 'Invalid datetime' },
          { path: ['custom'], message: 'algo raro' },
          { path: [] },
        ],
      },
    })
    expect(out).toContain('Formulario: fecha u hora inválida')
    expect(out).toContain('custom: algo raro')
    expect(out).toContain('Formulario: valor inválido')
  })
})
