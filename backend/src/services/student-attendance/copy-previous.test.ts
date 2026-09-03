import { describe, expect, it } from 'vitest'
import { buildPreviousSessionWhere, groupKeyOf, projectPreviousStatuses } from './copy-previous.js'

describe('groupKeyOf', () => {
  it('la orientación del curso manda sobre la oferta', () => {
    expect(groupKeyOf({ courseOfferingId: 'co-1', courseOrientationId: 'cor-1' })).toBe('cor-1')
  })

  it('sin orientación el grupo es la oferta', () => {
    expect(groupKeyOf({ courseOfferingId: 'co-1', courseOrientationId: null })).toBe('co-1')
  })
})

describe('buildPreviousSessionWhere', () => {
  const base = { occurrenceYmd: '2026-05-11', currentStartAt: new Date('2026-05-11T12:00:00.000Z'), currentSessionId: null }

  it('solo mira listas ya tomadas que terminaron antes de esta clase', () => {
    const where = buildPreviousSessionWhere({ ...base, courseOfferingId: 'co-1', courseOrientationId: null })
    expect(where).toMatchObject({
      occurrenceYmd: '2026-05-11',
      status: 'TAKEN',
      endAt: { lte: base.currentStartAt },
    })
  })

  it('un grupo con orientación solo hereda de su misma orientación', () => {
    const where = buildPreviousSessionWhere({ ...base, courseOfferingId: 'co-1', courseOrientationId: 'cor-1' })
    expect(where).toMatchObject({ courseOrientationId: 'cor-1' })
    expect(where).not.toHaveProperty('courseOfferingId')
  })

  it('tronco común exige courseOrientationId null para no heredar de una orientación', () => {
    // Heredar de una clase de orientación dejaría sin marcar a los alumnos de las otras.
    const where = buildPreviousSessionWhere({ ...base, courseOfferingId: 'co-1', courseOrientationId: null })
    expect(where).toMatchObject({ courseOfferingId: 'co-1', courseOrientationId: null })
  })

  it('excluye la propia sesión cuando ya existe', () => {
    const where = buildPreviousSessionWhere({ ...base, currentSessionId: 'sess-1', courseOfferingId: 'co-1', courseOrientationId: null })
    expect(where.NOT).toEqual({ id: 'sess-1' })
  })

  it('sin sesión propia no agrega la exclusión', () => {
    expect(buildPreviousSessionWhere({ ...base, courseOfferingId: 'co-1', courseOrientationId: null })).not.toHaveProperty('NOT')
  })
})

describe('projectPreviousStatuses', () => {
  const roster = [{ studentId: 'a' }, { studentId: 'b' }, { studentId: 'c' }]

  it('proyecta los estados de los alumnos que estaban en la hora anterior', () => {
    const result = projectPreviousStatuses(
      [
        { studentId: 'a', status: 'PRESENT' },
        { studentId: 'b', status: 'LATE' },
        { studentId: 'c', status: 'ABSENT' },
      ],
      roster,
    )
    expect(result.suggestions).toEqual([
      { studentId: 'a', status: 'PRESENT' },
      { studentId: 'b', status: 'LATE' },
      { studentId: 'c', status: 'ABSENT' },
    ])
    expect(result.newStudentIds).toEqual([])
  })

  it('degrada la falta justificada a ausente: la justificación es por ocurrencia', () => {
    const result = projectPreviousStatuses([{ studentId: 'a', status: 'ABSENT_JUSTIFIED' }], [{ studentId: 'a' }])
    expect(result.suggestions).toEqual([{ studentId: 'a', status: 'ABSENT' }])
  })

  it('reporta a los alumnos nuevos sin asignarles estado', () => {
    const result = projectPreviousStatuses([{ studentId: 'a', status: 'PRESENT' }], roster)
    expect(result.suggestions).toEqual([{ studentId: 'a', status: 'PRESENT' }])
    expect(result.newStudentIds).toEqual(['b', 'c'])
  })

  it('descarta alumnos de la hora anterior que ya no están en el grupo', () => {
    const result = projectPreviousStatuses(
      [{ studentId: 'a', status: 'PRESENT' }, { studentId: 'zz', status: 'ABSENT' }],
      [{ studentId: 'a' }],
    )
    expect(result.suggestions).toHaveLength(1)
    expect(result.newStudentIds).toEqual([])
  })
})
