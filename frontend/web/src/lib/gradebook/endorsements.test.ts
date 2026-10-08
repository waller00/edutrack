import { describe, expect, it } from 'vitest'
import {
  canActOnSection,
  endorsementAbilities,
  formatEndorsementDate,
  readyToEndorse,
  sectionState,
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

describe('visado en lote', () => {
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

describe('auxiliares', () => {
  it('una sección sin filas está pendiente', () => {
    expect(sectionState(row(), 'CLOSURE')).toEqual({ section: 'CLOSURE', status: 'PENDING', occurredAt: null, observations: null })
  })

  it('formatea la fecha como día/mes/año', () => {
    expect(formatEndorsementDate('2026-06-12T15:00:00.000Z')).toBe('12/06/2026')
    expect(formatEndorsementDate(null)).toBe('')
  })
})
