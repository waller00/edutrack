import { describe, expect, it } from 'vitest'
import { pickReferencePeriods, riskCounts, riskRows, type RiskInput } from './risk.js'

function input(over: Partial<RiskInput> & { studentId: string }): RiskInput {
  return {
    firstName: over.studentId,
    lastName: over.studentId.toUpperCase(),
    courseName: '8 EBI',
    level: 'EBI',
    lowSubjects: null,
    absenceHundredths: 0,
    openStreak: null,
    carried: 0,
    ...over,
  }
}

const low = (count: number, subjects: string[] = []) => ({ count, subjects, periodName: '2.ª Entrega' })

describe('riskRows', () => {
  it('marca por notas con la regla del ciclo y por faltas desde las 18', () => {
    const rows = riskRows(
      [
        input({ studentId: 'notas', lowSubjects: low(3, ['Física', 'Matemática', 'Química']) }),
        input({ studentId: 'dos-materias', lowSubjects: low(2) }),
        input({ studentId: 'faltas', absenceHundredths: 1800 }),
        input({ studentId: 'casi', absenceHundredths: 1750 }),
        input({ studentId: 'racha', openStreak: { days: 4, from: '2026-10-26' } }),
        input({ studentId: 'previa', carried: 2 }),
      ],
      3,
    )
    expect(rows.map((r) => [r.studentId, r.reasons])).toEqual([
      ['notas', ['GRADES']],
      ['faltas', ['ABSENCES']],
      ['racha', ['STREAK']],
      ['previa', ['CARRIED']],
    ])
    expect(rows.find((r) => r.studentId === 'faltas')).toMatchObject({ absenceThreshold: 1800, families: ['FALTAS'] })
    expect(rows.find((r) => r.studentId === 'previa')?.families).toEqual(['NOTAS'])
  })

  it('primero quien tiene notas y faltas; después las 25 faltas, más materias bajas y más faltas', () => {
    const rows = riskRows(
      [
        input({ studentId: 'b', lowSubjects: low(4) }),
        input({ studentId: 'a', absenceHundredths: 2600 }),
        input({ studentId: 'c', lowSubjects: low(3), absenceHundredths: 1900 }),
        input({ studentId: 'd', lowSubjects: low(5) }),
      ],
      3,
    )
    expect(rows.map((r) => r.studentId)).toEqual(['c', 'a', 'd', 'b'])
    expect(rows[1].absenceThreshold).toBe(2500)
  })

  it('con la regla de asignaturas apagada, las notas sólo cuentan por materias de años anteriores', () => {
    const rows = riskRows([input({ studentId: 'x', lowSubjects: low(6) }), input({ studentId: 'y', carried: 1 })], Number.POSITIVE_INFINITY)
    expect(rows.map((r) => r.studentId)).toEqual(['y'])
  })

  it('cuenta estudiantes por notas, por faltas y por las dos', () => {
    const rows = riskRows(
      [
        input({ studentId: 'n', lowSubjects: low(3) }),
        input({ studentId: 'f', absenceHundredths: 2000 }),
        input({ studentId: 'ambos', carried: 1, openStreak: { days: 3, from: '2026-11-02' } }),
      ],
      3,
    )
    expect(riskCounts(rows)).toEqual({ students: 3, grades: 2, absences: 2, both: 1 })
  })
})

describe('pickReferencePeriods', () => {
  const E2 = { id: 'e2', name: '2.ª Entrega', level: 'EBI', sortOrder: 60, graded: 900 }
  const E3 = { id: 'e3', name: '3.ª Entrega', level: 'EBI', sortOrder: 80, graded: 880 }
  const E4 = { id: 'e4', name: '4.ª Entrega', level: 'EBI', sortOrder: 100, graded: 0 }
  const S1 = { id: 's1', name: '1.er semestre', level: 'EMS', sortOrder: 10, graded: 300 }

  it('por nivel: el pedido si es de ese nivel; si no, el último con notas', () => {
    const refs = pickReferencePeriods([E2, E3, E4, S1], 'e2')
    expect(refs.get('EBI')?.id).toBe('e2')
    expect(refs.get('EMS')?.id).toBe('s1')
    expect(pickReferencePeriods([E2, E3, E4]).get('EBI')?.id).toBe('e3')
  })

  it('sin ningún boletín con notas, no hay referencia', () => {
    expect(pickReferencePeriods([E4]).get('EBI')).toBeNull()
  })
})
