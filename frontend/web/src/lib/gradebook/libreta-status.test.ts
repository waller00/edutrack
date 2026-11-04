import { describe, expect, it } from 'vitest'
import { cardStatus, missingTexts, observedText, ownerSummaries, type OwnerSummary } from './libreta-status'
import type { MeetingSummary } from './closure-blockers'

function meeting(over: Partial<MeetingSummary> & { periodId: string }): MeetingSummary {
  return {
    name: over.periodId,
    kind: 'ENTREGA',
    sortOrder: 30,
    reportCard: true,
    judgementLabel: null,
    closesOn: '2026-11-14',
    status: 'OPEN',
    closedAt: null,
    closedLate: false,
    reopenReason: null,
    missing: [],
    review: null,
    ...over,
  }
}

const students = [
  { studentId: 'a', lastName: 'Pérez', firstName: 'Ana' },
  { studentId: 'b', lastName: 'Gómez', firstName: 'Beto' },
]

const summary = (meetings: MeetingSummary[]): OwnerSummary => ({ gradeBookId: 'gb', role: 'OWNER', meetings, students })

describe('el estado de una libreta', () => {
  it('la reunión que viene, con su plazo, su etapa y qué falta de quiénes', () => {
    const status = cardStatus(
      summary([
        meeting({ periodId: '1.ª Entrega', status: 'CLOSED', missing: null }),
        meeting({ periodId: '2.ª Entrega', missing: [{ code: 'MISSING_GRADES', studentIds: ['a', 'b'] }, { code: 'MISSING_GROUP_REPORT', studentIds: [] }] }),
      ]),
      '2026-11-04',
    )
    expect(status?.meeting.name).toBe('2.ª Entrega')
    expect(status?.deadline).toEqual({ text: 'cierra el 14/11', overdue: false })
    expect(status?.stage.label).toBe('Abierta')
    expect(status?.missing).toEqual(['2 sin R (rendimiento): Pérez, Ana · Gómez, Beto', 'falta el informe del grupo'])
  })

  it('con todo cargado está lista para cerrar; con el plazo pasado, lo dice', () => {
    const status = cardStatus(summary([meeting({ periodId: 'e' })]), '2026-11-20')
    expect(status?.stage.label).toBe('Lista para cerrar')
    expect(status?.deadline).toEqual({ text: 'venció el 14/11', overdue: true })
  })

  it('todas cerradas: la última, sin plazo; lo observado espera corrección', () => {
    const observed = meeting({
      periodId: 'e',
      status: 'CLOSED',
      missing: null,
      review: { sections: [], overallStatus: 'OBSERVED', blockingSections: ['JUDGEMENTS', 'PLANNING'], reclosedAfterObservation: false },
    })
    const status = cardStatus(summary([observed]), '2026-11-04')
    expect(status?.deadline).toBeNull()
    expect(status?.stage.label).toBe('Observada')
    expect(status?.observed).toBe('Observaron: juicios y planificación y desarrollo')
    expect(observedText({ ...observed, review: { ...observed.review!, reclosedAfterObservation: true } })).toBeNull()
    expect(observedText(meeting({ periodId: 'x' }))).toBeNull()
  })

  it('sin reuniones no hay estado; las suplencias no traen', () => {
    expect(cardStatus(summary([]), '2026-11-04')).toBeNull()
    const rows = ownerSummaries([summary([]), { gradeBookId: 'sup', role: 'SUBSTITUTE', until: null }])
    expect([...rows.keys()]).toEqual(['gb'])
    expect(ownerSummaries(undefined).size).toBe(0)
    expect(missingTexts(meeting({ periodId: 'c', missing: null }), students)).toEqual([])
  })
})
