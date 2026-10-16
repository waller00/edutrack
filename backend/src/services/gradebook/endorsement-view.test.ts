import { describe, expect, it } from 'vitest'
import { reclosedAfterObservation, serializeEndorsementRow } from './endorsement-view.js'

const at = (iso: string) => new Date(iso)

function row(endorsements: any[], over: any = {}) {
  return {
    id: 'gbp-1',
    gradeBookId: 'gb-1',
    status: 'CLOSED',
    closedAt: at('2026-06-01T12:00:00Z'),
    closedLate: false,
    updatedAt: at('2026-06-01T12:00:00Z'),
    endorsements,
    period: { id: 'p-1', code: 'E1', name: '1.ª Entrega', sortOrder: 10 },
    gradeBook: {
      subject: { id: 's-1', name: 'Matemática' },
      teacher: { id: 't-1', name: 'Ana G' },
      courseOffering: { course: { name: '1.º EBI' } },
      courseOrientation: { orientation: { name: 'Científico' } },
    },
    ...over,
  }
}

const observed = (section: string, iso: string) => ({
  section,
  status: 'OBSERVED',
  occurredAt: at(iso),
  observations: 'Revisar.',
  actorRoleCode: 'ADSCRIPTO',
})

describe('reclosedAfterObservation', () => {
  it('es verdadero si el cierre es posterior a la última observación viva', () => {
    expect(
      reclosedAfterObservation({
        periodStatus: 'CLOSED',
        closedAt: at('2026-06-10T12:00:00Z'),
        observedAt: [at('2026-06-02T12:00:00Z'), at('2026-06-05T12:00:00Z')],
      }),
    ).toBe(true)
  })

  it('es falso si todavía no se volvió a cerrar, o no hay nada observado', () => {
    const observedAt = [at('2026-06-05T12:00:00Z')]
    expect(reclosedAfterObservation({ periodStatus: 'CLOSED', closedAt: at('2026-06-01T12:00:00Z'), observedAt })).toBe(false)
    expect(reclosedAfterObservation({ periodStatus: 'REOPENED', closedAt: at('2026-06-10T12:00:00Z'), observedAt })).toBe(false)
    expect(reclosedAfterObservation({ periodStatus: 'CLOSED', closedAt: null, observedAt })).toBe(false)
    expect(reclosedAfterObservation({ periodStatus: 'CLOSED', closedAt: at('2026-06-10T12:00:00Z'), observedAt: [] })).toBe(false)
  })
})

describe('serializeEndorsementRow', () => {
  it('arma todas las secciones con su estado vigente y la orientación del grupo', () => {
    const view = serializeEndorsementRow(row([observed('JUDGEMENTS', '2026-06-02T12:00:00Z')]), at('2026-06-04T12:00:00Z'))
    expect(view.sections.map((s) => [s.section, s.status])).toEqual([
      ['GRADES', 'PENDING'],
      ['CLOSURE', 'PENDING'],
      ['JUDGEMENTS', 'OBSERVED'],
      ['PLANNING', 'PENDING'],
      ['GROUP_REPORT', 'PENDING'],
      ['ALL', 'PENDING'],
    ])
    expect(view.sections[2].observations).toBe('Revisar.')
    expect(view.orientationName).toBe('Científico')
    expect(view.blockingSections).toEqual(['JUDGEMENTS'])
    expect(view.canFinalize).toBe(false)
    expect(view.pendingAgeDays).toBe(2)
    expect(view.reclosedAfterObservation).toBe(false)
  })

  it('un período visado no tiene antigüedad de pendiente', () => {
    const view = serializeEndorsementRow(
      row([{ section: 'ALL', status: 'ENDORSED', occurredAt: at('2026-06-03T12:00:00Z'), observations: null, actorRoleCode: 'DIRECCION' }]),
      at('2026-06-20T12:00:00Z'),
    )
    expect(view.overallStatus).toBe('ENDORSED')
    expect(view.pendingAgeDays).toBeNull()
  })

  it('detecta que se corrigió y volvió a cerrar', () => {
    const view = serializeEndorsementRow(
      row([observed('GRADES', '2026-06-02T12:00:00Z')], { closedAt: at('2026-06-08T12:00:00Z') }),
      at('2026-06-09T12:00:00Z'),
    )
    expect(view.reclosedAfterObservation).toBe(true)
  })
})
