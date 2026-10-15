import { describe, expect, it } from 'vitest'
import {
  buildStudentEvaluationsHtml,
  formatYmdShort,
  gradeTooltipLine,
  printablePeriods,
} from './student-evaluation-export'

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

describe('buildStudentEvaluationsHtml', () => {
  const base = {
    detail: { course: { name: '1.º A' }, subject: { name: 'Matemática' } } as any,
    student: { studentId: 's1', firstName: 'Ana', lastName: 'Pérez', documentId: '1.234.567-8', absences: '2' } as any,
    index: 0,
    libretaLabel: '1A-MAT',
    photoUrl: null,
    decimals: 0,
  }

  it('imprime la C y la R de una entrega aunque no tenga notas sueltas', () => {
    const html = buildStudentEvaluationsHtml({
      ...base,
      rows: [],
      periods: [{ name: 'Diagnóstico' }, { name: '1.ª Entrega' }],
      periodResults: { '1.ª Entrega': { c: 700, r: 800, judgement: 'Trabaja con constancia.' } },
    })
    expect(html).toContain('1.ª Entrega')
    expect(html).toContain('<td>7</td>')
    expect(html).toContain('<strong>8</strong>')
    expect(html).toContain('Trabaja con constancia.')
    // Un período sin notas, C, R ni juicio no ocupa lugar.
    expect(html).not.toContain('Diagnóstico')
    expect(html).not.toContain('Sin calificaciones registradas')
  })

  it('respeta el orden de los períodos de la libreta y suma las notas sueltas', () => {
    const periods = printablePeriods({
      periods: [{ name: '1.er tramo' }, { name: '1.ª Entrega' }],
      rows: [
        {
          date: '2026-04-22',
          typeName: 'Escrito',
          valueHundredths: 900,
          isAbsent: false,
          comment: null,
          periodName: '1.er tramo',
          decimals: 0,
          category: 'written',
        },
      ],
      periodResults: { '1.ª Entrega': { c: 700, r: null } },
    })
    expect(periods.map((p) => p.name)).toEqual(['1.er tramo', '1.ª Entrega'])
    expect(periods[0].rows).toHaveLength(1)
  })

  it('sin nada cargado lo dice', () => {
    const html = buildStudentEvaluationsHtml({ ...base, rows: [], periods: [{ name: '1.ª Entrega' }] })
    expect(html).toContain('Sin calificaciones registradas')
  })

  it('escapa el texto del juicio', () => {
    const html = buildStudentEvaluationsHtml({
      ...base,
      rows: [],
      periods: [{ name: '1.ª Entrega' }],
      periodResults: { '1.ª Entrega': { c: null, r: null, judgement: '<b>ok</b>' } },
    })
    expect(html).toContain('&lt;b&gt;ok&lt;/b&gt;')
  })
})
