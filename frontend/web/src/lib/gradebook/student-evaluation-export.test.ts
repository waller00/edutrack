import { describe, expect, it } from 'vitest'
import { formatYmdShort, gradeTooltipLine } from './student-evaluation-export'

describe('formatYmdShort', () => {
  it('formatea YYYY-MM-DD a DD/MM/YY', () => {
    expect(formatYmdShort('2026-04-22')).toBe('22/04/26')
  })
})

describe('gradeTooltipLine', () => {
  it('prioriza el comentario sobre el título', () => {
    expect(
      gradeTooltipLine({
        date: '2026-04-22',
        comment: 'Escrito sobre ondas periódicas',
        title: 'Escrito 1',
      }),
    ).toBe('22/04/26 - Escrito sobre ondas periódicas')
  })
})
