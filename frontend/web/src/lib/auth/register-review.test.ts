import { describe, expect, it } from 'vitest'
import { buildReviewSummary, formatReviewDate } from '@/lib/auth/register-review'

describe('formatReviewDate', () => {
  it('muestra la fecha como se escribe en Uruguay', () => {
    expect(formatReviewDate('1990-01-15')).toBe('15/01/1990')
  })

  it('sin fecha no inventa nada', () => {
    expect(formatReviewDate('')).toBe('')
  })
})

describe('buildReviewSummary', () => {
  it('resume lo declarado, en el orden del formulario', () => {
    const rows = buildReviewSummary({
      firstName: ' Juan ',
      lastName: 'Pérez',
      nationalId: '1.234.567-2',
      birthdate: '1990-01-15',
      email: 'juan@example.com',
      phone: '',
      roleLabel: 'Docente',
    })
    expect(rows).toEqual([
      { label: 'Nombres', value: 'Juan' },
      { label: 'Apellidos', value: 'Pérez' },
      { label: 'Cédula', value: '1.234.567-2' },
      { label: 'Fecha de nacimiento', value: '15/01/1990' },
      { label: 'Correo', value: 'juan@example.com' },
      { label: 'Celular', value: '' },
      { label: 'Perfil', value: 'Docente' },
    ])
  })
})
