import { describe, expect, it } from 'vitest'
import { isCardNote, needsEmsScale, planAssessmentFixes, type AssessmentRow } from './fix-assessments-plan.js'

function row(over: Partial<AssessmentRow>): AssessmentRow {
  return {
    id: 'a1',
    title: 'Oral — 2026-05-10',
    date: '2026-05-10',
    source: 'MANUAL',
    scope: 'GROUP',
    level: 'EBI',
    scaleCode: 'NUMERICA_1_10',
    activityTypeName: 'Oral',
    grades: [{ comment: null }],
    ...over,
  }
}

describe('isCardNote', () => {
  it('reconoce el título que arma la carta, con o sin comentario', () => {
    expect(isCardNote(row({}))).toBe(true)
    expect(isCardNote(row({ title: 'Leyó en voz alta', grades: [{ comment: 'Leyó en voz alta' }] }))).toBe(true)
    expect(isCardNote(row({ activityTypeName: null, title: 'Evaluación — 2026-05-10' }))).toBe(true)
  })

  it('una evaluación del grupo con título propio o varias notas no es suelta', () => {
    expect(isCardNote(row({ title: 'Escrito 1' }))).toBe(false)
    expect(isCardNote(row({ grades: [{ comment: null }, { comment: null }] }))).toBe(false)
    expect(isCardNote(row({ source: 'MOODLE_IMPORT' }))).toBe(false)
  })
})

describe('needsEmsScale', () => {
  it('sólo las manuales de bachillerato con la escala 1–10', () => {
    expect(needsEmsScale(row({ level: 'EMS' }))).toBe(true)
    expect(needsEmsScale(row({ level: 'EBI' }))).toBe(false)
    expect(needsEmsScale(row({ level: 'EMS', scaleCode: 'NUMERICA_1_12' }))).toBe(false)
    // Moodle convirtió proporcionalmente a la escala elegida: cambiarla le cambia el sentido.
    expect(needsEmsScale(row({ level: 'EMS', source: 'MOODLE_IMPORT' }))).toBe(false)
  })
})

describe('planAssessmentFixes', () => {
  it('es idempotente: lo que ya es INDIVIDUAL no vuelve a aparecer', () => {
    const plan = planAssessmentFixes([
      row({ id: 'suelta' }),
      row({ id: 'ya-suelta', scope: 'INDIVIDUAL' }),
      row({ id: 'grupo', title: 'Escrito 1' }),
      row({ id: 'ems', title: 'Escrito 2', level: 'EMS' }),
    ])
    expect(plan.toIndividual).toEqual(['suelta'])
    expect(plan.toEmsScale).toEqual(['ems'])
  })
})
