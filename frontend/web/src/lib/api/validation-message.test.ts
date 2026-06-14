import { describe, expect, it } from 'vitest'
import { formatValidationErrorFromApi } from './validation-message'

describe('formatValidationErrorFromApi', () => {
  it('sin issues devuelve el mensaje del servidor', () => {
    const err = Object.assign(new Error('Datos inválidos'), {
      status: 400,
      data: { message: 'Datos inválidos: formato no permitido.' },
    })
    expect(formatValidationErrorFromApi(err)).toContain('Datos inválidos')
  })

  it('lista campos con issues de Zod', () => {
    const err = Object.assign(new Error('Datos inválidos'), {
      status: 400,
      data: {
        message: 'Datos inválidos',
        errors: [
          {
            code: 'too_small',
            minimum: 1,
            type: 'string',
            inclusive: true,
            exact: false,
            message: 'String must contain at least 1 character(s)',
            path: ['reason'],
          },
        ],
      },
    })
    const out = formatValidationErrorFromApi(err)
    expect(out).toContain('Motivo')
    expect(out).toContain('vacío')
  })

  it('acepta issues en lugar de errors', () => {
    const err = Object.assign(new Error('x'), {
      data: {
        message: 'Datos inválidos',
        issues: [{ path: ['userId'], code: 'invalid_type', message: 'Required' }],
      },
    })
    expect(formatValidationErrorFromApi(err)).toContain('Usuario')
  })
})
