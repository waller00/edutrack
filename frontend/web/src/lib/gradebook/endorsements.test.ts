import { describe, expect, it } from 'vitest'
import {
  canActOnSection,
  endorsementAbilities,
  formatEndorsementDate,
  nextForReview,
  observedLabels,
  readyToEndorse,
  reviewState,
  sectionState,
  visadoHref,
  type EndorsementRow,
} from './endorsements'

const grant = (...ids: string[]) => ({ permissions: ids.map((id) => ({ id, scope: 'all' as const })) })

function row(over: Partial<EndorsementRow> = {}): EndorsementRow {
  return {
    gradeBookPeriodId: 'gbp-1',
    gradeBookId: 'gb-1',
    periodStatus: 'CLOSED',
    period: { id: 'p-1', name: '1.ª Entrega' },
    subject: { name: 'Matemática' },
    teacher: null,
    courseName: '1.º',
    orientationName: null,
    closedLate: false,
    sections: [],
    overallStatus: 'PENDING',
    pendingAgeDays: 1,
    blockingSections: [],
    canFinalize: true,
    ...over,
  }
}

describe('atribuciones de visado', () => {
  it('adscripción observa y da por corregido, pero no visa ni reabre', () => {
    expect(endorsementAbilities(grant('gradebook.review'))).toEqual({
      canObserve: true,
      canCorrect: true,
      canEndorse: false,
      canReopen: false,
    })
  })

  it('inspección observa, pero no corrige ni visa', () => {
    expect(endorsementAbilities(grant('gradebook.inspect'))).toMatchObject({ canObserve: true, canCorrect: false, canEndorse: false })
  })

  it('reabrir exige gradebook.manage con alcance total', () => {
    expect(endorsementAbilities(grant('gradebook.manage')).canReopen).toBe(true)
    expect(endorsementAbilities({ permissions: [{ id: 'gradebook.manage', scope: 'own' }] }).canReopen).toBe(false)
    expect(endorsementAbilities(null).canObserve).toBe(false)
  })

  it('una sección visada sólo la toca quien visa', () => {
    const ads = endorsementAbilities(grant('gradebook.review'))
    const dir = endorsementAbilities(grant('gradebook.review', 'gradebook.endorse'))
    expect(canActOnSection('ENDORSED', ads)).toBe(false)
    expect(canActOnSection('ENDORSED', dir)).toBe(true)
    expect(canActOnSection('OBSERVED', ads)).toBe(true)
  })
})

describe('listas para visar', () => {
  it('toma sólo lo cerrado, sin visar y sin observaciones vivas', () => {
    const rows = [
      row({ gradeBookPeriodId: 'lista' }),
      row({ gradeBookPeriodId: 'observada', canFinalize: false }),
      row({ gradeBookPeriodId: 'visada', overallStatus: 'ENDORSED' }),
      row({ gradeBookPeriodId: 'reabierta', periodStatus: 'REOPENED' }),
    ]
    expect(readyToEndorse(rows).map((r) => r.gradeBookPeriodId)).toEqual(['lista'])
  })
})

describe('estado de la revisión', () => {
  it('sin observaciones vivas, está para revisar', () => {
    expect(reviewState(row())).toMatchObject({ kind: 'TO_REVIEW', label: 'Para revisar' })
  })

  it('observada, se espera al docente; si volvió a cerrar, hay que revisar la corrección', () => {
    expect(reviewState(row({ blockingSections: ['GRADES'], canFinalize: false })).kind).toBe('OBSERVED')
    expect(
      reviewState(row({ blockingSections: ['GRADES'], canFinalize: false, reclosedAfterObservation: true })).label,
    ).toBe('Volvió a cerrarse: revisá la corrección')
  })

  it('reabierta, el docente está corrigiendo aunque la observación siga viva', () => {
    expect(reviewState(row({ periodStatus: 'REOPENED', blockingSections: ['JUDGEMENTS'] })).kind).toBe('REOPENED')
  })

  it('visada pesa más que todo lo demás, y siempre lleva símbolo además del color', () => {
    const state = reviewState(row({ overallStatus: 'ENDORSED', blockingSections: ['GRADES'] }))
    expect(state).toMatchObject({ kind: 'ENDORSED', label: 'Visada', symbol: '✓' })
  })

  it('dice qué partes se observaron', () => {
    expect(observedLabels(row({ blockingSections: ['GRADES', 'JUDGEMENTS'] }))).toBe('Calificaciones, Juicios')
  })
})

describe('siguiente para revisar', () => {
  const queue = [
    row({ gradeBookId: 'a' }),
    row({ gradeBookId: 'b', blockingSections: ['GRADES'], canFinalize: false }),
    row({ gradeBookId: 'c' }),
    row({ gradeBookId: 'd', blockingSections: ['GRADES'], canFinalize: false, reclosedAfterObservation: true }),
  ]
  const next = (current: string) => nextForReview(queue, current)?.gradeBookId ?? null

  it('sigue después de la actual y saltea las que esperan al docente', () => {
    expect(next('a')).toBe('c')
    expect(next('c')).toBe('d')
  })

  it('al final vuelve a empezar, sin volver a la actual', () => {
    expect(next('d')).toBe('a')
    expect(nextForReview([row({ gradeBookId: 'a' })], 'a')).toBeNull()
  })

  it('si la actual ya no está en la bandeja (se acaba de visar), toma la primera', () => {
    expect(next('z')).toBe('a')
  })
})

describe('auxiliares', () => {
  it('la revisión lleva la reunión y, si hay, el grupo filtrado', () => {
    expect(visadoHref('gb-1', 'p-1')).toBe('/libreta/gb-1/visado?reunion=p-1')
    expect(visadoHref('gb-1', 'p-1', { courseOfferingId: 'off-1', courseOrientationId: 'co-1' })).toBe(
      '/libreta/gb-1/visado?reunion=p-1&courseOfferingId=off-1&courseOrientationId=co-1',
    )
  })

  it('una sección sin filas está pendiente', () => {
    expect(sectionState(row(), 'CLOSURE')).toEqual({ section: 'CLOSURE', status: 'PENDING', occurredAt: null, observations: null })
  })

  it('formatea la fecha como día/mes/año', () => {
    expect(formatEndorsementDate('2026-06-12T15:00:00.000Z')).toBe('12/06/2026')
    expect(formatEndorsementDate(null)).toBe('')
  })
})
